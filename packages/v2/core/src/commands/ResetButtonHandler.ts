import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { requireRecordUpdateSnapshot } from '../application/services/RecordMutationSnapshotContract';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { RecordFieldChangeDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordUpdated } from '../domain/table/events/RecordUpdated';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ResetButtonCommand } from './ResetButtonCommand';
import { toTableRecord } from './shared/toTableRecord';

export class ResetButtonResult {
  private constructor(
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(record: TableRecord, events: ReadonlyArray<IDomainEvent>): ResetButtonResult {
    return new ResetButtonResult(record, [...events]);
  }
}

@CommandHandler(ResetButtonCommand)
@injectable()
export class ResetButtonHandler implements ICommandHandler<ResetButtonCommand, ResetButtonResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: ResetButtonCommand
  ): Promise<Result<ResetButtonResult, DomainError>> {
    const handler = this;
    return safeTry<ResetButtonResult, DomainError>(async function* () {
      const tableSpec = yield* Table.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const reset = yield* table.resetButtonValue({
        recordId: command.recordId,
        fieldId: command.fieldId,
      });
      const currentRecord = yield* await handler.tableRecordQueryRepository.findOne(
        context,
        table,
        command.recordId,
        { mode: 'stored' }
      );
      const currentRecordEntity = yield* toTableRecord(table, currentRecord);
      const responseRecord = yield* reset.mutateSpec.mutate(currentRecordEntity);
      const fieldValues = new Map<string, unknown>([[command.fieldId.toString(), null]]);
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.updateOne,
        executionContext: context,
        table,
        payload: {
          recordId: command.recordId,
          fieldValues,
          fieldKeyType: FieldKeyType.Id,
          typecast: false,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      const recordSpec = yield* pluginExecution.getRecordSpec();
      if (recordSpec && !recordSpec.isSatisfiedBy(currentRecordEntity)) {
        return err(
          domainError.forbidden({
            code: 'record_write_plugin.scope_forbidden',
            message: 'Button reset is outside the allowed Record scope.',
          })
        );
      }
      const allowedFieldIds =
        yield* pluginExecution.getUpdateFieldIdsForRecord(currentRecordEntity);
      if (allowedFieldIds && !allowedFieldIds.has(command.fieldId.toString())) {
        return err(
          domainError.forbidden({
            code: 'record_write_plugin.update_fields_forbidden',
            message: 'Button reset is outside the allowed Field scope.',
          })
        );
      }
      if (currentRecord.fields[command.fieldId.toString()] == null) {
        return ok(ResetButtonResult.create(responseRecord, []));
      }

      const mutation = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          safeTry<TableRecordRepositoryPort.RecordMutationResult, DomainError>(async function* () {
            yield* await pluginExecution.beforePersist(transactionContext);
            const result = yield* await handler.tableRecordRepository.updateOne(
              transactionContext,
              table,
              command.recordId,
              reset.mutateSpec,
              { expectedVersion: currentRecord.version }
            );
            if (result.mutationApplied === false) {
              return err(
                domainError.conflict({
                  code: 'button.reset_conflict',
                  message: 'Button changed while resetting its count.',
                })
              );
            }
            return ok(result);
          })
      );
      const snapshot = yield* requireRecordUpdateSnapshot(
        {
          operation: 'update',
          tableId: table.id().toString(),
          recordId: command.recordId.toString(),
        },
        mutation.updateSnapshot
      );
      const changes: RecordFieldChangeDTO[] = [
        {
          fieldId: command.fieldId.toString(),
          oldValue: snapshot.previous.fields[command.fieldId.toString()],
          newValue: snapshot.current.fields[command.fieldId.toString()],
        },
      ];
      const events: IDomainEvent[] = [
        RecordUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordId: command.recordId,
          oldVersion: snapshot.oldVersion,
          newVersion: snapshot.newVersion,
          changes,
          source: 'user',
        }),
      ];
      yield* await handler.eventBus.publishMany(context, events);
      yield* await handler.undoRedoStackService.appendButtonValueUpdateFromSnapshot(
        toUndoRedoStackAppendContext(context),
        {
          tableId: table.id(),
          recordId: command.recordId,
          snapshot,
          fieldId: command.fieldId.toString(),
        }
      );
      await pluginExecution.afterCommit();
      return ok(ResetButtonResult.create(responseRecord, events));
    });
  }
}
