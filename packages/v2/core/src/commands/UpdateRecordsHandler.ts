import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordBulkUpdateService } from '../application/services/RecordBulkUpdateService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { type IExecutionContext } from '../ports/ExecutionContext';
import {
  NoopTableSchemaCoordination,
  type ITableSchemaCoordination,
} from '../ports/TableSchemaCoordination';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateRecordsCommand } from './UpdateRecordsCommand';

export class UpdateRecordsResult {
  private constructor(
    readonly updatedCount: number,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly records?: ReadonlyArray<TableRecord>,
    readonly fieldKeyMapping: FieldKeyMapping = new Map()
  ) {}

  static create(
    updatedCount: number,
    events: ReadonlyArray<IDomainEvent>,
    records?: ReadonlyArray<TableRecord>,
    fieldKeyMapping: FieldKeyMapping = new Map()
  ) {
    return new UpdateRecordsResult(
      updatedCount,
      [...events],
      records ? [...records] : undefined,
      fieldKeyMapping
    );
  }
}

@CommandHandler(UpdateRecordsCommand)
@injectable()
export class UpdateRecordsHandler implements ICommandHandler<
  UpdateRecordsCommand,
  UpdateRecordsResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordBulkUpdateService)
    private readonly recordBulkUpdateService: RecordBulkUpdateService,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination()
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: UpdateRecordsCommand
  ): Promise<Result<UpdateRecordsResult, DomainError>> {
    // Row-order preparation performs CREATE INDEX CONCURRENTLY; a held
    // coordination snapshot would block it. Keep this path outside the lease.
    if (command.order != null) {
      return this.execute(context, command);
    }

    // T7946: take the table lease before the bulk path reads table metadata.
    // Only the command table is covered; link foreign tables read later for
    // typecast title fill are not part of this lease.
    const mode = command.typecast ? 'exclusive' : 'shared';
    const leaseResult = await this.tableSchemaCoordination.acquire(
      context,
      [command.tableId.toString()],
      mode
    );
    if (leaseResult.isErr()) {
      return err(leaseResult.error);
    }

    const lease = leaseResult.value;
    try {
      return await this.execute(context, command);
    } finally {
      await lease.release();
    }
  }

  private async execute(
    context: IExecutionContext,
    command: UpdateRecordsCommand
  ): Promise<Result<UpdateRecordsResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured

    return safeTry<UpdateRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      const result = yield* await handler.recordBulkUpdateService.update(context, {
        table,
        fieldValues: command.fieldValues,
        filter: command.filter,
        recordIds: command.recordIds,
        records: command.records,
        typecast: command.typecast,
        deferComputedUpdates: command.deferComputedUpdates,
        enqueueDeferredComputedUpdates: command.enqueueDeferredComputedUpdates,
        fieldKeyType: command.fieldKeyType,
        order: command.order,
        recordWritePluginRunnerOptions: command.recordWritePluginRunnerOptions,
      });

      return ok(
        UpdateRecordsResult.create(
          result.updatedCount,
          result.events,
          result.records,
          result.fieldKeyMapping ?? new Map()
        )
      );
    });
  }
}
