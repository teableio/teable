import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../domain/base/BaseId';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';

type TableUpdateMutate = (table: Table) => Result<TableUpdateResult, string>;
type TableUpdateTransactionHook = (
  context: IExecutionContext,
  table: Table,
  mutateSpec: ISpecification<Table, ITableSpecVisitor>
) => Promise<Result<void, string>>;

type TableUpdateContext = {
  context: IExecutionContext;
  baseId: BaseId;
  tableId: TableId;
};

export type TableUpdateFlowResult = {
  table: Table;
  events: ReadonlyArray<IDomainEvent>;
};

@injectable()
export class TableUpdateFlow {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async execute(
    tableContext: TableUpdateContext,
    mutate: TableUpdateMutate,
    inTransaction?: TableUpdateTransactionHook
  ): Promise<Result<TableUpdateFlowResult, string>> {
    const { context, baseId, tableId } = tableContext;
    const whereSpecResult = TableAggregate.specs(baseId).byId(tableId).build();
    if (whereSpecResult.isErr()) return err(whereSpecResult.error);

    const tableResult = await this.tableRepository.findOne(context, whereSpecResult.value);
    if (tableResult.isErr()) {
      if (tableResult.error === 'Not found') return err('Table not found');
      return err(tableResult.error);
    }
    const table = tableResult.value;

    const span = context.tracer?.startSpan('teable.TableUpdateFlow.mutate');
    const updateResult = mutate(table);
    span?.end();

    if (updateResult.isErr()) return err(updateResult.error);

    const updatedTable = updateResult.value.table;
    const mutateSpec = updateResult.value.mutateSpec;

    const transactionResult = await this.unitOfWork.withTransaction(
      context,
      async (transactionContext) => {
        const updateResult = await this.tableRepository.updateOne(
          transactionContext,
          updatedTable,
          mutateSpec
        );
        if (updateResult.isErr()) {
          if (updateResult.error === 'Not found') return err('Table not found');
          return err(updateResult.error);
        }

        const schemaResult = await this.tableSchemaRepository.update(
          transactionContext,
          updatedTable,
          mutateSpec
        );
        if (schemaResult.isErr()) return err(schemaResult.error);

        if (inTransaction) {
          const hookResult = await inTransaction(transactionContext, updatedTable, mutateSpec);
          if (hookResult.isErr()) return err(hookResult.error);
        }

        return ok(undefined);
      }
    );
    if (transactionResult.isErr()) return err(transactionResult.error);

    const events = updatedTable.pullDomainEvents();
    const publishResult = await this.eventBus.publishMany(context, events);
    if (publishResult.isErr()) return err(publishResult.error);

    return ok({ table: updatedTable, events });
  }
}
