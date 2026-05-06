import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordBulkUpdateService } from '../application/services/RecordBulkUpdateService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { type IExecutionContext } from '../ports/ExecutionContext';
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
export class UpdateRecordsHandler
  implements ICommandHandler<UpdateRecordsCommand, UpdateRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordBulkUpdateService)
    private readonly recordBulkUpdateService: RecordBulkUpdateService
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: UpdateRecordsCommand
  ): Promise<Result<UpdateRecordsResult, DomainError>> {
    const handler = this;

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
