import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { RecordCreated, isRecordCreatedEvent } from '../../domain/table/events/RecordCreated';
import type { RecordCreateSource } from '../../domain/table/events/RecordFieldValuesDTO';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { RecordInsertOrder } from '../../domain/table/records/RecordInsertOrder';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import * as EventBusPort from '../../ports/EventBus';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../../ports/RecordWritePlugin';
import type { RecordMutationResult } from '../../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';
import { FieldKeyResolverService } from './FieldKeyResolverService';
import {
  type IForeignTableLoaderService,
  NullForeignTableLoaderService,
} from './ForeignTableLoaderService';
import { type IRecordChangedValueDecoratorService } from './RecordChangedValueDecoratorService';
import { mergeRecordFieldValues } from './recordEventFieldValues';
import { requireStoredRecordSnapshot } from './RecordMutationSnapshotContract';
import { RecordMutationSpecResolverService } from './RecordMutationSpecResolverService';
import { RecordWritePluginRunner } from './RecordWritePluginRunner';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from './RecordWriteUndoRedoPlanService';
import { TableUpdateFlow } from './TableUpdateFlow';
import { toUndoRedoStackAppendContext, UndoRedoStackService } from './UndoRedoStackService';

type RecordCreationOperationKind =
  | typeof RecordWriteOperationKind.createOne
  | typeof RecordWriteOperationKind.submit
  | typeof RecordWriteOperationKind.duplicate;

export interface IRecordCreationInput {
  table: Table;
  fieldValues: ReadonlyMap<string, unknown>;
  fieldKeyType: FieldKeyType;
  typecast: boolean;
  source: RecordCreateSource;
  operationKind: RecordCreationOperationKind;
  sourceRecordId?: RecordId;
  order?: RecordInsertOrder;
}

export interface IRecordCreationResult {
  record: TableRecord;
  events: ReadonlyArray<IDomainEvent>;
  fieldKeyMapping: Map<string, string>;
  computedChanges?: ReadonlyMap<string, unknown>;
}

@injectable()
export class RecordCreationService {
  constructor(
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

  async create(
    context: ExecutionContextPort.IExecutionContext,
    input: IRecordCreationInput
  ): Promise<Result<IRecordCreationResult, DomainError>> {
    const service = this;

    return safeTry<IRecordCreationResult, DomainError>(async function* () {
      const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
        input.table,
        Object.fromEntries(input.fieldValues),
        input.fieldKeyType
      );
      const resolvedFieldValues = new Map(Object.entries(resolvedFields));
      const pluginExecution = yield* await service.recordWritePluginRunner.prepare(
        service.buildPluginContext(context, input, resolvedFieldValues)
      );
      yield* await pluginExecution.guard();

      const sideEffectResult = yield* service.recordWriteSideEffectService.execute(
        context,
        input.table,
        [resolvedFieldValues],
        input.typecast
      );
      const tableForCreate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;
      const sideEffectUndoRedoPlan =
        yield* await service.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
          context,
          input.table,
          tableForCreate,
          sideEffectResult.effects
        );

      const tracer = context.tracer;
      const createRecordSpan = tracer?.startSpan('teable.RecordCreationService.createRecord');
      const createResult = yield* tableForCreate.createRecord(resolvedFieldValues, {
        typecast: input.typecast,
        source: input.source,
      });

      let record = createResult.record;
      if (createResult.mutateSpec) {
        const needsResolution = yield* service.recordMutationSpecResolver.needsResolution(
          createResult.mutateSpec
        );
        if (needsResolution) {
          const resolvedSpec = yield* await service.recordMutationSpecResolver.resolveAndReplace(
            context,
            createResult.mutateSpec
          );
          record = yield* resolvedSpec.mutate(record);
        }
      }

      let mutationResult: RecordMutationResult | undefined;
      let tableEvents: ReadonlyArray<IDomainEvent> = [];
      try {
        const runTransaction = () =>
          service.unitOfWork.withTransaction(context, async (transactionContext) => {
            return safeTry<
              {
                mutation: RecordMutationResult;
                tableEvents: ReadonlyArray<IDomainEvent>;
              },
              DomainError
            >(async function* () {
              let transactionTableEvents: ReadonlyArray<IDomainEvent> = [];
              if (tableUpdateResult) {
                const tableFlowResult = yield* await service.tableUpdateFlow.execute(
                  transactionContext,
                  { table: input.table },
                  () => ok(tableUpdateResult),
                  { publishEvents: false }
                );
                transactionTableEvents = tableFlowResult.events;
              }
              yield* await pluginExecution.beforePersist(transactionContext);
              const fillLinkTitleForeignTables = input.typecast
                ? yield* await service.foreignTableLoaderService.loadForLinkTitleFill(
                    transactionContext,
                    [createResult.mutateSpec ?? null]
                  )
                : new Map();
              const mutation = yield* await service.tableRecordRepository.insert(
                transactionContext,
                tableForCreate,
                record,
                {
                  ...(input.order ? { order: input.order } : {}),
                  ...(input.typecast ? { fillLinkTitles: true } : {}),
                  ...(fillLinkTitleForeignTables.size > 0 ? { fillLinkTitleForeignTables } : {}),
                }
              );
              return ok({ mutation, tableEvents: transactionTableEvents });
            });
          });
        const transactionResult =
          tracer && createRecordSpan
            ? await tracer.withSpan(createRecordSpan, runTransaction)
            : await runTransaction();
        if (transactionResult.isErr()) {
          createRecordSpan?.recordError(transactionResult.error.toString());
        }
        const persistedResult = yield* transactionResult;
        mutationResult = persistedResult.mutation;
        tableEvents = persistedResult.tableEvents;
      } finally {
        createRecordSpan?.end();
      }

      const decoratedChangedFields =
        yield* await service.recordChangedValueDecoratorService.decorateChangedFields(
          tableForCreate,
          mutationResult?.changedFields
        );
      const createdEventFieldChanges = new Map<string, unknown>();
      for (const [fieldId, value] of decoratedChangedFields ?? []) {
        createdEventFieldChanges.set(fieldId, value);
      }
      for (const [fieldId, value] of mutationResult?.computedChanges ?? []) {
        createdEventFieldChanges.set(fieldId, value);
      }
      const mergedCreatedEventFieldChanges =
        createdEventFieldChanges.size > 0 ? createdEventFieldChanges : undefined;
      const domainEvents = tableForCreate.pullDomainEvents().map((event) =>
        isRecordCreatedEvent(event)
          ? RecordCreated.create({
              tableId: event.tableId,
              baseId: event.baseId,
              recordId: event.recordId,
              fieldValues: mergeRecordFieldValues(
                event.fieldValues,
                mergedCreatedEventFieldChanges
              ),
              source: event.source,
            })
          : event
      );
      const events = [...tableEvents, ...domainEvents];
      yield* await service.eventBus.publishMany(context, events);
      const recordSnapshot = yield* requireStoredRecordSnapshot(
        {
          operation:
            input.operationKind === RecordWriteOperationKind.duplicate ? 'duplicate' : 'create',
          tableId: input.table.id().toString(),
          recordId: record.id().toString(),
        },
        mutationResult?.recordSnapshot
      );
      yield* await service.undoRedoStackService.appendRecordCreate(
        toUndoRedoStackAppendContext(context),
        {
          tableId: input.table.id(),
          createdRecords: [recordSnapshot],
          undoCommandsAfter: sideEffectUndoRedoPlan.undoCommands,
          redoCommandsBefore: sideEffectUndoRedoPlan.redoCommands,
        }
      );
      await pluginExecution.afterCommit();

      const fieldKeyMapping = new Map<string, string>();
      if (input.fieldKeyType !== FieldKeyType.Id) {
        for (const field of tableForCreate.getFields()) {
          const fieldId = field.id().toString();
          const key = FieldKeyResolverService.getFieldKey(field, input.fieldKeyType);
          fieldKeyMapping.set(fieldId, key);
        }
      }
      return ok({
        record,
        events,
        fieldKeyMapping,
        computedChanges: mutationResult?.computedChanges,
      });
    });
  }

  private buildPluginContext(
    context: ExecutionContextPort.IExecutionContext,
    input: IRecordCreationInput,
    fieldValues: ReadonlyMap<string, unknown>
  ) {
    if (input.operationKind === RecordWriteOperationKind.duplicate) {
      return {
        kind: RecordWriteOperationKind.duplicate,
        executionContext: context,
        table: input.table,
        payload: {
          sourceRecordId: input.sourceRecordId!,
          fieldValues,
          order: input.order,
          recordCount: 1 as const,
        },
        isTransactionBound: false,
      } as const;
    }

    if (input.operationKind === RecordWriteOperationKind.submit) {
      return {
        kind: RecordWriteOperationKind.submit,
        executionContext: context,
        table: input.table,
        payload: {
          fieldValues,
          fieldKeyType: input.fieldKeyType,
          typecast: input.typecast,
          source: input.source,
          order: input.order,
          recordCount: 1 as const,
        },
        isTransactionBound: false,
      } as const;
    }

    return {
      kind: RecordWriteOperationKind.createOne,
      executionContext: context,
      table: input.table,
      payload: {
        fieldValues,
        fieldKeyType: input.fieldKeyType,
        typecast: input.typecast,
        source: input.source,
        order: input.order,
        recordCount: 1 as const,
      },
      isTransactionBound: false,
    } as const;
  }
}
