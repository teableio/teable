import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UndoRedoService } from '../application/services/UndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type {
  RecordFieldChangeDTO,
  RecordUpdateDTO,
} from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  type UndoRedoCommandLeafData,
} from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { buildRecordConditionSpec } from '../queries/RecordFilterMapper';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateRecordsCommand } from './UpdateRecordsCommand';

const BULK_UPDATE_SYNTHETIC_RECORD_ID = RecordId.create(`rec${'0'.repeat(16)}`)._unsafeUnwrap();

export class UpdateRecordsResult {
  private constructor(
    readonly updatedCount: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(updatedCount: number, events: ReadonlyArray<IDomainEvent>) {
    return new UpdateRecordsResult(updatedCount, [...events]);
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
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.recordWriteUndoRedoPlanService)
    private readonly recordWriteUndoRedoPlanService: RecordWriteUndoRedoPlanService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateRecordsCommand
  ): Promise<Result<UpdateRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      const filterSpec = command.recordIds
        ? RecordByIdsSpec.create(command.recordIds)
        : yield* buildRecordConditionSpec(table, command.filter!);

      const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
        table,
        Object.fromEntries(command.fieldValues),
        command.fieldKeyType
      );
      const resolvedFieldValues = new Map(Object.entries(resolvedFields));
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.updateMany,
        executionContext: context,
        table,
        payload: {
          fieldValues: resolvedFieldValues,
          fieldKeyType: command.fieldKeyType,
          typecast: command.typecast,
          recordIds: command.recordIds,
          recordCount: command.recordIds?.length,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<
            {
              updatedCount: number;
              tableEvents: ReadonlyArray<IDomainEvent>;
              eventData: ReadonlyArray<RecordUpdateDTO>;
              sideEffectUndoRedoPlan: {
                readonly undoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
                readonly redoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
              };
            },
            DomainError
          >(async function* () {
            const sideEffectResult = yield* handler.recordWriteSideEffectService.execute(
              transactionContext,
              table,
              [resolvedFieldValues],
              command.typecast
            );
            const tableForUpdate = sideEffectResult.table;
            const tableUpdateResult = sideEffectResult.updateResult;

            const specBuildResult = yield* tableForUpdate.updateRecord(
              BULK_UPDATE_SYNTHETIC_RECORD_ID,
              resolvedFieldValues,
              {
                typecast: command.typecast,
              }
            );

            let mutateSpec = specBuildResult.mutateSpec;
            let updatedRecord = specBuildResult.record;
            const needsResolution =
              yield* handler.recordMutationSpecResolver.needsResolution(mutateSpec);
            if (needsResolution) {
              mutateSpec = yield* await handler.recordMutationSpecResolver.resolveAndReplace(
                transactionContext,
                mutateSpec
              );
              updatedRecord = yield* mutateSpec.mutate(updatedRecord);
            }

            const mutationResult = yield* await handler.tableRecordRepository.updateMany(
              transactionContext,
              tableForUpdate,
              filterSpec,
              mutateSpec
            );

            if (mutationResult.updatedRecordIds.length === 0) {
              return ok({
                updatedCount: 0,
                tableEvents: [],
                eventData: [],
                sideEffectUndoRedoPlan: { undoCommands: [], redoCommands: [] },
              });
            }

            const updatedFieldValues = new Map<string, unknown>();
            for (const entry of updatedRecord.fields().entries()) {
              updatedFieldValues.set(entry.fieldId.toString(), entry.value.toValue());
            }

            let tableEvents: ReadonlyArray<IDomainEvent> = [];
            let sideEffectUndoRedoPlan: {
              readonly undoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
              readonly redoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
            } = { undoCommands: [], redoCommands: [] };
            if (tableUpdateResult) {
              const tableFlowResult = yield* await handler.tableUpdateFlow.execute(
                transactionContext,
                { table },
                () => ok(tableUpdateResult),
                { publishEvents: false }
              );
              tableEvents = tableFlowResult.events;
              sideEffectUndoRedoPlan =
                yield* await handler.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
                  transactionContext,
                  table,
                  tableForUpdate,
                  sideEffectResult.effects
                );
            }
            yield* await pluginExecution.beforePersist(transactionContext);

            const eventData: RecordUpdateDTO[] = mutationResult.updatedRecords.map((record) => {
              const changes: RecordFieldChangeDTO[] = [];
              for (const [fieldId, newValue] of updatedFieldValues.entries()) {
                changes.push({
                  fieldId,
                  oldValue: record.oldFieldValues[fieldId],
                  newValue,
                });
              }
              return {
                recordId: record.recordId.toString(),
                oldVersion: record.oldVersion,
                newVersion: record.newVersion,
                changes,
              };
            });

            return ok({
              updatedCount: mutationResult.totalUpdated,
              tableEvents,
              eventData,
              sideEffectUndoRedoPlan,
            });
          });
        }
      );

      const events: IDomainEvent[] = [...transactionResult.tableEvents];
      if (transactionResult.eventData.length > 0) {
        events.push(
          RecordsBatchUpdated.create({
            tableId: table.id(),
            baseId: table.baseId(),
            updates: transactionResult.eventData,
            source: 'user',
          })
        );
      }

      if (events.length > 0) {
        yield* await handler.eventBus.publishMany(context, events);
      }

      if (transactionResult.eventData.length > 0) {
        const buildUpdateCommand = (recordId: string, fields: Record<string, unknown>) =>
          createUndoRedoCommand('UpdateRecord', {
            tableId: table.id().toString(),
            recordId,
            fields,
            fieldKeyType: 'id',
            typecast: false,
          });

        const undoCommands = transactionResult.eventData.map((update) =>
          buildUpdateCommand(
            update.recordId,
            Object.fromEntries(update.changes.map((change) => [change.fieldId, change.oldValue]))
          )
        );
        const redoCommands = transactionResult.eventData.map((update) =>
          buildUpdateCommand(
            update.recordId,
            Object.fromEntries(update.changes.map((change) => [change.fieldId, change.newValue]))
          )
        );

        yield* await handler.undoRedoService.recordEntry(context, table.id(), {
          undoCommand: composeUndoRedoCommands([
            ...undoCommands,
            ...transactionResult.sideEffectUndoRedoPlan.undoCommands,
          ]),
          redoCommand: composeUndoRedoCommands([
            ...transactionResult.sideEffectUndoRedoPlan.redoCommands,
            ...redoCommands,
          ]),
        });
      }
      await pluginExecution.afterCommit();

      return ok(UpdateRecordsResult.create(transactionResult.updatedCount, events));
    });
  }
}
