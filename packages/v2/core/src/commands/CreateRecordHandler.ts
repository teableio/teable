import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordCreationService } from '../application/services/RecordCreationService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateRecordCommand } from './CreateRecordCommand';

export class CreateRecordResult {
  private constructor(
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly fieldKeyMapping: Map<string, string>,
    readonly computedChanges?: ReadonlyMap<string, unknown>
  ) {}

  static create(
    record: TableRecord,
    events: ReadonlyArray<IDomainEvent>,
    fieldKeyMapping: Map<string, string> = new Map(),
    computedChanges?: ReadonlyMap<string, unknown>
  ): CreateRecordResult {
    return new CreateRecordResult(record, [...events], fieldKeyMapping, computedChanges);
  }
}

@CommandHandler(CreateRecordCommand)
@injectable()
export class CreateRecordHandler
  implements ICommandHandler<CreateRecordCommand, CreateRecordResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordCreationService)
    private readonly recordCreationService: RecordCreationService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateRecordCommand
  ): Promise<Result<CreateRecordResult, DomainError>> {
    const handler = this;
    return safeTry<CreateRecordResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      const result = yield* await handler.recordCreationService.create(context, {
        table,
        fieldValues: command.fieldValues,
        fieldKeyType: command.fieldKeyType,
        typecast: command.typecast,
        source: command.source,
        order: command.order,
      });

      return ok(
        CreateRecordResult.create(
          result.record,
          result.events,
          result.fieldKeyMapping,
          result.computedChanges
        )
      );
    });
  }
}
