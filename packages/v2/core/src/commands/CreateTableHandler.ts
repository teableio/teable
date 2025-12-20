import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { IEventPublisher } from '../ports/EventPublisher';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { ILogger } from '../ports/Logger';
import { ITableRepository } from '../ports/TableRepository';
import { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { IUnitOfWork } from '../ports/UnitOfWork';
import type { CreateTableCommand } from './CreateTableCommand';

export class CreateTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): CreateTableResult {
    return new CreateTableResult(table, [...events]);
  }
}

@injectable()
export class CreateTableHandler {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: ITableSchemaRepository,
    @inject(v2CoreTokens.eventPublisher)
    private readonly eventPublisher: IEventPublisher,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: IUnitOfWork
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
        const saveResult = await this.tableRepository.save(transactionContext, table);
        if (saveResult.isErr()) return err(saveResult.error);

        const schemaResult = await this.tableSchemaRepository.save(transactionContext, table);
        if (schemaResult.isErr()) return err(schemaResult.error);

        return ok(undefined);
      }
    );
    if (transactionResult.isErr()) return err(transactionResult.error);

    const events = table.pullDomainEvents();

    const publishResult = this.eventPublisher.publishMany(context, events);
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
