import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import {
  type IForeignTableLoaderService,
  NullForeignTableLoaderService,
} from '../application/services/ForeignTableLoaderService';
import { type IRecordChangedValueDecoratorService } from '../application/services/RecordChangedValueDecoratorService';
import { mergeRecordFieldValues } from '../application/services/recordEventFieldValues';
import { requireStoredRecordSnapshots } from '../application/services/RecordMutationSnapshotContract';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { RecordCreated } from '../domain/table/events/RecordCreated';
import {
  RecordCreated as RecordCreatedEvent,
  isRecordCreatedEvent,
} from '../domain/table/events/RecordCreated';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { BatchRecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import type { RecordFieldValues } from './CreateRecordCommand';
import { CreateRecordsCommand } from './CreateRecordsCommand';
import {
  buildOperationBatchMutation,
  withBatchMutation,
} from './shared/batchMutationOrchestration';

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
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordChangedValueDecoratorService)
    private readonly recordChangedValueDecoratorService: IRecordChangedValueDecoratorService,
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
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: IForeignTableLoaderService = new NullForeignTableLoaderService()
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
            const batchMutation = buildOperationBatchMutation(context, records.length);
            const transactionContextWithBatchMutation = withBatchMutation(
              transactionContext,
              batchMutation
            );
            let tableEvents: ReadonlyArray<IDomainEvent> = [];
            if (tableUpdateResult) {
              const tableFlowResult = yield* await handler.tableUpdateFlow.execute(
                transactionContextWithBatchMutation,
                { table },
                () => ok(tableUpdateResult),
                { publishEvents: false }
              );
              tableEvents = tableFlowResult.events;
            }
            yield* await pluginExecution.beforePersist(transactionContextWithBatchMutation);
            const fillLinkTitleForeignTables = command.typecast
              ? yield* await handler.foreignTableLoaderService.loadForLinkTitleFill(
                  transactionContextWithBatchMutation,
                  mutateSpecs
                )
              : new Map();
            const mutation = yield* await handler.tableRecordRepository.insertMany(
              transactionContextWithBatchMutation,
              tableForCreate,
              records,
              {
                ...(command.order ? { order: command.order } : {}),
                ...(command.typecast ? { fillLinkTitles: true } : {}),
                ...(fillLinkTitleForeignTables.size > 0 ? { fillLinkTitleForeignTables } : {}),
              }
            );
            return ok({ mutation, tableEvents });
          });
        }
      );

      // 5. Pull events from Table aggregate root and aggregate RecordCreated events
      const decoratedChangedFieldsByRecord =
        yield* await handler.recordChangedValueDecoratorService.decorateChangedFieldsByRecord(
          tableForCreate,
          mutationResult.mutation.changedFieldsByRecord
        );
      const rawEvents = tableForCreate.pullDomainEvents().map((event) =>
        isRecordCreatedEvent(event)
          ? RecordCreatedEvent.create({
              tableId: event.tableId,
              baseId: event.baseId,
              recordId: event.recordId,
              fieldValues: mergeRecordFieldValues(
                event.fieldValues,
                decoratedChangedFieldsByRecord?.get(event.recordId.toString())
              ),
              source: event.source,
            })
          : event
      );

      // Aggregate multiple RecordCreated events into a single RecordsBatchCreated event
      const recordCreatedEvents: RecordCreated[] = [];
      const otherEvents: IDomainEvent[] = [];

      for (const event of rawEvents) {
        if (isRecordCreatedEvent(event)) {
          const recordId = event.recordId.toString();
          const recordFieldChanges = new Map<string, unknown>();
          for (const [fieldId, value] of decoratedChangedFieldsByRecord?.get(recordId) ?? []) {
            recordFieldChanges.set(fieldId, value);
          }
          for (const [fieldId, value] of mutationResult.mutation.computedChangesByRecord?.get(
            recordId
          ) ?? []) {
            recordFieldChanges.set(fieldId, value);
          }
          const mergedRecordFieldChanges =
            recordFieldChanges.size > 0 ? recordFieldChanges : undefined;
          recordCreatedEvents.push(
            RecordCreatedEvent.create({
              tableId: event.tableId,
              baseId: event.baseId,
              recordId: event.recordId,
              fieldValues: mergeRecordFieldValues(event.fieldValues, mergedRecordFieldChanges),
              source: event.source,
            })
          );
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
          orchestration: buildOperationBatchMutation(context, records.length),
        });
        events = [batchEvent, ...otherEvents];
      } else {
        // Keep a single RecordCreated event, but preserve decorated and computed field values.
        events = [...recordCreatedEvents, ...otherEvents];
      }

      const storedSnapshots = yield* requireStoredRecordSnapshots(
        {
          operation: 'create',
          tableId: table.id().toString(),
          expectedCount: records.length,
        },
        mutationResult.mutation.recordSnapshots
      );
      const mergedEvents = [...mutationResult.tableEvents, ...events];
      yield* await handler.eventBus.publishMany(context, mergedEvents);

      yield* await handler.undoRedoStackService.appendRecordCreate(
        toUndoRedoStackAppendContext(context),
        {
          tableId: table.id(),
          createdRecords: storedSnapshots,
          undoCommandsAfter: sideEffectUndoRedoPlan.undoCommands,
          redoCommandsBefore: sideEffectUndoRedoPlan.redoCommands,
        }
      );
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
