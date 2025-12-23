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
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteTableCommand } from './DeleteTableCommand';

export class DeleteTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): DeleteTableResult {
    return new DeleteTableResult(table, [...events]);
  }
}

@CommandHandler(DeleteTableCommand)
@injectable()
export class DeleteTableHandler implements ICommandHandler<DeleteTableCommand, DeleteTableResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: DeleteTableCommand
  ): Promise<Result<DeleteTableResult, string>> {
    this.logger.debug('DeleteTableHandler.start', {
      actorId: context.actorId.toString(),
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
    });

    const specResult = TableAggregate.specs(command.baseId).byId(command.tableId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (tableResult.error === 'Not found') return err('Table not found');
      return err(tableResult.error);
    }
    const table = tableResult.value;

    const transactionResult = await this.unitOfWork.withTransaction(
      context,
      async (transactionContext) => {
        const schemaResult = await this.tableSchemaRepository.delete(transactionContext, table);
        if (schemaResult.isErr()) return err(schemaResult.error);

        const deleteResult = await this.tableRepository.delete(transactionContext, table);
        if (deleteResult.isErr()) return err(deleteResult.error);

        return ok(undefined);
      }
    );
    if (transactionResult.isErr()) return err(transactionResult.error);

    const markResult = table.markDeleted();
    if (markResult.isErr()) return err(markResult.error);

    const events = table.pullDomainEvents();
    const publishResult = await this.eventBus.publishMany(context, events);
    if (publishResult.isErr()) return err(publishResult.error);

    this.logger.debug('DeleteTableHandler.success', {
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      eventCount: events.length,
    });

    return ok(DeleteTableResult.create(table, events));
  }
}
