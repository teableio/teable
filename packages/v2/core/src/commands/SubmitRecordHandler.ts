import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordCreationService } from '../application/services/RecordCreationService';
import { sharedRecordWritePlan } from '../application/services/RecordWriteCoordinationPlan';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { withRecordWriteCoordination } from '../application/services/withRecordWriteCoordination';
import type { DomainError } from '../domain/shared/DomainError';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import {
  NoopTableSchemaCoordination,
  type ITableSchemaCoordination,
} from '../ports/TableSchemaCoordination';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateRecordResult } from './CreateRecordHandler';
import { SubmitRecordCommand } from './SubmitRecordCommand';

export type SubmitRecordResult = CreateRecordResult;

@CommandHandler(SubmitRecordCommand)
@injectable()
export class SubmitRecordHandler implements ICommandHandler<
  SubmitRecordCommand,
  SubmitRecordResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordCreationService)
    private readonly recordCreationService: RecordCreationService,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: SubmitRecordCommand
  ): Promise<Result<SubmitRecordResult, DomainError>> {
    return withRecordWriteCoordination({
      context,
      tableId: command.tableId,
      coordination: this.tableSchemaCoordination,
      initialPlan: sharedRecordWritePlan,
      loadTable: () => this.tableQueryService.getById(context, command.tableId),
      planForTable: (table) =>
        this.recordWriteSideEffectService.planCreateCoordination(context, table, {
          recordsFieldValues: [command.fieldValues],
          fieldKeyType: FieldKeyType.Id,
          typecast: command.typecast,
          conservativeOnProbeError: false,
        }),
      execute: (table) => this.executeSubmit(context, command, table),
    });
  }

  private async executeSubmit(
    context: ExecutionContextPort.IExecutionContext,
    command: SubmitRecordCommand,
    table: Table
  ): Promise<Result<SubmitRecordResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured

    return safeTry<SubmitRecordResult, DomainError>(async function* () {
      yield* table.validateFormSubmission(command.formId.toString(), command.fieldValues);

      const createResult = yield* await handler.recordCreationService.create(context, {
        table,
        fieldValues: command.fieldValues,
        fieldKeyType: FieldKeyType.Id,
        typecast: command.typecast,
        operationKind: RecordWriteOperationKind.submit,
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
