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
import { CreateTableCommand } from './CreateTableCommand';

export class CreateTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): CreateTableResult {
    return new CreateTableResult(table, [...events]);
  }
}

@CommandHandler(CreateTableCommand)
@injectable()
export class CreateTableHandler implements ICommandHandler<CreateTableCommand, CreateTableResult> {
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
    command: CreateTableCommand
  ): Promise<Result<CreateTableResult, string>> {
    this.logger.info('CreateTableHandler.start', {
      actorId: context.actorId.toString(),
      baseId: command.baseId.toString(),
      tableName: command.tableName.toString(),
      fieldCount: command.fields.length,
      viewCount: command.views.length,
    });

    const tableResult = this.buildTable(command);
    if (tableResult.isErr()) return err(tableResult.error);
    const table = tableResult.value;

    const transactionResult = await this.unitOfWork.withTransaction(
      context,
      async (transactionContext) => {
        const insertResult = await this.tableRepository.insert(transactionContext, table);
        if (insertResult.isErr()) return err(insertResult.error);

        const schemaResult = await this.tableSchemaRepository.insert(transactionContext, table);
        if (schemaResult.isErr()) return err(schemaResult.error);

        return ok(undefined);
      }
    );
    if (transactionResult.isErr()) return err(transactionResult.error);

    const events = table.pullDomainEvents();

    const publishResult = await this.eventBus.publishMany(context, events);
    if (publishResult.isErr()) return err(publishResult.error);

    this.logger.info('CreateTableHandler.success', {
      baseId: command.baseId.toString(),
      tableId: table.id().toString(),
      eventCount: events.length,
    });

    return ok(CreateTableResult.create(table, events));
  }

  private buildTable(command: CreateTableCommand): Result<Table, string> {
    const builder = TableAggregate.builder().withBaseId(command.baseId).withName(command.tableName);

    for (const fieldSpec of command.fields) {
      fieldSpec.applyTo(builder);
    }

    for (const viewSpec of command.views) {
      viewSpec.applyTo(builder);
    }

    return builder.build();
  }
}
