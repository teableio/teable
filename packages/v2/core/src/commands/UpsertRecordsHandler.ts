import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import {
  RecordUpsertService,
  type IRecordUpsertRowResult,
} from '../application/services/RecordUpsertService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpsertRecordsCommand } from './UpsertRecordsCommand';

export interface IRecordUpsertSummary {
  readonly requested: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
}

export class UpsertRecordsResult {
  private constructor(
    readonly results: ReadonlyArray<IRecordUpsertRowResult>,
    readonly summary: IRecordUpsertSummary,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly fieldKeyMapping: FieldKeyMapping
  ) {}

  static create(
    results: ReadonlyArray<IRecordUpsertRowResult>,
    events: ReadonlyArray<IDomainEvent>,
    fieldKeyMapping: FieldKeyMapping = new Map()
  ): UpsertRecordsResult {
    const summary: IRecordUpsertSummary = {
      requested: results.length,
      created: results.filter((result) => result.status === 'created').length,
      updated: results.filter((result) => result.status === 'updated').length,
      unchanged: results.filter((result) => result.status === 'unchanged').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
    };
    return new UpsertRecordsResult([...results], summary, [...events], fieldKeyMapping);
  }
}

@CommandHandler(UpsertRecordsCommand)
@injectable()
export class UpsertRecordsHandler implements ICommandHandler<
  UpsertRecordsCommand,
  UpsertRecordsResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordUpsertService)
    private readonly recordUpsertService: RecordUpsertService
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: UpsertRecordsCommand
  ): Promise<Result<UpsertRecordsResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<UpsertRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      const upsertResult = yield* await handler.recordUpsertService.upsert(context, {
        table,
        recordsFieldValues: command.recordsFieldValues,
        matchFieldId: command.matchFieldId,
        onConflict: command.onConflict,
        fieldKeyType: command.fieldKeyType,
        typecast: command.typecast,
      });

      const fieldKeyMapping: FieldKeyMapping =
        command.fieldKeyType === FieldKeyType.Id
          ? new Map()
          : new Map(
              table
                .getFields()
                .map((field) => [
                  field.id().toString(),
                  FieldKeyResolverService.getFieldKey(field, command.fieldKeyType),
                ])
            );

      return ok(
        UpsertRecordsResult.create(upsertResult.results, upsertResult.events, fieldKeyMapping)
      );
    });
  }
}
