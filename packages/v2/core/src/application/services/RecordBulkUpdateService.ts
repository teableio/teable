import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type {
  RecordFieldChangeDTO,
  RecordUpdateDTO,
} from '../../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchUpdated } from '../../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../../domain/table/fields/FieldId';
import type { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import type { RecordWriteSideEffects } from '../../domain/table/fields/visitors/RecordWriteSideEffectVisitor';
import type {
  UpdateRecordTraceEvent,
  UpdateRecordTraceHook,
  UpdateRecordTracePhase,
  UpdateRecordsStreamTraceEvent,
  UpdateRecordsStreamTraceHook,
  UpdateRecordsStreamTracePhase,
} from '../../domain/table/methods/records';
import type { FieldKeyMapping } from '../../domain/table/records/RecordCreateResult';
import { RecordId } from '../../domain/table/records/RecordId';
import type { RecordInsertOrder } from '../../domain/table/records/RecordInsertOrder';
import { RecordUpdateResult } from '../../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import { IEventBus } from '../../ports/EventBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { ILogger } from '../../ports/Logger';
import {
  RecordWriteOperationKind,
  type RecordWriteFieldValues,
  type RecordWritePluginRunnerOptions,
} from '../../ports/RecordWritePlugin';
import { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { ITableRecordQueryResult } from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { ITableRecordRepository } from '../../ports/TableRecordRepository';
import type { UpdateManyStreamBatchInput } from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import {
  createTeableSpanAttributes,
  type ISpan,
  type ITracer,
  type SpanAttributes,
  TeableSpanAttributes,
} from '../../ports/Tracer';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  type UndoRedoCommandLeafData,
} from '../../ports/UndoRedoStore';
import { IUnitOfWork } from '../../ports/UnitOfWork';
import { type RecordFilterNode } from '../../queries/RecordFilterDto';
import { buildRecordConditionSpec } from '../../queries/RecordFilterMapper';
import { FieldKeyResolverService } from './FieldKeyResolverService';
import {
  type IForeignTableLoaderService,
  NullForeignTableLoaderService,
} from './ForeignTableLoaderService';
import { type IRecordChangedValueDecoratorService } from './RecordChangedValueDecoratorService';
import { areRecordFieldValuesEqual } from './RecordFieldValueEquality';
import { RecordMutationSpecResolverService } from './RecordMutationSpecResolverService';
import { emptyRecordReorderResult, RecordReorderService } from './RecordReorderService';
import type { RecordWritePluginExecution } from './RecordWritePluginRunner';
import { RecordWritePluginRunner } from './RecordWritePluginRunner';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';
import {
  RecordWriteUndoRedoPlanService,
  type RecordWriteUndoRedoPlan,
} from './RecordWriteUndoRedoPlanService';
import { TableUpdateFlow } from './TableUpdateFlow';
import { toUndoRedoStackAppendContext, UndoRedoStackService } from './UndoRedoStackService';

// A hard-coded id is safe here because it never leaves the aggregate/spec build path.
const BULK_UPDATE_SYNTHETIC_RECORD_ID = RecordId.create(`rec${'0'.repeat(16)}`)._unsafeUnwrap();
const EXPLICIT_UPDATE_MAX_BATCH_SIZE = 1000;

type RecordConditionSpec = ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;

type BulkUpdateExecutionResult = {
  readonly updatedCount: number;
  readonly tableEvents: ReadonlyArray<IDomainEvent>;
  readonly extraEvents: ReadonlyArray<IDomainEvent>;
  readonly eventData: ReadonlyArray<RecordUpdateDTO>;
  readonly sideEffectUndoRedoPlan: RecordWriteUndoRedoPlan;
  readonly orderUndoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly orderRedoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly pluginExecution: RecordWritePluginExecution;
  readonly records?: ReadonlyArray<TableRecord>;
  readonly fieldKeyMapping?: FieldKeyMapping;
};

type ExplicitResolvedUpdate = {
  readonly recordId: RecordId;
  readonly fieldValues: RecordWriteFieldValues;
};

type ExplicitAuthorizedUpdate = {
  readonly recordId: RecordId;
  readonly currentRecord: TableRecordReadModel;
  readonly fieldValues: RecordWriteFieldValues;
};

type ExplicitAuthorizationResult = {
  readonly authorizedUpdates: ReadonlyArray<ExplicitAuthorizedUpdate>;
  readonly missingRecordIds: ReadonlyArray<RecordId>;
  readonly pluginFilteredRecordIds: ReadonlyArray<RecordId>;
};

type PendingExplicitEventData = {
  readonly recordId: string;
  readonly oldVersion: number;
  readonly changes: ReadonlyArray<RecordFieldChangeDTO>;
};

type PreparedWriteContext = {
  readonly tableForWrite: Table;
  readonly sideEffects: RecordWriteSideEffects;
  readonly tableUpdateResult?: TableUpdateResult;
  readonly tableEvents: ReadonlyArray<IDomainEvent>;
  readonly sideEffectUndoRedoPlan: RecordWriteUndoRedoPlan;
};

export interface IRecordBulkUpdateItem {
  readonly recordId: RecordId;
  readonly fieldValues: ReadonlyMap<string, unknown>;
}

export interface IRecordBulkUpdateInput {
  readonly table: Table;
  readonly fieldValues: ReadonlyMap<string, unknown>;
  readonly filter: RecordFilterNode | undefined;
  readonly recordIds: ReadonlyArray<RecordId> | undefined;
  readonly records: ReadonlyArray<IRecordBulkUpdateItem> | undefined;
  readonly typecast: boolean;
  readonly deferComputedUpdates?: boolean;
  readonly enqueueDeferredComputedUpdates?: boolean;
  readonly fieldKeyType: FieldKeyType;
  readonly order: RecordInsertOrder | undefined;
  readonly recordWritePluginRunnerOptions?: RecordWritePluginRunnerOptions;
}

type ExplicitUpdateSummary = {
  readonly recordCount: number;
  readonly recordsWithFieldChanges: number;
  readonly totalFieldAssignments: number;
  readonly uniqueFieldCount: number;
  readonly maxFieldsPerRecord: number;
};

export interface IRecordBulkUpdateResult {
  readonly updatedCount: number;
  readonly events: ReadonlyArray<IDomainEvent>;
  readonly records?: ReadonlyArray<TableRecord>;
  readonly fieldKeyMapping?: FieldKeyMapping;
}

const emptyUndoRedoPlan = (): RecordWriteUndoRedoPlan => ({
  undoCommands: [],
  redoCommands: [],
});

const buildUpdateRecordsUndoRedoCommand = (
  tableId: string,
  updates: ReadonlyArray<RecordUpdateDTO>,
  valueSelector: (change: RecordFieldChangeDTO) => unknown
): UndoRedoCommandLeafData =>
  createUndoRedoCommand('UpdateRecords', {
    tableId,
    fieldKeyType: 'id',
    typecast: false,
    records: updates.map((update) => ({
      id: update.recordId,
      fields: Object.fromEntries(
        update.changes.map((change) => [change.fieldId, valueSelector(change)])
      ),
    })),
  });

const composeRecordConditionSpecs = (
  ...specs: ReadonlyArray<RecordConditionSpec | undefined>
): RecordConditionSpec | undefined =>
  composeAndSpecsOrUndefined(specs.filter((spec): spec is RecordConditionSpec => spec != null));

const summarizeExplicitUpdates = (
  updates: ReadonlyArray<Pick<ExplicitResolvedUpdate, 'fieldValues'>>
): ExplicitUpdateSummary => {
  const uniqueFieldIds = new Set<string>();
  let recordsWithFieldChanges = 0;
  let totalFieldAssignments = 0;
  let maxFieldsPerRecord = 0;

  for (const update of updates) {
    const fieldCount = update.fieldValues.size;
    if (fieldCount > 0) {
      recordsWithFieldChanges += 1;
    }
    totalFieldAssignments += fieldCount;
    maxFieldsPerRecord = Math.max(maxFieldsPerRecord, fieldCount);
    for (const fieldId of update.fieldValues.keys()) {
      uniqueFieldIds.add(fieldId);
    }
  }

  return {
    recordCount: updates.length,
    recordsWithFieldChanges,
    totalFieldAssignments,
    uniqueFieldCount: uniqueFieldIds.size,
    maxFieldsPerRecord,
  };
};

const traceRecordBulkUpdatePhase = async <T>(
  context: IExecutionContext,
  phase: string,
  attributes: SpanAttributes,
  callback: (span?: ISpan) => Promise<T> | T
): Promise<T> => {
  const tracer = context.tracer;
  if (!tracer) {
    return callback();
  }

  let span;
  try {
    span = tracer.startSpan(
      `teable.RecordBulkUpdateService.${phase}`,
      createTeableSpanAttributes('service', `RecordBulkUpdateService.${phase}`, {
        [TeableSpanAttributes.HANDLER]: 'RecordBulkUpdateService',
        ...attributes,
      })
    );
  } catch {
    return callback();
  }

  return tracer.withSpan(span, async () => {
    try {
      return await callback(span);
    } finally {
      span.end();
    }
  });
};

const GENERATE_UPDATE_BATCH_RECORD_TRACE_SAMPLE_LIMIT = 3;

const createHrTimer = (): (() => number) => {
  const start = Date.now();
  return () => Date.now() - start;
};

class BulkUpdateBatchTraceCollector {
  private readonly elapsedMs = createHrTimer();
  private readonly streamPhaseDurations = new Map<UpdateRecordsStreamTracePhase, number>();
  private readonly recordPhaseDurations = new Map<UpdateRecordTracePhase, number>();
  private readonly sampledRecords = new Set<number>();
  private recordCount = 0;
  private totalRecordFieldCount = 0;
  private maxRecordFieldCount = 0;

  constructor(
    private readonly tracer: ITracer | undefined,
    private readonly attributes: SpanAttributes
  ) {}

  traceStream: UpdateRecordsStreamTraceHook = <T>(
    event: UpdateRecordsStreamTraceEvent,
    callback: () => T
  ): T => {
    return this.traceSync(
      `teable.RecordBulkUpdateService.generateUpdateBatch.${event.phase}`,
      {
        ...this.attributes,
        'record.update.batchTracePhase': event.phase,
        'record.update.batchIndex': event.batchIndex,
        'record.update.batchSize': event.batchSize,
        'record.update.targetBatchSize': event.targetBatchSize,
        ...(event.recordIndex != null ? { 'record.update.recordIndex': event.recordIndex } : {}),
        ...(event.fieldCount != null ? { 'record.update.fieldCount': event.fieldCount } : {}),
      },
      this.shouldSampleStreamEvent(event),
      (durationMs) => {
        this.addDuration(this.streamPhaseDurations, event.phase, durationMs);
        if (event.phase === 'updateRecord') {
          this.recordCount += 1;
          this.totalRecordFieldCount += event.fieldCount ?? 0;
          this.maxRecordFieldCount = Math.max(this.maxRecordFieldCount, event.fieldCount ?? 0);
        }
      },
      callback
    );
  };

  traceRecord: UpdateRecordTraceHook = <T>(
    event: UpdateRecordTraceEvent,
    callback: () => Result<T, DomainError>
  ): Result<T, DomainError> => {
    return this.traceSync(
      `teable.RecordBulkUpdateService.generateUpdateBatch.updateRecord.${event.phase}`,
      {
        ...this.attributes,
        'record.update.recordTracePhase': event.phase,
        'record.update.fieldCount': event.fieldCount,
        ...(event.recordIndex != null ? { 'record.update.recordIndex': event.recordIndex } : {}),
        ...(event.editableFieldCount != null
          ? { 'record.update.editableFieldCount': event.editableFieldCount }
          : {}),
      },
      this.shouldSampleRecordEvent(event),
      (durationMs) => this.addDuration(this.recordPhaseDurations, event.phase, durationMs),
      callback
    );
  };

  flushToSpan(span: ISpan): void {
    const attrs: Record<string, number> = {
      'record.update.generateBatchTotalRecords': this.recordCount,
      'record.update.generateBatchTotalFieldAssignments': this.totalRecordFieldCount,
      'record.update.generateBatchMaxFieldsPerRecord': this.maxRecordFieldCount,
    };

    for (const [phase, durationMs] of this.streamPhaseDurations.entries()) {
      attrs[`record.update.generateBatch.stream.${phase}.ms`] = Number(durationMs.toFixed(3));
    }
    for (const [phase, durationMs] of this.recordPhaseDurations.entries()) {
      attrs[`record.update.generateBatch.record.${phase}.ms`] = Number(durationMs.toFixed(3));
    }
    span.setAttributes(attrs);
  }

  private traceSync<T>(
    spanName: string,
    attributes: SpanAttributes,
    shouldCreateSpan: boolean,
    onDone: (durationMs: number) => void,
    callback: () => T
  ): T {
    const startMs = this.elapsedMs();
    const span =
      shouldCreateSpan && this.tracer
        ? this.tryStartSpan(spanName, {
            ...attributes,
            'record.update.generateBatchElapsedMs': Number(startMs.toFixed(3)),
          })
        : undefined;

    try {
      return callback();
    } catch (error) {
      span?.recordError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      const durationMs = this.elapsedMs() - startMs;
      onDone(durationMs);
      span?.setAttribute('record.update.phaseDurationMs', Number(durationMs.toFixed(3)));
      span?.end();
    }
  }

  private shouldSampleStreamEvent(event: UpdateRecordsStreamTraceEvent): boolean {
    if (event.phase === 'yieldBatch' || event.phase === 'yieldFinalBatch') {
      return true;
    }
    if (event.recordIndex == null) {
      return false;
    }
    return this.shouldSampleRecordIndex(event.recordIndex);
  }

  private shouldSampleRecordEvent(event: UpdateRecordTraceEvent): boolean {
    if (event.recordIndex == null) {
      return false;
    }
    return this.shouldSampleRecordIndex(event.recordIndex);
  }

  private shouldSampleRecordIndex(recordIndex: number): boolean {
    if (this.sampledRecords.has(recordIndex)) {
      return true;
    }
    if (this.sampledRecords.size >= GENERATE_UPDATE_BATCH_RECORD_TRACE_SAMPLE_LIMIT) {
      return false;
    }
    this.sampledRecords.add(recordIndex);
    return true;
  }

  private tryStartSpan(name: string, attributes: SpanAttributes): ISpan | undefined {
    try {
      return this.tracer?.startSpan(name, attributes);
    } catch {
      return undefined;
    }
  }

  private addDuration<T extends string>(durations: Map<T, number>, phase: T, durationMs: number) {
    durations.set(phase, (durations.get(phase) ?? 0) + durationMs);
  }
}

@injectable()
export class RecordBulkUpdateService {
  constructor(
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordReorderService)
    private readonly recordReorderService: RecordReorderService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.recordWriteUndoRedoPlanService)
    private readonly recordWriteUndoRedoPlanService: RecordWriteUndoRedoPlanService,
    @inject(v2CoreTokens.recordChangedValueDecoratorService)
    private readonly recordChangedValueDecoratorService: IRecordChangedValueDecoratorService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: IUnitOfWork,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: IForeignTableLoaderService = new NullForeignTableLoaderService()
  ) {}

  async update(
    context: IExecutionContext,
    input: IRecordBulkUpdateInput
  ): Promise<Result<IRecordBulkUpdateResult, DomainError>> {
    const service = this;
    const activeSpan = context.tracer?.getActiveSpan();
    activeSpan?.setAttributes({
      [TeableSpanAttributes.TABLE_ID]: input.table.id().toString(),
      'record.update.variant': input.records ? 'explicit' : 'selector',
      'record.update.typecast': input.typecast,
      'record.update.hasOrder': Boolean(input.order),
    });
    if (input.records) {
      const summary = summarizeExplicitUpdates(input.records);
      activeSpan?.setAttributes({
        'record.update.recordCount': summary.recordCount,
        'record.update.recordsWithFieldChanges': summary.recordsWithFieldChanges,
        'record.update.uniqueFieldCount': summary.uniqueFieldCount,
        'record.update.totalFieldAssignments': summary.totalFieldAssignments,
        'record.update.maxFieldsPerRecord': summary.maxFieldsPerRecord,
      });
    } else {
      activeSpan?.setAttributes({
        'record.update.selectorFieldCount': input.fieldValues.size,
        'record.update.selectorRecordIdCount': input.recordIds?.length ?? 0,
      });
    }

    return safeTry<IRecordBulkUpdateResult, DomainError>(async function* () {
      const executionResult = input.records
        ? yield* await service.executeExplicitRecordUpdates(context, input, input.records)
        : yield* await service.executeSelectorBulkUpdate(context, input);

      const events: IDomainEvent[] = [
        ...executionResult.tableEvents,
        ...executionResult.extraEvents,
      ];
      if (executionResult.eventData.length > 0) {
        events.push(
          RecordsBatchUpdated.create({
            tableId: input.table.id(),
            baseId: input.table.baseId(),
            updates: executionResult.eventData,
            source: 'user',
          })
        );
      }

      const tableIdText = input.table.id().toString();
      const updateUndoCommands: UndoRedoCommandLeafData[] =
        executionResult.eventData.length > 0
          ? [
              buildUpdateRecordsUndoRedoCommand(
                tableIdText,
                executionResult.eventData,
                (change) => change.oldValue
              ),
            ]
          : [];
      const updateRedoCommands: UndoRedoCommandLeafData[] =
        executionResult.eventData.length > 0
          ? [
              buildUpdateRecordsUndoRedoCommand(
                tableIdText,
                executionResult.eventData,
                (change) => change.newValue
              ),
            ]
          : [];

      if (
        updateUndoCommands.length > 0 ||
        executionResult.sideEffectUndoRedoPlan.undoCommands.length > 0 ||
        executionResult.sideEffectUndoRedoPlan.redoCommands.length > 0 ||
        executionResult.orderUndoCommands.length > 0 ||
        executionResult.orderRedoCommands.length > 0
      ) {
        yield* await service.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          input.table.id(),
          {
            undoCommand: composeUndoRedoCommands([
              ...updateUndoCommands,
              ...executionResult.orderUndoCommands,
              ...executionResult.sideEffectUndoRedoPlan.undoCommands,
            ]),
            redoCommand: composeUndoRedoCommands([
              ...executionResult.sideEffectUndoRedoPlan.redoCommands,
              ...executionResult.orderRedoCommands,
              ...updateRedoCommands,
            ]),
          }
        );
      }

      if (events.length > 0) {
        yield* await service.eventBus.publishMany(context, events);
      }

      await executionResult.pluginExecution.afterCommit();
      activeSpan?.setAttribute('record.update.updatedCount', executionResult.updatedCount);
      return ok({
        updatedCount: executionResult.updatedCount,
        events,
        ...(executionResult.records ? { records: executionResult.records } : {}),
        ...(executionResult.fieldKeyMapping
          ? { fieldKeyMapping: executionResult.fieldKeyMapping }
          : {}),
      });
    });
  }

  private async executeSelectorBulkUpdate(
    context: IExecutionContext,
    input: IRecordBulkUpdateInput
  ): Promise<Result<BulkUpdateExecutionResult, DomainError>> {
    const service = this;

    return safeTry<BulkUpdateExecutionResult, DomainError>(async function* () {
      const baseFilterSpec = input.recordIds
        ? RecordByIdsSpec.create(input.recordIds)
        : yield* buildRecordConditionSpec(input.table, input.filter!);

      const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
        input.table,
        Object.fromEntries(input.fieldValues),
        input.fieldKeyType
      );
      const resolvedFieldValues = new Map(Object.entries(resolvedFields));
      const pluginExecution = yield* await service.recordWritePluginRunner.prepare(
        {
          kind: RecordWriteOperationKind.updateMany,
          executionContext: context,
          table: input.table,
          payload: {
            variant: 'selector',
            fieldValues: resolvedFieldValues,
            fieldKeyType: input.fieldKeyType,
            typecast: input.typecast,
            recordIds: input.recordIds,
            recordCount: input.recordIds?.length,
          },
          isTransactionBound: false,
        },
        {
          runnerOptions: input.recordWritePluginRunnerOptions,
        }
      );
      yield* await pluginExecution.guard();
      const pluginRecordSpec = yield* pluginExecution.getRecordSpec();
      const filterSpec =
        composeRecordConditionSpecs(baseFilterSpec, pluginRecordSpec) ?? baseFilterSpec;

      const transactionResult = yield* await service.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          safeTry<Omit<BulkUpdateExecutionResult, 'pluginExecution'>, DomainError>(
            async function* () {
              const preparedWrite = yield* await service.prepareTableForWrite(
                transactionContext,
                input.table,
                [resolvedFieldValues],
                input.typecast
              );
              const specBuildResult = yield* preparedWrite.tableForWrite.updateRecord(
                BULK_UPDATE_SYNTHETIC_RECORD_ID,
                resolvedFieldValues,
                {
                  typecast: input.typecast,
                }
              );

              let mutateSpec = specBuildResult.mutateSpec;
              let updatedRecord = specBuildResult.record;
              const needsResolution =
                yield* service.recordMutationSpecResolver.needsResolution(mutateSpec);
              if (needsResolution) {
                mutateSpec = yield* await service.recordMutationSpecResolver.resolveAndReplace(
                  transactionContext,
                  mutateSpec
                );
                updatedRecord = yield* mutateSpec.mutate(updatedRecord);
              }

              yield* await pluginExecution.beforePersist(transactionContext);
              const fillLinkTitleForeignTables = input.typecast
                ? yield* await service.foreignTableLoaderService.loadForLinkTitleFill(
                    transactionContext,
                    [specBuildResult.mutateSpec]
                  )
                : new Map();
              const mutationResult = yield* await service.tableRecordRepository.updateMany(
                transactionContext,
                preparedWrite.tableForWrite,
                filterSpec,
                mutateSpec,
                {
                  deferComputedUpdates: input.deferComputedUpdates,
                  enqueueDeferredComputedUpdates: input.enqueueDeferredComputedUpdates,
                  ...(input.typecast ? { fillLinkTitles: true } : {}),
                  ...(fillLinkTitleForeignTables.size > 0 ? { fillLinkTitleForeignTables } : {}),
                }
              );

              if (mutationResult.updatedRecordIds.length === 0) {
                return ok({
                  updatedCount: 0,
                  tableEvents: [],
                  extraEvents: [],
                  eventData: [],
                  sideEffectUndoRedoPlan: emptyUndoRedoPlan(),
                  orderUndoCommands: [],
                  orderRedoCommands: [],
                });
              }

              const committedWrite = yield* await service.commitPreparedTableWrite(
                transactionContext,
                input.table,
                preparedWrite
              );

              const updatedFieldValues = new Map<string, unknown>();
              for (const entry of updatedRecord.fields().entries()) {
                updatedFieldValues.set(entry.fieldId.toString(), entry.value.toValue());
              }

              const eventData: RecordUpdateDTO[] = [];
              for (const record of mutationResult.updatedRecords) {
                const changes: RecordFieldChangeDTO[] = [];
                for (const [fieldId, newValue] of updatedFieldValues.entries()) {
                  if (areRecordFieldValuesEqual(record.oldFieldValues[fieldId], newValue)) {
                    continue;
                  }
                  changes.push({
                    fieldId,
                    oldValue: record.oldFieldValues[fieldId],
                    newValue,
                  });
                }
                if (changes.length > 0) {
                  eventData.push({
                    recordId: record.recordId.toString(),
                    oldVersion: record.oldVersion,
                    newVersion: record.newVersion,
                    changes,
                  });
                }
              }

              return ok({
                updatedCount: mutationResult.totalUpdated,
                tableEvents: committedWrite.tableEvents,
                extraEvents: [],
                eventData,
                sideEffectUndoRedoPlan: committedWrite.sideEffectUndoRedoPlan,
                orderUndoCommands: [],
                orderRedoCommands: [],
              });
            }
          )
      );

      return ok({ ...transactionResult, pluginExecution });
    });
  }

  private async executeExplicitRecordUpdates(
    context: IExecutionContext,
    input: IRecordBulkUpdateInput,
    records: ReadonlyArray<IRecordBulkUpdateItem>
  ): Promise<Result<BulkUpdateExecutionResult, DomainError>> {
    const service = this;
    const explicitTraceAttributes: SpanAttributes = {
      [TeableSpanAttributes.TABLE_ID]: input.table.id().toString(),
      'record.update.variant': 'explicit',
      'record.update.inputRecordCount': records.length,
      'record.update.typecast': input.typecast,
      'record.update.hasOrder': Boolean(input.order),
    };

    return safeTry<BulkUpdateExecutionResult, DomainError>(async function* () {
      const resolvedUpdates = yield* await traceRecordBulkUpdatePhase(
        context,
        'resolveExplicitUpdates',
        explicitTraceAttributes,
        () => service.resolveExplicitUpdates(input.table, records, input.fieldKeyType)
      );
      const resolvedSummary = summarizeExplicitUpdates(resolvedUpdates);
      const resolvedTraceAttributes: SpanAttributes = {
        ...explicitTraceAttributes,
        'record.update.resolvedRecordCount': resolvedSummary.recordCount,
        'record.update.resolvedUniqueFieldCount': resolvedSummary.uniqueFieldCount,
        'record.update.resolvedTotalFieldAssignments': resolvedSummary.totalFieldAssignments,
        'record.update.resolvedMaxFieldsPerRecord': resolvedSummary.maxFieldsPerRecord,
      };
      const pluginExecution = yield* await traceRecordBulkUpdatePhase(
        context,
        'pluginPrepare',
        resolvedTraceAttributes,
        () =>
          service.recordWritePluginRunner.prepare(
            {
              kind: RecordWriteOperationKind.updateMany,
              executionContext: context,
              table: input.table,
              payload: {
                variant: 'explicit',
                recordUpdates: resolvedUpdates.map((update) => ({
                  recordId: update.recordId,
                  fieldValues: update.fieldValues,
                })),
                fieldKeyType: input.fieldKeyType,
                typecast: input.typecast,
                recordIds: resolvedUpdates.map((update) => update.recordId),
                recordCount: resolvedUpdates.length,
              },
              isTransactionBound: false,
            },
            {
              runnerOptions: input.recordWritePluginRunnerOptions,
            }
          )
      );
      yield* await traceRecordBulkUpdatePhase(context, 'pluginGuard', resolvedTraceAttributes, () =>
        pluginExecution.guard()
      );
      const pluginRecordSpec = yield* await traceRecordBulkUpdatePhase(
        context,
        'pluginGetRecordSpec',
        resolvedTraceAttributes,
        () => pluginExecution.getRecordSpec()
      );
      const activeSpan = context.tracer?.getActiveSpan();
      activeSpan?.setAttributes({
        'record.update.resolvedRecordCount': resolvedSummary.recordCount,
        'record.update.resolvedUniqueFieldCount': resolvedSummary.uniqueFieldCount,
        'record.update.resolvedTotalFieldAssignments': resolvedSummary.totalFieldAssignments,
      });

      const currentRecordsResult = yield* await traceRecordBulkUpdatePhase(
        context,
        'loadExplicitCurrentRecords',
        resolvedTraceAttributes,
        () =>
          service.loadExplicitCurrentRecords(
            context,
            input.table,
            resolvedUpdates.map((update) => update.recordId),
            Boolean(input.order)
          )
      );
      const explicitAuthorization = yield* await traceRecordBulkUpdatePhase(
        context,
        'filterAuthorizedExplicitUpdates',
        {
          ...resolvedTraceAttributes,
          'record.update.loadedCurrentRecordCount': currentRecordsResult.records.length,
        },
        () =>
          service.filterAuthorizedExplicitUpdates(
            input.table,
            resolvedUpdates,
            currentRecordsResult,
            pluginRecordSpec
          )
      );
      const authorizedUpdates = explicitAuthorization.authorizedUpdates;
      activeSpan?.setAttributes({
        'record.update.authorizedRecordCount': authorizedUpdates.length,
        'record.update.missingRecordCount': explicitAuthorization.missingRecordIds.length,
        'record.update.pluginFilteredRecordCount':
          explicitAuthorization.pluginFilteredRecordIds.length,
      });

      if (authorizedUpdates.length === 0) {
        return ok({
          updatedCount: 0,
          tableEvents: [],
          extraEvents: [],
          eventData: [],
          sideEffectUndoRedoPlan: emptyUndoRedoPlan(),
          orderUndoCommands: [],
          orderRedoCommands: [],
          pluginExecution,
          records: [],
        });
      }

      const transactionResult = yield* await service.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          safeTry<Omit<BulkUpdateExecutionResult, 'pluginExecution'>, DomainError>(
            async function* () {
              const fieldUpdateTargets = authorizedUpdates.filter(
                (update) => update.fieldValues.size > 0
              );
              const transactionTraceAttributes: SpanAttributes = {
                ...resolvedTraceAttributes,
                'record.update.authorizedRecordCount': authorizedUpdates.length,
                'record.update.fieldUpdateTargetCount': fieldUpdateTargets.length,
                'record.update.missingRecordCount': explicitAuthorization.missingRecordIds.length,
                'record.update.pluginFilteredRecordCount':
                  explicitAuthorization.pluginFilteredRecordIds.length,
              };
              const preparedWrite = yield* await traceRecordBulkUpdatePhase(
                transactionContext,
                'prepareTableForWrite',
                transactionTraceAttributes,
                () =>
                  service.prepareTableForWrite(
                    transactionContext,
                    input.table,
                    fieldUpdateTargets.map((update) => update.fieldValues),
                    input.typecast
                  )
              );

              yield* await traceRecordBulkUpdatePhase(
                transactionContext,
                'pluginBeforePersist',
                transactionTraceAttributes,
                () => pluginExecution.beforePersist(transactionContext)
              );

              const order = input.order;
              const reorderResult = order
                ? yield* await traceRecordBulkUpdatePhase(
                    transactionContext,
                    'reorderRecords',
                    transactionTraceAttributes,
                    () =>
                      service.recordReorderService.reorder(transactionContext, {
                        table: preparedWrite.tableForWrite,
                        recordIds: authorizedUpdates.map((update) => update.recordId),
                        currentRecords: authorizedUpdates.map((update) => update.currentRecord),
                        order,
                      })
                  )
                : emptyRecordReorderResult();

              let updatedCount = reorderResult.updatedCount;
              const pendingEventData: PendingExplicitEventData[] = [];
              const eventData: RecordUpdateDTO[] = [];
              const updatedRecordMap = new Map<string, TableRecord>();

              if (fieldUpdateTargets.length > 0) {
                let currentBatchTraceCollector: BulkUpdateBatchTraceCollector | undefined;
                const updateBatches = yield* await traceRecordBulkUpdatePhase(
                  transactionContext,
                  'createUpdateRecordsStream',
                  transactionTraceAttributes,
                  () =>
                    ok(
                      preparedWrite.tableForWrite.updateRecordsStream(
                        fieldUpdateTargets.map((update) => ({
                          recordId: update.recordId,
                          fieldValues: update.fieldValues,
                        })),
                        {
                          typecast: input.typecast,
                          maxBatchSize: EXPLICIT_UPDATE_MAX_BATCH_SIZE,
                          trace: (event, callback) =>
                            currentBatchTraceCollector
                              ? currentBatchTraceCollector.traceStream(event, callback)
                              : callback(),
                          traceRecord: (event, callback) =>
                            currentBatchTraceCollector
                              ? currentBatchTraceCollector.traceRecord(event, callback)
                              : callback(),
                        }
                      )
                    )
                );

                const persistedBatches: Array<Result<UpdateManyStreamBatchInput, DomainError>> = [];
                const fillLinkTitleSpecs: ICellValueSpec[] = [];
                let resolvedIndex = 0;
                let maxBatchSize = 0;
                let batchIndex = 0;

                const updateBatchIterator = updateBatches[Symbol.iterator]();
                while (true) {
                  const nextBatch = yield* await traceRecordBulkUpdatePhase(
                    transactionContext,
                    'generateUpdateBatch',
                    {
                      ...transactionTraceAttributes,
                      'record.update.batchIndex': batchIndex,
                    },
                    (span) => {
                      currentBatchTraceCollector = new BulkUpdateBatchTraceCollector(
                        transactionContext.tracer,
                        {
                          ...transactionTraceAttributes,
                          'record.update.batchIndex': batchIndex,
                        }
                      );
                      try {
                        return ok(updateBatchIterator.next());
                      } finally {
                        if (span) {
                          currentBatchTraceCollector.flushToSpan(span);
                        }
                        currentBatchTraceCollector = undefined;
                      }
                    }
                  );
                  if (nextBatch.done) {
                    break;
                  }
                  const batchResult = nextBatch.value;
                  if (batchResult.isErr()) {
                    return err(batchResult.error);
                  }

                  const batchTraceAttributes: SpanAttributes = {
                    ...transactionTraceAttributes,
                    'record.update.batchIndex': batchIndex,
                    'record.update.batchInputSize': batchResult.value.length,
                  };
                  const resolvedBatch = yield* await traceRecordBulkUpdatePhase(
                    transactionContext,
                    'resolveUpdateBatch',
                    batchTraceAttributes,
                    () => service.resolveUpdateBatch(transactionContext, batchResult.value)
                  );

                  for (const updateResult of batchResult.value) {
                    fillLinkTitleSpecs.push(updateResult.mutateSpec);
                  }

                  persistedBatches.push(
                    ok({
                      table: preparedWrite.tableForWrite,
                      updates: resolvedBatch,
                    })
                  );
                  maxBatchSize = Math.max(maxBatchSize, resolvedBatch.length);

                  yield* await traceRecordBulkUpdatePhase(
                    transactionContext,
                    'materializeResolvedBatch',
                    {
                      ...batchTraceAttributes,
                      'record.update.resolvedBatchSize': resolvedBatch.length,
                    },
                    async () =>
                      safeTry<void, DomainError>(async function* () {
                        const changedValuesByRecord = new Map<
                          string,
                          ReadonlyMap<string, unknown>
                        >();
                        const previousFieldsByRecord = new Map<string, Record<string, unknown>>();
                        const pendingMaterialized: Array<{
                          recordId: RecordId;
                          oldVersion: number;
                          changes: ReadonlyArray<RecordFieldChangeDTO>;
                          updatedFields: Map<string, unknown>;
                          currentFields: Record<string, unknown>;
                        }> = [];

                        for (const updateResult of resolvedBatch) {
                          const pending = fieldUpdateTargets[resolvedIndex];
                          if (!pending) {
                            return err(
                              domainError.unexpected({
                                code: 'record.update_many.event_mismatch',
                                message:
                                  'Failed to map bulk record updates to resolved v2 batch results',
                              })
                            );
                          }

                          const changes = yield* service.buildRecordChangesFromUpdateResult(
                            pending.currentRecord,
                            updateResult
                          );
                          const changedValues =
                            changes.length > 0
                              ? new Map(changes.map((change) => [change.fieldId, change.newValue]))
                              : undefined;
                          const recordIdText = pending.recordId.toString();
                          if (changedValues) {
                            changedValuesByRecord.set(recordIdText, changedValues);
                            previousFieldsByRecord.set(recordIdText, pending.currentRecord.fields);
                          }
                          const updatedFields = new Map(
                            updateResult.record
                              .fields()
                              .entries()
                              .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
                          );
                          pendingMaterialized.push({
                            recordId: pending.recordId,
                            oldVersion: pending.currentRecord.version,
                            changes,
                            updatedFields,
                            currentFields: pending.currentRecord.fields,
                          });
                          resolvedIndex += 1;
                        }

                        const decoratedValuesByRecord =
                          yield* await service.recordChangedValueDecoratorService.decorateChangedFieldsByRecord(
                            preparedWrite.tableForWrite,
                            changedValuesByRecord,
                            previousFieldsByRecord
                          );

                        for (const item of pendingMaterialized) {
                          const recordIdText = item.recordId.toString();
                          const decoratedValues = decoratedValuesByRecord?.get(recordIdText);
                          const decoratedChanges = item.changes.map((change) => ({
                            ...change,
                            newValue: decoratedValues?.get(change.fieldId) ?? change.newValue,
                          }));
                          pendingEventData.push({
                            recordId: recordIdText,
                            oldVersion: item.oldVersion,
                            changes: decoratedChanges,
                          });
                          for (const [fieldId, value] of decoratedValues ?? []) {
                            item.updatedFields.set(fieldId, value);
                          }
                          const mergedFields = {
                            ...Object.fromEntries(
                              Object.entries(item.currentFields).filter(
                                ([, value]) => value !== null && value !== undefined
                              )
                            ),
                            ...Object.fromEntries(item.updatedFields),
                          };
                          const mergedRecord = yield* TableRecord.fromRawFieldValues({
                            id: recordIdText,
                            tableId: input.table.id(),
                            fields: mergedFields,
                          });
                          updatedRecordMap.set(recordIdText, mergedRecord);
                        }

                        return ok(undefined);
                      })
                  );
                  batchIndex += 1;
                }

                const authorizedSummary = summarizeExplicitUpdates(authorizedUpdates);
                activeSpan?.setAttributes({
                  'record.update.batchCount': persistedBatches.length,
                  'record.update.maxBatchSize': maxBatchSize,
                  'record.update.authorizedRecordsWithFieldChanges':
                    authorizedSummary.recordsWithFieldChanges,
                });
                service.logger.info('RecordBulkUpdateService.explicitUpdatesPrepared', {
                  tableId: input.table.id().toString(),
                  recordCount: authorizedSummary.recordCount,
                  recordsWithFieldChanges: authorizedSummary.recordsWithFieldChanges,
                  uniqueFieldCount: authorizedSummary.uniqueFieldCount,
                  totalFieldAssignments: authorizedSummary.totalFieldAssignments,
                  batchCount: persistedBatches.length,
                  maxBatchSize,
                  typecast: input.typecast,
                  hasOrder: Boolean(input.order),
                });

                if (resolvedIndex !== fieldUpdateTargets.length) {
                  return err(
                    domainError.unexpected({
                      code: 'record.update_many.count_mismatch',
                      message: 'Bulk record update results did not match the expected record count',
                    })
                  );
                }

                const fillLinkTitleForeignTables = input.typecast
                  ? yield* await traceRecordBulkUpdatePhase(
                      transactionContext,
                      'loadForeignTablesForLinkTitleFill',
                      {
                        ...transactionTraceAttributes,
                        'record.update.fillLinkTitleSpecCount': fillLinkTitleSpecs.length,
                      },
                      () =>
                        service.foreignTableLoaderService.loadForLinkTitleFill(
                          transactionContext,
                          fillLinkTitleSpecs
                        )
                    )
                  : new Map();
                const persistResult = yield* await traceRecordBulkUpdatePhase(
                  transactionContext,
                  'updateManyStream',
                  {
                    ...transactionTraceAttributes,
                    'record.update.batchCount': persistedBatches.length,
                    'record.update.maxBatchSize': maxBatchSize,
                    'record.update.fillLinkTitleForeignTableCount': fillLinkTitleForeignTables.size,
                  },
                  () =>
                    service.tableRecordRepository.updateManyStream(
                      transactionContext,
                      preparedWrite.tableForWrite,
                      service.createSyncUpdateBatchesGenerator(persistedBatches),
                      {
                        deferComputedUpdates: input.deferComputedUpdates,
                        enqueueDeferredComputedUpdates: input.enqueueDeferredComputedUpdates,
                        ...(input.typecast ? { fillLinkTitles: true } : {}),
                        ...(fillLinkTitleForeignTables.size > 0
                          ? { fillLinkTitleForeignTables }
                          : {}),
                      }
                    )
                );
                yield* await traceRecordBulkUpdatePhase(
                  transactionContext,
                  'buildPersistedEventData',
                  {
                    ...transactionTraceAttributes,
                    'record.update.pendingEventCount': pendingEventData.length,
                    'record.update.persistedRecordCount': persistResult.updatedRecords?.length ?? 0,
                  },
                  async () => {
                    const persistedVersions = new Map(
                      (persistResult.updatedRecords ?? []).map((record) => [
                        record.recordId.toString(),
                        record.newVersion,
                      ])
                    );
                    for (const pendingEvent of pendingEventData) {
                      const newVersion = persistedVersions.get(pendingEvent.recordId);
                      if (newVersion == null) {
                        continue;
                      }
                      if (pendingEvent.changes.length === 0) {
                        continue;
                      }
                      eventData.push({
                        recordId: pendingEvent.recordId,
                        oldVersion: pendingEvent.oldVersion,
                        newVersion,
                        changes: pendingEvent.changes,
                      });
                    }
                    return ok(undefined);
                  }
                );
                // Reorder and field updates can target the same rows; max keeps row count semantics stable.
                updatedCount = Math.max(updatedCount, persistResult.totalUpdated);
              }

              const committedWrite =
                updatedCount > 0
                  ? yield* await traceRecordBulkUpdatePhase(
                      transactionContext,
                      'commitPreparedTableWrite',
                      {
                        ...transactionTraceAttributes,
                        'record.update.updatedCount': updatedCount,
                        'record.update.sideEffectCount': preparedWrite.sideEffects.length,
                      },
                      () =>
                        service.commitPreparedTableWrite(
                          transactionContext,
                          input.table,
                          preparedWrite
                        )
                    )
                  : preparedWrite;

              const materializedRecords: TableRecord[] = [];
              yield* await traceRecordBulkUpdatePhase(
                transactionContext,
                'materializeResultRecords',
                {
                  ...transactionTraceAttributes,
                  'record.update.updatedRecordMapSize': updatedRecordMap.size,
                },
                async () =>
                  safeTry<void, DomainError>(async function* () {
                    for (const update of authorizedUpdates) {
                      const updatedRecord = updatedRecordMap.get(update.recordId.toString());
                      if (updatedRecord) {
                        materializedRecords.push(updatedRecord);
                        continue;
                      }

                      const currentRecordEntity = yield* TableRecord.fromRawFieldValues({
                        id: update.currentRecord.id,
                        tableId: input.table.id(),
                        fields: Object.fromEntries(
                          Object.entries(update.currentRecord.fields).filter(
                            ([, value]) => value !== null && value !== undefined
                          )
                        ),
                      });
                      materializedRecords.push(currentRecordEntity);
                    }
                    return ok(undefined);
                  })
              );

              return ok({
                updatedCount,
                tableEvents: committedWrite.tableEvents,
                extraEvents: reorderResult.events,
                eventData,
                sideEffectUndoRedoPlan: committedWrite.sideEffectUndoRedoPlan,
                orderUndoCommands: reorderResult.undoCommands,
                orderRedoCommands: reorderResult.redoCommands,
                records: materializedRecords,
              });
            }
          )
      );

      const fieldKeyMapping =
        input.fieldKeyType === 'id'
          ? undefined
          : new Map(
              input.table
                .getFields()
                .map((field) => [
                  field.id().toString(),
                  FieldKeyResolverService.getFieldKey(field, input.fieldKeyType),
                ])
            );

      return ok({ ...transactionResult, pluginExecution, fieldKeyMapping });
    });
  }

  private async prepareTableForWrite(
    context: IExecutionContext,
    table: Table,
    recordFieldValues: ReadonlyArray<RecordWriteFieldValues>,
    typecast: boolean
  ): Promise<Result<PreparedWriteContext, DomainError>> {
    const service = this;

    return safeTry<PreparedWriteContext, DomainError>(async function* () {
      if (recordFieldValues.length === 0) {
        return ok({
          tableForWrite: table,
          sideEffects: [],
          tableUpdateResult: undefined,
          tableEvents: [],
          sideEffectUndoRedoPlan: emptyUndoRedoPlan(),
        });
      }

      const sideEffectResult = yield* service.recordWriteSideEffectService.execute(
        context,
        table,
        recordFieldValues,
        typecast
      );

      const tableEvents: ReadonlyArray<IDomainEvent> = [];

      return ok({
        tableForWrite: sideEffectResult.table,
        sideEffects: sideEffectResult.effects,
        tableUpdateResult: sideEffectResult.updateResult,
        tableEvents,
        sideEffectUndoRedoPlan: emptyUndoRedoPlan(),
      });
    });
  }

  private async commitPreparedTableWrite(
    context: IExecutionContext,
    originalTable: Table,
    preparedWrite: PreparedWriteContext
  ): Promise<Result<PreparedWriteContext, DomainError>> {
    const service = this;

    return safeTry<PreparedWriteContext, DomainError>(async function* () {
      if (!preparedWrite.tableUpdateResult || preparedWrite.sideEffects.length === 0) {
        return ok(preparedWrite);
      }
      const tableUpdateResult = preparedWrite.tableUpdateResult;

      const tableFlowResult = yield* await service.tableUpdateFlow.execute(
        context,
        { table: originalTable },
        () => ok(tableUpdateResult),
        { publishEvents: false }
      );
      const sideEffectUndoRedoPlan =
        yield* await service.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
          context,
          originalTable,
          preparedWrite.tableForWrite,
          preparedWrite.sideEffects
        );

      return ok({
        ...preparedWrite,
        tableForWrite: tableFlowResult.table,
        tableEvents: tableFlowResult.events,
        sideEffectUndoRedoPlan,
      });
    });
  }

  private resolveExplicitUpdates(
    table: Table,
    updates: ReadonlyArray<IRecordBulkUpdateItem>,
    fieldKeyType: FieldKeyType
  ): Result<ReadonlyArray<ExplicitResolvedUpdate>, DomainError> {
    const resolvedUpdates: ExplicitResolvedUpdate[] = [];

    for (const update of updates) {
      const resolvedFields = FieldKeyResolverService.resolveFieldKeys(
        table,
        Object.fromEntries(update.fieldValues),
        fieldKeyType
      );
      if (resolvedFields.isErr()) {
        return err(resolvedFields.error);
      }

      resolvedUpdates.push({
        recordId: update.recordId,
        fieldValues: new Map(Object.entries(resolvedFields.value)),
      });
    }

    return ok(resolvedUpdates);
  }

  private async loadExplicitCurrentRecords(
    context: IExecutionContext,
    table: Table,
    recordIds: ReadonlyArray<RecordId>,
    includeOrders: boolean
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    return this.tableRecordQueryRepository.find(context, table, RecordByIdsSpec.create(recordIds), {
      mode: 'stored',
      includeOrders,
      includeTotal: false,
      recordIdsOrder: recordIds,
    });
  }

  private filterAuthorizedExplicitUpdates(
    table: Table,
    resolvedUpdates: ReadonlyArray<ExplicitResolvedUpdate>,
    currentRecordsResult: ITableRecordQueryResult,
    pluginRecordSpec: RecordConditionSpec | undefined
  ): Result<ExplicitAuthorizationResult, DomainError> {
    const currentRecords = new Map(
      currentRecordsResult.records.map((record) => [record.id, record])
    );
    const authorizedUpdates: ExplicitAuthorizedUpdate[] = [];
    const missingRecordIds: RecordId[] = [];
    const pluginFilteredRecordIds: RecordId[] = [];

    for (const update of resolvedUpdates) {
      const currentRecord = currentRecords.get(update.recordId.toString());
      if (!currentRecord) {
        missingRecordIds.push(update.recordId);
        continue;
      }

      if (pluginRecordSpec) {
        const currentRecordEntity = TableRecord.fromRawFieldValues({
          id: currentRecord.id,
          tableId: table.id(),
          fields: currentRecord.fields,
        });
        if (currentRecordEntity.isErr()) {
          return err(currentRecordEntity.error);
        }
        if (!pluginRecordSpec.isSatisfiedBy(currentRecordEntity.value)) {
          pluginFilteredRecordIds.push(update.recordId);
          continue;
        }
      }

      authorizedUpdates.push({
        recordId: update.recordId,
        currentRecord,
        fieldValues: update.fieldValues,
      });
    }

    if (missingRecordIds.length > 0 || pluginFilteredRecordIds.length > 0) {
      this.logger.debug('RecordBulkUpdateService.explicitUpdatesSkipped', {
        tableId: table.id().toString(),
        missingRecordIds: missingRecordIds.map((recordId) => recordId.toString()),
        pluginFilteredRecordIds: pluginFilteredRecordIds.map((recordId) => recordId.toString()),
      });
    }

    return ok({
      authorizedUpdates,
      missingRecordIds,
      pluginFilteredRecordIds,
    });
  }

  private async resolveUpdateBatch(
    context: IExecutionContext,
    batch: ReadonlyArray<RecordUpdateResult>
  ): Promise<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
    const resolveManyResult = await this.recordMutationSpecResolver.resolveAndReplaceMany(
      context,
      batch.map((updateResult) => updateResult.mutateSpec)
    );
    if (resolveManyResult.isErr()) {
      return err(resolveManyResult.error);
    }

    const resolvedBatch: RecordUpdateResult[] = [];
    for (let index = 0; index < batch.length; index++) {
      const updateResult = batch[index]!;
      const mutateSpec = resolveManyResult.value[index] ?? updateResult.mutateSpec;
      const mutateResult = mutateSpec.mutate(updateResult.record);
      if (mutateResult.isErr()) {
        return err(mutateResult.error);
      }
      resolvedBatch.push(
        RecordUpdateResult.create(
          mutateResult.value,
          mutateSpec,
          updateResult.fieldKeyMapping,
          updateResult.events
        )
      );
    }

    return ok(resolvedBatch);
  }

  private buildRecordChangesFromUpdateResult(
    currentRecord: TableRecordReadModel,
    updateResult: RecordUpdateResult
  ): Result<ReadonlyArray<RecordFieldChangeDTO>, DomainError> {
    const changes: RecordFieldChangeDTO[] = [];

    for (const [fieldId] of updateResult.fieldKeyMapping.entries()) {
      const typedFieldId = FieldId.create(fieldId);
      if (typedFieldId.isErr()) {
        return err(typedFieldId.error);
      }

      changes.push({
        fieldId,
        oldValue: currentRecord.fields[fieldId],
        newValue: updateResult.record.fields().get(typedFieldId.value)?.toValue() ?? null,
      });
    }

    return ok(
      changes.filter((change) => !areRecordFieldValuesEqual(change.oldValue, change.newValue))
    );
  }

  private createSyncUpdateBatchesGenerator(
    batches: ReadonlyArray<Result<UpdateManyStreamBatchInput, DomainError>>
  ): Generator<Result<UpdateManyStreamBatchInput, DomainError>> {
    return (function* () {
      for (const batch of batches) {
        yield batch;
      }
    })();
  }
}
