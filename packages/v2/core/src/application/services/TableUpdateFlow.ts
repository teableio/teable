import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import * as EventBusPort from '../../ports/EventBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../../ports/TableSchemaRepository';
import { v2CoreTokens } from '../../ports/tokens';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';

type TableUpdateMutate = (table: Table) => Result<TableUpdateResult, string>;
type TableUpdateTransactionHook = (
  context: IExecutionContext,
  table: Table,
  mutateSpec: ISpecification<Table, ITableSpecVisitor>
) => Promise<Result<void, string>>;

type TableUpdateTarget =
  | {
      table: Table;
    }
  | {
      baseId: BaseId;
      tableId: TableId;
    };

type TableUpdateFlowOptions = {
  publishEvents?: boolean;
  deferPublish?: boolean;
  prepare?: TableUpdateTransactionHook;
};

export type TableUpdateFlowResult = {
  table: Table;
  events: ReadonlyArray<IDomainEvent>;
};

@injectable()
// Application service: wraps transactional table updates, persistence, schema changes, and events.
// Mutations are provided by domain code; this class only orchestrates ports.
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
    context: IExecutionContext,
    target: TableUpdateTarget,
    mutate: TableUpdateMutate,
    inTransaction?: TableUpdateTransactionHook,
    options?: TableUpdateFlowOptions
  ): Promise<Result<TableUpdateFlowResult, string>> {
    const tableRepository = this.tableRepository;
    const tableSchemaRepository = this.tableSchemaRepository;
    const unitOfWork = this.unitOfWork;
    const eventBus = this.eventBus;
    const resolveTable = this.resolveTable.bind(this);
    const result = await safeTry<TableUpdateFlowResult, string>(async function* () {
      const table = yield* await resolveTable(context, target);
      const span = context.tracer?.startSpan('teable.TableUpdateFlow.mutate');
      const updated = yield* mutate(table);
      span?.end();
      const updatedTable = updated.table;
      const mutateSpec = updated.mutateSpec;
      yield* await unitOfWork.withTransaction(context, async (transactionContext) => {
        const resultAsync = safeTry<void, string>(async function* () {
          if (options?.prepare) {
            yield* await options.prepare(transactionContext, updatedTable, mutateSpec);
          }
          const updateResult = await tableRepository.updateOne(
            transactionContext,
            updatedTable,
            mutateSpec
          );
          if (updateResult.isErr()) {
            if (updateResult.error === 'Not found') return err('Table not found');
            return err(updateResult.error);
          }
          yield* await tableSchemaRepository.update(transactionContext, updatedTable, mutateSpec);
          if (inTransaction) {
            yield* await inTransaction(transactionContext, updatedTable, mutateSpec);
          }
          return ok(undefined);
        });
        return await resultAsync;
      });
      const events = updatedTable.pullDomainEvents();
      const shouldPublish = options?.deferPublish ? false : options?.publishEvents ?? true;
      if (shouldPublish) {
        yield* await eventBus.publishMany(context, events);
      }
      return ok({ table: updatedTable, events });
    });
    return result;
  }

  private async resolveTable(
    context: IExecutionContext,
    target: TableUpdateTarget
  ): Promise<Result<Table, string>> {
    if ('table' in target) return ok(target.table);

    const tableRepository = this.tableRepository;
    const result = await safeTry<Table, string>(async function* () {
      const whereSpec = yield* TableAggregate.specs(target.baseId).byId(target.tableId).build();
      const tableResult = await tableRepository.findOne(context, whereSpec);
      if (tableResult.isErr()) {
        if (tableResult.error === 'Not found') return err('Table not found');
        return err(tableResult.error);
      }
      return ok(tableResult.value);
    });
    return result;
  }
}
