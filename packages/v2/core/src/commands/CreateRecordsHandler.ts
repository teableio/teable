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
import { DomainEventName } from '../domain/shared/DomainEventName';
import type { RecordCreated } from '../domain/table/events/RecordCreated';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { BatchRecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { composeUndoRedoCommands, createUndoRedoCommand } from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import type { RecordFieldValues } from './CreateRecordCommand';
import { CreateRecordsCommand } from './CreateRecordsCommand';

export class CreateRecordsResult {
  private constructor(
    readonly records: ReadonlyArray<TableRecord>,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly fieldKeyMapping: FieldKeyMapping,
    readonly computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ) {}

  static create(
    records: ReadonlyArray<TableRecord>,
    events: ReadonlyArray<IDomainEvent>,
    fieldKeyMapping: FieldKeyMapping = new Map(),
    computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ): CreateRecordsResult {
    return new CreateRecordsResult(
      [...records],
      [...events],
      fieldKeyMapping,
      computedChangesByRecord
    );
  }
}

@CommandHandler(CreateRecordsCommand)
@injectable()
export class CreateRecordsHandler
  implements ICommandHandler<CreateRecordsCommand, CreateRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
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
    command: CreateRecordsCommand
  ): Promise<Result<CreateRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<CreateRecordsResult, DomainError>(async function* () {
      // 1. Get the table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // Resolve field keys to field IDs if using name or dbFieldName
      const resolvedRecordsFieldValues: RecordFieldValues[] = [];
      for (const recordFieldValues of command.recordsFieldValues) {
        const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
          table,
          Object.fromEntries(recordFieldValues),
          command.fieldKeyType
        );
        resolvedRecordsFieldValues.push(new Map(Object.entries(resolvedFields)));
      }
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.createMany,
        executionContext: context,
        table,
        payload: {
          recordsFieldValues: resolvedRecordsFieldValues,
          fieldKeyType: command.fieldKeyType,
          typecast: command.typecast,
          order: command.order,
          recordCount: resolvedRecordsFieldValues.length,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const sideEffectResult = yield* handler.recordWriteSideEffectService.execute(
        context,
        table,
        resolvedRecordsFieldValues,
        command.typecast
      );
      const tableForCreate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;
      const sideEffectUndoRedoPlan =
        yield* await handler.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
          context,
          table,
          tableForCreate,
          sideEffectResult.effects
        );

      // 2. Create all records (validates and applies field values internally)
      const {
        records: createdRecords,
        fieldKeyMapping,
        mutateSpecs,
      } = yield* tableForCreate.createRecords(resolvedRecordsFieldValues, {
        typecast: command.typecast,
      });

      // 3. Resolve values that require external lookups (user/link)
      const records: TableRecord[] = [];
      for (let i = 0; i < createdRecords.length; i++) {
        let record = createdRecords[i]!;
        const mutateSpec = mutateSpecs[i];
        if (mutateSpec) {
          const needsResolution =
            yield* handler.recordMutationSpecResolver.needsResolution(mutateSpec);
          if (needsResolution) {
            const resolvedSpec = yield* await handler.recordMutationSpecResolver.resolveAndReplace(
              context,
              mutateSpec
            );
            // Re-apply the resolved spec to get the correct record values
            record = yield* resolvedSpec.mutate(record);
          }
        }
        records.push(record);
      }

      // Build extended field key mapping that includes all fields (including computed fields)
      // This ensures computed field values can be keyed by field name when fieldKeyType is 'name'
      let extendedFieldKeyMapping: FieldKeyMapping = new Map(fieldKeyMapping);
      if (command.fieldKeyType !== FieldKeyType.Id) {
        extendedFieldKeyMapping = new Map();
        for (const field of tableForCreate.getFields()) {
          const fieldIdStr = field.id().toString();
          const key = FieldKeyResolverService.getFieldKey(field, command.fieldKeyType);
          extendedFieldKeyMapping.set(fieldIdStr, key);
        }
      }

      // 4. Persist all records within a transaction
      const mutationResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<
            {
              mutation: BatchRecordMutationResult;
              tableEvents: ReadonlyArray<IDomainEvent>;
            },
            DomainError
          >(async function* () {
            let tableEvents: ReadonlyArray<IDomainEvent> = [];
            if (tableUpdateResult) {
              const tableFlowResult = yield* await handler.tableUpdateFlow.execute(
                transactionContext,
                { table },
                () => ok(tableUpdateResult),
                { publishEvents: false }
              );
              tableEvents = tableFlowResult.events;
            }
            yield* await pluginExecution.beforePersist(transactionContext);
            const mutation = yield* await handler.tableRecordRepository.insertMany(
              transactionContext,
              tableForCreate,
              records,
              command.order ? { order: command.order } : undefined
            );
            return ok({ mutation, tableEvents });
          });
        }
      );

      // 5. Pull events from Table aggregate root and aggregate RecordCreated events
      const rawEvents = tableForCreate.pullDomainEvents();

      // Aggregate multiple RecordCreated events into a single RecordsBatchCreated event
      const recordCreatedEvents: RecordCreated[] = [];
      const otherEvents: IDomainEvent[] = [];

      for (const event of rawEvents) {
        if (event.name.equals(DomainEventName.recordCreated())) {
          recordCreatedEvents.push(event as RecordCreated);
        } else {
          otherEvents.push(event);
        }
      }

      let events: IDomainEvent[];
      if (recordCreatedEvents.length > 1) {
        const source = recordCreatedEvents[0]?.source ?? { type: 'user' };
        // Aggregate multiple RecordCreated events into a single RecordsBatchCreated event
        const batchEvent = RecordsBatchCreated.create({
          tableId: tableForCreate.id(),
          baseId: tableForCreate.baseId(),
          records: recordCreatedEvents.map((e) => ({
            recordId: e.recordId.toString(),
            fields: e.fieldValues,
            orders: mutationResult.mutation.recordOrders?.get(e.recordId.toString()),
          })),
          source,
        });
        events = [batchEvent, ...otherEvents];
      } else {
        // Keep single RecordCreated event as-is
        events = rawEvents;
      }

      const mergedEvents = [...mutationResult.tableEvents, ...events];
      yield* await handler.eventBus.publishMany(context, mergedEvents);

      const restoreSnapshotResult = await handler.tableRecordQueryRepository.find(
        context,
        tableForCreate,
        RecordByIdsSpec.create(records.map((record) => record.id())),
        { mode: 'stored', includeOrders: true }
      );
      const restoreSnapshotRecords = yield* restoreSnapshotResult;
      const restoreSnapshotMap = new Map(
        restoreSnapshotRecords.records.map((record) => [record.id, record])
      );
      const recordSnapshots = records.map((record) => {
        const snapshot = restoreSnapshotMap.get(record.id().toString());
        if (!snapshot) {
          const fields: Record<string, unknown> = {};
          for (const entry of record.fields().entries()) {
            fields[entry.fieldId.toString()] = entry.value.toValue();
          }
          return {
            recordId: record.id().toString(),
            fields,
          };
        }

        return {
          recordId: record.id().toString(),
          fields: snapshot.fields,
          ...(snapshot.orders ? { orders: snapshot.orders } : {}),
          ...(snapshot.autoNumber !== undefined ? { autoNumber: snapshot.autoNumber } : {}),
          ...(snapshot.createdTime ? { createdTime: snapshot.createdTime } : {}),
          ...(snapshot.createdBy ? { createdBy: snapshot.createdBy } : {}),
          ...(snapshot.lastModifiedTime ? { lastModifiedTime: snapshot.lastModifiedTime } : {}),
          ...(snapshot.lastModifiedBy ? { lastModifiedBy: snapshot.lastModifiedBy } : {}),
        };
      });

      yield* await handler.undoRedoService.recordEntry(context, table.id(), {
        undoCommand: composeUndoRedoCommands([
          createUndoRedoCommand('DeleteRecords', {
            tableId: table.id().toString(),
            recordIds: recordSnapshots.map((snapshot) => snapshot.recordId),
          }),
          ...sideEffectUndoRedoPlan.undoCommands,
        ]),
        redoCommand: composeUndoRedoCommands([
          ...sideEffectUndoRedoPlan.redoCommands,
          createUndoRedoCommand('RestoreRecords', {
            tableId: table.id().toString(),
            records: recordSnapshots,
          }),
        ]),
      });
      await pluginExecution.afterCommit();

      return ok(
        CreateRecordsResult.create(
          records,
          mergedEvents,
          extendedFieldKeyMapping,
          mutationResult.mutation.computedChangesByRecord
        )
      );
    });
  }
}
