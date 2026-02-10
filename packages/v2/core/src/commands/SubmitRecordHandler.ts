import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordCreationService } from '../application/services/RecordCreationService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateRecordResult } from './CreateRecordHandler';
import { SubmitRecordCommand } from './SubmitRecordCommand';

export type SubmitRecordResult = CreateRecordResult;

@CommandHandler(SubmitRecordCommand)
@injectable()
export class SubmitRecordHandler
  implements ICommandHandler<SubmitRecordCommand, SubmitRecordResult>
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
    command: SubmitRecordCommand
  ): Promise<Result<SubmitRecordResult, DomainError>> {
    const handler = this;

    return safeTry<SubmitRecordResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      yield* table.validateFormSubmission(command.formId.toString(), command.fieldValues);

      const createResult = yield* await handler.recordCreationService.create(context, {
        table,
        fieldValues: command.fieldValues,
        fieldKeyType: FieldKeyType.Id,
        typecast: command.typecast,
        source: {
          type: 'form',
          formId: command.formId.toString(),
        },
      });

      return ok(
        CreateRecordResult.create(
          createResult.record,
          createResult.events,
          createResult.fieldKeyMapping,
          createResult.computedChanges
        )
      );
    });
  }
}
