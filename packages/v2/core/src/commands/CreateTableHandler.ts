import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { IEventPublisher } from '../ports/EventPublisher';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { ITableRepository } from '../ports/TableRepository';
import { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
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
    private readonly eventPublisher: IEventPublisher
  ) {}

  async handle(
    context: IExecutionContext,
    command: CreateTableCommand
  ): Promise<Result<CreateTableResult, string>> {
    const tableResult = this.buildTable(command);
    if (tableResult.isErr()) return err(tableResult.error);
    const table = tableResult.value;

    let saveResult: Result<void, string>;
    try {
      saveResult = await this.tableRepository.save(context, table);
    } catch {
      return err('Unexpected tableRepository.save error');
    }
    if (saveResult.isErr()) return err(saveResult.error);

    let schemaResult: Result<void, string>;
    try {
      schemaResult = await this.tableSchemaRepository.save(context, table);
    } catch {
      return err('Unexpected tableSchemaRepository.save error');
    }
    if (schemaResult.isErr()) return err(schemaResult.error);

    const events = table.pullDomainEvents();

    const publishResult = this.eventPublisher.publishMany(context, events);
    if (publishResult.isErr()) return err(publishResult.error);

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
