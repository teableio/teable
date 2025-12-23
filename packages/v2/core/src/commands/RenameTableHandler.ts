import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RenameTableCommand } from './RenameTableCommand';

export class RenameTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): RenameTableResult {
    return new RenameTableResult(table, [...events]);
  }
}

@CommandHandler(RenameTableCommand)
@injectable()
export class RenameTableHandler implements ICommandHandler<RenameTableCommand, RenameTableResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: RenameTableCommand
  ): Promise<Result<RenameTableResult, string>> {
    this.logger.debug('RenameTableHandler.start', {
      actorId: context.actorId.toString(),
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      tableName: command.tableName.toString(),
    });

    const whereSpecResult = TableAggregate.specs(command.baseId).byId(command.tableId).build();
    if (whereSpecResult.isErr()) return err(whereSpecResult.error);

    const tableResult = await this.tableRepository.findOne(context, whereSpecResult.value);
    if (tableResult.isErr()) {
      if (tableResult.error === 'Not found') return err('Table not found');
      return err(tableResult.error);
    }
    const table = tableResult.value;

    const updateResult = table.update((mutator) => mutator.rename(command.tableName));
    if (updateResult.isErr()) return err(updateResult.error);

    const updatedTable = updateResult.value.table;
    const mutateSpec = updateResult.value.mutateSpec;

    const transactionResult = await this.unitOfWork.withTransaction(
      context,
      async (transactionContext) => {
        const updateResult = await this.tableRepository.updateOne(
          transactionContext,
          table,
          mutateSpec
        );
        if (updateResult.isErr()) {
          if (updateResult.error === 'Not found') return err('Table not found');
          return err(updateResult.error);
        }
        return ok(undefined);
      }
    );
    if (transactionResult.isErr()) return err(transactionResult.error);

    const events = updatedTable.pullDomainEvents();
    const publishResult = await this.eventBus.publishMany(context, events);
    if (publishResult.isErr()) return err(publishResult.error);

    this.logger.debug('RenameTableHandler.success', {
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      eventCount: events.length,
    });

    return ok(RenameTableResult.create(updatedTable, events));
  }
}
