import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { RecordGroupByValue } from '../../commands/DeleteByRangeCommand';
import { normalizeRanges, type RangeType } from '../../commands/RangeUtils';
import { buildDeletedRecordSnapshot } from '../../commands/shared/buildDeletedRecordSnapshot';
import {
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from '../../commands/shared/orderBy';
import { persistDeletedTrashMarkers } from '../../commands/shared/persistDeletedTrashMarkers';
import { ensureRecordIdsWithinScope } from '../../commands/shared/recordWriteScope';
import {
  DEFAULT_DELETE_STREAM_BATCH_SIZE,
  resolveDeleteStreamBatchSize,
} from '../../commands/shared/streamBatchSize';
import {
  domainError,
  isNotFoundError,
  type DomainError,
  type IDomainErrorLocalization,
} from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { generateUuid } from '../../domain/shared/IdGenerator';
import { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../../domain/shared/pagination/PageLimit';
import { PageOffset } from '../../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { measureJsonBytes } from '../../domain/shared/TableDataSafetyLimits';
import {
  RecordsDeleted,
  type IDeletedRecordSnapshot,
  type IRecordsDeletedOrchestration,
} from '../../domain/table/events/RecordsDeleted';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { FieldType } from '../../domain/table/fields/FieldType';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { ViewId } from '../../domain/table/views/ViewId';
import { domainWrite, type IDomainWriteTransaction } from '../../ports/DomainWriteTransaction';
import type {
  ExecutionContextBackgroundTask,
  IExecutionContext,
} from '../../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../../ports/RecordWritePlugin';
import type {
  ITableRecordQueryRepository,
  TableRecordOrderBy,
} from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRecordRepository, DeleteManyResult } from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import type { SpanAttributes } from '../../ports/Tracer';
import type { UndoEntryGroupInput } from '../../ports/UndoRedoStore';
import type { RecordSortValue } from '../../queries/ListTableRecordsQuery';
import type { RecordFilter } from '../../queries/RecordFilterDto';
import {
  buildSanitizedRecordConditionSpec,
  replaceCurrentUserTagInFilter,
} from '../../queries/RecordFilterMapper';
import {
  resolveVisibleRowSearch,
  type RecordQuerySearch,
  type RecordSearch,
} from '../../queries/RecordSearch';
import { requireStoredRecordSnapshots } from './RecordMutationSnapshotContract';
import type { RecordWritePluginExecution } from './RecordWritePluginRunner';
import { RecordWritePluginRunner } from './RecordWritePluginRunner';
import { TableQueryService } from './TableQueryService';
import { toUndoRedoStackAppendContext, UndoRedoStackService } from './UndoRedoStackService';

const DEFAULT_DELETE_QUERY_PAGE_SIZE = 500;
const MAX_DELETE_STREAM_ID_PAGE_SIZE = 2_000;
const SELF_LINK_PREFETCH_BATCH_SIZE = 2_000;
const WIDE_TABLE_INITIAL_DELETE_STREAM_BATCH_SIZE = 50;
const MIN_ADAPTIVE_DELETE_STREAM_BATCH_SIZE = 5;
const MAX_DELETE_STREAM_CHUNK_SNAPSHOT_BYTES = 3 * 1024 * 1024;
const UPSCALE_DELETE_STREAM_CHUNK_SNAPSHOT_BYTES = 750 * 1024;
const MAX_STREAM_DONE_DELETED_RECORD_IDS = 5_000;

const collectSelfReferentialLinkFieldIds = (table: Table): ReadonlyArray<FieldId> =>
  table
    .getFields()
    .filter(
      (field): field is LinkField =>
        field instanceof LinkField && field.foreignTableId().equals(table.id())
    )
    .map((field) => field.id());

const collectRequiredSelfReferentialLinkFieldIds = (table: Table): ReadonlyArray<string> =>
  table
    .getFields()
    .filter(
      (field): field is LinkField =>
        field instanceof LinkField &&
        field.foreignTableId().equals(table.id()) &&
        field.notNull().toBoolean()
    )
    .map((field) => field.id().toString());

const extractLinkedRecordIds = (value: unknown): ReadonlyArray<string> => {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') {
        ids.push(item);
      } else if (item && typeof item === 'object' && 'id' in item) {
        const id = (item as { id?: unknown }).id;
        if (typeof id === 'string') {
          ids.push(id);
        }
      }
    }
    return ids;
  }
  if (typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? [id] : [];
  }
  return [];
};

const orderTargetRecordIdsForRequiredSelfLinks = (
  table: Table,
  targetRecordIds: ReadonlyArray<RecordId>,
  selfLinkFieldsById: ReadonlyMap<string, Readonly<Record<string, unknown>>> | undefined
): {
  readonly orderedRecordIds: ReadonlyArray<RecordId>;
  readonly acyclicPrefixLength: number;
  readonly componentEnds: ReadonlyArray<number>;
} => {
  const requiredFieldIds = collectRequiredSelfReferentialLinkFieldIds(table);
  if (requiredFieldIds.length === 0 || !selfLinkFieldsById?.size || targetRecordIds.length <= 1) {
    return {
      orderedRecordIds: targetRecordIds,
      acyclicPrefixLength: targetRecordIds.length,
      componentEnds: [],
    };
  }

  const recordIdByString = new Map<string, RecordId>();
  const inDegree = new Map<string, number>();
  const dependsOn = new Map<string, Set<string>>();

  for (const recordId of targetRecordIds) {
    const idStr = recordId.toString();
    recordIdByString.set(idStr, recordId);
    inDegree.set(idStr, 0);
  }

  for (const recordId of targetRecordIds) {
    const sourceId = recordId.toString();
    const fields = selfLinkFieldsById.get(sourceId);
    if (!fields) continue;
    let targets = dependsOn.get(sourceId);
    for (const fieldId of requiredFieldIds) {
      for (const linkedId of extractLinkedRecordIds(fields[fieldId])) {
        if (linkedId === sourceId || !recordIdByString.has(linkedId)) {
          continue;
        }
        if (!targets) {
          targets = new Set<string>();
          dependsOn.set(sourceId, targets);
        }
        if (!targets.has(linkedId)) {
          targets.add(linkedId);
          inDegree.set(linkedId, (inDegree.get(linkedId) ?? 0) + 1);
        }
      }
    }
  }

  const queue: string[] = [];
  for (const recordId of targetRecordIds) {
    const idStr = recordId.toString();
    if ((inDegree.get(idStr) ?? 0) === 0) {
      queue.push(idStr);
    }
  }

  const orderedRecordIds: RecordId[] = [];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    orderedRecordIds.push(recordIdByString.get(current)!);
    const targets = dependsOn.get(current);
    if (!targets) continue;
    for (const target of targets) {
      const nextDegree = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, nextDegree);
      if (nextDegree === 0) {
        queue.push(target);
      }
    }
  }

  const acyclicPrefixLength = orderedRecordIds.length;
  const componentEnds =
    acyclicPrefixLength < targetRecordIds.length
      ? appendRemainingDependencyComponents(dependsOn, inDegree, recordIdByString, orderedRecordIds)
      : [];

  return { orderedRecordIds, acyclicPrefixLength, componentEnds };
};

/** Append strongly connected components in source-before-target order. */
const appendRemainingDependencyComponents = (
  dependsOn: ReadonlyMap<string, ReadonlySet<string>>,
  inDegree: ReadonlyMap<string, number>,
  recordIdByString: ReadonlyMap<string, RecordId>,
  orderedRecordIds: RecordId[]
): number[] => {
  // Iterative Kosaraju on Kahn's remainder avoids recursive stacks on large cycles.
  const dependents = new Map<string, string[]>();
  const finished: string[] = [];
  const seen = new Set<string>();
  const stack: Array<{ id: string; targets: Iterator<string, undefined> | undefined }> = [];
  for (const [root, degree] of inDegree) {
    if (degree === 0 || seen.has(root)) continue;
    seen.add(root);
    stack.push({ id: root, targets: dependsOn.get(root)?.values() });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = frame.targets?.next();
      if (!next || next.done) {
        finished.push(frame.id);
        stack.pop();
        continue;
      }
      const target = next.value;
      if (inDegree.get(target) === 0) continue;
      const sources = dependents.get(target);
      if (sources) sources.push(frame.id);
      else dependents.set(target, [frame.id]);
      if (!seen.has(target)) {
        seen.add(target);
        stack.push({ id: target, targets: dependsOn.get(target)?.values() });
      }
    }
  }

  // Walk the reversed edges in decreasing finish order. Consume `seen` as we assign rows.
  const componentEnds: number[] = [];
  const pending: string[] = [];
  for (let index = finished.length - 1; index >= 0; index--) {
    const root = finished[index]!;
    if (!seen.delete(root)) continue;
    pending.push(root);
    while (pending.length > 0) {
      const id = pending.pop()!;
      orderedRecordIds.push(recordIdByString.get(id)!);
      const sources = dependents.get(id);
      if (!sources) continue;
      for (const source of sources) {
        if (seen.delete(source)) pending.push(source);
      }
    }
    componentEnds.push(orderedRecordIds.length);
  }
  return componentEnds;
};

const resolveInitialAdaptiveBatchSize = (
  table: Table,
  planBatchSize: number,
  totalCount: number,
  explicitBatchSize: number | undefined
): number => {
  // Keep lightweight deletes (<= 200 rows) in a single atomic transaction
  // even on wide tables so partial failures roll back cleanly.
  if (explicitBatchSize !== undefined || totalCount <= DEFAULT_DELETE_STREAM_BATCH_SIZE) {
    return planBatchSize;
  }
  const hasWideField = table
    .getFields()
    .some(
      (field) =>
        field.type().equals(FieldType.longText()) || field.type().equals(FieldType.attachment())
    );
  return hasWideField
    ? Math.min(planBatchSize, WIDE_TABLE_INITIAL_DELETE_STREAM_BATCH_SIZE)
    : planBatchSize;
};

const drainBackgroundTasks = async (
  tasks: ReadonlyArray<ExecutionContextBackgroundTask>
): Promise<void> => {
  if (tasks.length === 0) {
    return;
  }
  await Promise.allSettled(tasks.map((task) => Promise.resolve().then(() => task())));
};

const computeNextAdaptiveChunkSize = (
  recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
  currentBatchSize: number
): number => {
  if (recordSnapshots.length === 0) {
    return currentBatchSize;
  }
  const snapshotBytes = measureJsonBytes(recordSnapshots);
  const avgRowBytes = Math.max(1, Math.ceil(snapshotBytes / recordSnapshots.length));
  if (snapshotBytes > MAX_DELETE_STREAM_CHUNK_SNAPSHOT_BYTES) {
    const scaled = Math.floor(MAX_DELETE_STREAM_CHUNK_SNAPSHOT_BYTES / avgRowBytes);
    return Math.max(
      MIN_ADAPTIVE_DELETE_STREAM_BATCH_SIZE,
      Math.min(DEFAULT_DELETE_STREAM_BATCH_SIZE, scaled)
    );
  }
  if (
    snapshotBytes < UPSCALE_DELETE_STREAM_CHUNK_SNAPSHOT_BYTES &&
    currentBatchSize < DEFAULT_DELETE_STREAM_BATCH_SIZE &&
    recordSnapshots.length >= currentBatchSize
  ) {
    const scaled = Math.floor(UPSCALE_DELETE_STREAM_CHUNK_SNAPSHOT_BYTES / avgRowBytes);
    return Math.min(DEFAULT_DELETE_STREAM_BATCH_SIZE, Math.max(currentBatchSize * 2, scaled));
  }
  return currentBatchSize;
};

const toRangeTypeSpanAttribute = (rangeType: RangeType): 'columns' | 'rows' | 'cells' =>
  rangeType ?? 'cells';

export type DeleteByRangeCommandLike = {
  readonly tableId: TableId;
  readonly viewId: ViewId;
  readonly rawRanges: ReadonlyArray<readonly [number, number]>;
  readonly rangeType: RangeType;
  readonly filter: RecordFilter | undefined;
  readonly sort: ReadonlyArray<RecordSortValue> | undefined;
  readonly search: RecordSearch | undefined;
  readonly groupBy: ReadonlyArray<RecordGroupByValue> | undefined;
  readonly ignoreViewQuery: boolean;
};

type DeleteByRangeStreamCommandLike = DeleteByRangeCommandLike & {
  readonly targetRecordIds?: ReadonlyArray<string>;
  readonly excludedTargetRecordIds?: ReadonlyArray<string>;
  readonly batchSize?: number;
  readonly selectAllRecords?: boolean;
};

export type PreparedDeletePlan = {
  readonly table: Table;
  readonly recordIds: ReadonlyArray<RecordId>;
  readonly deletedRecordIds: ReadonlyArray<string>;
  readonly recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
};

type PreparedDeleteStreamPlan =
  | {
      readonly mode: 'ids';
      readonly table: Table;
      readonly totalCount: number;
      readonly batchSize: number;
      readonly targetRecordIds: ReadonlyArray<RecordId>;
      readonly excludedRecordIds?: ReadonlySet<string>;
      readonly rawEffectiveFilter?: RecordFilter;
    }
  | {
      readonly mode: 'ranges';
      readonly table: Table;
      readonly totalCount: number;
      readonly batchSize: number;
      readonly filterSpec:
        | ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
        | undefined;
      readonly rawEffectiveFilter: RecordFilter | undefined;
      readonly orderBy: ReadonlyArray<TableRecordOrderBy> | undefined;
      readonly search: RecordQuerySearch | undefined;
      readonly sortedRanges: ReadonlyArray<readonly [number, number]>;
      readonly excludedRecordIds: ReadonlySet<string>;
    };

type SelfLinkSnapshotPatch = {
  readonly fieldIds: ReadonlyArray<FieldId>;
  readonly byRecordId?: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
};

type PreparedDeleteChunk = {
  readonly batchIndex: number;
  readonly recordIds: ReadonlyArray<RecordId>;
  readonly deletedRecordIds: ReadonlyArray<string>;
  readonly recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
  /** Loaded rows that remain in the table and must advance later chunk offsets. */
  readonly skippedRowCount: number;
};

type DeletePluginOrchestration = {
  readonly mode: 'direct' | 'stream';
  readonly scope: 'operation' | 'chunk';
  readonly operationId: string;
  readonly totalRecordCount: number;
  readonly totalChunkCount: number;
  readonly chunkIndex?: number;
};

type DeletePersistOutcome = {
  readonly recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
  readonly events: ReadonlyArray<IDomainEvent>;
};

export interface DeleteByRangeResult {
  deletedCount: number;
  deletedRecordIds: ReadonlyArray<string>;
  events: ReadonlyArray<IDomainEvent>;
}

export interface DeleteByRangeStreamProgressEvent {
  id: 'progress';
  phase: 'preparing' | 'deleting';
  batchIndex: number;
  totalCount: number;
  deletedCount: number;
  batchDeletedCount: number;
}

export interface DeleteByRangeStreamDoneEvent {
  id: 'done';
  totalCount: number;
  deletedCount: number;
  data: {
    deletedCount: number;
    deletedRecordIds: string[];
  };
}

export interface DeleteByRangeStreamErrorEvent {
  id: 'error';
  phase: 'preparing' | 'guarding' | 'deleting' | 'publishing' | 'finalizing';
  batchIndex: number;
  totalCount: number;
  deletedCount: number;
  recordIds: string[];
  message: string;
  code?: string;
  localization?: IDomainErrorLocalization;
}

export type DeleteByRangeStreamEvent =
  | DeleteByRangeStreamProgressEvent
  | DeleteByRangeStreamDoneEvent
  | DeleteByRangeStreamErrorEvent;

@injectable()
export class DeleteByRangeApplicationService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction
  ) {}

  async delete(
    context: IExecutionContext,
    command: DeleteByRangeCommandLike
  ): Promise<Result<DeleteByRangeResult, DomainError>> {
    const planResult = await this.runInSpan(
      context,
      'teable.DeleteByRangeApplicationService.prepareDeletePlan',
      {
        'teable.table_id': command.tableId.toString(),
        'teable.view_id': command.viewId.toString(),
        'teable.range_type': toRangeTypeSpanAttribute(command.rangeType),
        'teable.range_count': command.rawRanges.length,
        'teable.delete_mode': 'direct',
      },
      () => this.prepareDelete(context, command, DEFAULT_DELETE_QUERY_PAGE_SIZE)
    );
    if (planResult.isErr()) {
      return err(planResult.error);
    }

    const plan = planResult.value;
    if (!plan.recordIds.length) {
      return ok({
        deletedCount: 0,
        deletedRecordIds: [],
        events: [],
      });
    }

    const operationId = context.requestId ?? generateUuid();
    const pluginExecutionResult = await this.runInSpan(
      context,
      'teable.DeleteByRangeApplicationService.prepareDeletePlugins',
      {
        'teable.table_id': plan.table.id().toString(),
        'teable.record_count': plan.recordIds.length,
        'teable.delete_mode': 'direct',
      },
      () =>
        this.prepareDeletePluginExecution(
          context,
          plan.table,
          plan.recordIds,
          plan.recordSnapshots,
          this.createDeletePluginOrchestration({
            mode: 'direct',
            scope: 'operation',
            operationId,
            totalRecordCount: plan.recordIds.length,
            totalChunkCount: 1,
          }),
          { skipScopeValidation: true }
        )
    );
    if (pluginExecutionResult.isErr()) {
      return err(pluginExecutionResult.error);
    }

    const scopeValidationResult = await this.runInSpan(
      context,
      'teable.DeleteByRangeApplicationService.validateDeletePluginScope',
      {
        'teable.table_id': plan.table.id().toString(),
        'teable.record_count': plan.recordIds.length,
        'teable.delete_mode': 'direct',
      },
      () =>
        this.validateDeletePluginScope(
          context,
          plan.table,
          plan.recordIds,
          pluginExecutionResult.value
        )
    );
    if (scopeValidationResult.isErr()) {
      return err(scopeValidationResult.error);
    }

    const persistResult = await this.runInSpan(
      context,
      'teable.DeleteByRangeApplicationService.deleteRecords',
      {
        'teable.table_id': plan.table.id().toString(),
        'teable.record_count': plan.recordIds.length,
        'teable.delete_mode': 'direct',
      },
      () =>
        this.deleteManyInSingleTransaction(context, plan, pluginExecutionResult.value, operationId)
    );
    if (persistResult.isErr()) {
      return err(persistResult.error);
    }

    return this.runInSpan(
      context,
      'teable.DeleteByRangeApplicationService.finalizeDeletePlan',
      {
        'teable.table_id': plan.table.id().toString(),
        'teable.record_count': plan.recordIds.length,
        'teable.delete_mode': 'direct',
      },
      () => this.finalizeDeletePlan(context, plan, persistResult.value, pluginExecutionResult.value)
    );
  }

  async *createStream(
    context: IExecutionContext,
    command: DeleteByRangeStreamCommandLike
  ): AsyncIterable<DeleteByRangeStreamEvent> {
    yield this.createProgressEvent('preparing', 0, 0, 0, -1);

    if (context.abortSignal?.aborted) {
      return;
    }

    try {
      const planResult = await this.runInSpan(
        context,
        'teable.DeleteByRangeApplicationService.prepareDeleteStreamPlan',
        {
          'teable.table_id': command.tableId.toString(),
          'teable.view_id': command.viewId.toString(),
          'teable.range_type': toRangeTypeSpanAttribute(command.rangeType),
          'teable.range_count': command.rawRanges.length,
          'teable.delete_mode': 'stream',
        },
        () => this.prepareDeleteStreamPlan(context, command)
      );
      if (planResult.isErr()) {
        if (context.abortSignal?.aborted) {
          return;
        }
        yield this.createErrorEvent(planResult.error, {
          phase: 'preparing',
          batchIndex: -1,
          totalCount: 0,
          deletedCount: 0,
          recordIds: [],
        });
        return;
      }

      const plan = planResult.value;
      yield this.createProgressEvent('preparing', plan.totalCount, 0, 0, -1);

      if (!plan.totalCount) {
        yield this.createDoneEvent(
          {
            deletedCount: 0,
            deletedRecordIds: [],
            events: [],
          },
          0
        );
        return;
      }

      const operationId = context.requestId ?? generateUuid();
      const deletedRecordIds: string[] = [];
      let deletedCount = 0;
      const undoGroup = { groupId: operationId, attempted: false };
      let currentBatchSize = resolveInitialAdaptiveBatchSize(
        plan.table,
        plan.batchSize,
        plan.totalCount,
        command.batchSize
      );
      const initialChunkCount = Math.max(
        1,
        Math.ceil(plan.totalCount / Math.max(1, currentBatchSize))
      );

      const operationPluginExecutionResult = await this.runInSpan(
        context,
        'teable.DeleteByRangeApplicationService.prepareDeleteStreamPlugins',
        {
          'teable.table_id': plan.table.id().toString(),
          'teable.total_record_count': plan.totalCount,
          'teable.total_chunk_count': initialChunkCount,
          'teable.delete_mode': 'stream',
          'teable.plugin_scope': 'operation',
        },
        () =>
          this.prepareDeletePluginExecution(
            context,
            plan.table,
            [],
            [],
            this.createDeletePluginOrchestration({
              mode: 'stream',
              scope: 'operation',
              operationId,
              totalRecordCount: plan.totalCount,
              totalChunkCount: initialChunkCount,
            }),
            {
              skipScopeValidation: true,
              payloadRecordCount: plan.totalCount,
              filter: plan.rawEffectiveFilter,
            }
          )
      );
      if (operationPluginExecutionResult.isErr()) {
        yield this.createErrorEvent(operationPluginExecutionResult.error, {
          phase: 'guarding',
          batchIndex: -1,
          totalCount: plan.totalCount,
          deletedCount,
          recordIds: [],
        });
        return;
      }

      const selfLinkFieldIds = collectSelfReferentialLinkFieldIds(plan.table);
      let selfLinkFieldsById: ReadonlyMap<string, Readonly<Record<string, unknown>>> | undefined;
      if (
        plan.mode === 'ids' &&
        selfLinkFieldIds.length > 0 &&
        plan.targetRecordIds.length > currentBatchSize
      ) {
        const selfLinkResult = await this.loadSelfReferentialLinkFieldsById(
          context,
          plan.table,
          plan.targetRecordIds,
          selfLinkFieldIds
        );
        if (selfLinkResult.isErr()) {
          yield this.createErrorEvent(selfLinkResult.error, {
            phase: 'preparing',
            batchIndex: -1,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [],
          });
          return;
        }
        selfLinkFieldsById = selfLinkResult.value;
      }

      const selfLinkPatch: SelfLinkSnapshotPatch | undefined =
        selfLinkFieldIds.length > 0 && selfLinkFieldsById?.size
          ? { fieldIds: selfLinkFieldIds, byRecordId: selfLinkFieldsById }
          : undefined;

      const {
        orderedRecordIds: orderedTargetRecordIds,
        acyclicPrefixLength,
        componentEnds,
      } = plan.mode === 'ids'
        ? orderTargetRecordIdsForRequiredSelfLinks(
            plan.table,
            plan.targetRecordIds,
            selfLinkFieldsById
          )
        : { orderedRecordIds: [], acyclicPrefixLength: 0, componentEnds: [] };

      let previousPluginExecution = operationPluginExecutionResult.value;
      let chunkIndex = 0;

      // Mutable iteration cursor covering both explicit-ID slices and dynamic range pages.
      let idCursor = 0;
      let componentCursor = 0;
      let rangeIndex = 0;
      let rangeRemaining =
        plan.mode === 'ranges' && plan.sortedRanges.length > 0
          ? plan.sortedRanges[0]![1] - plan.sortedRanges[0]![0] + 1
          : 0;
      let rangeSkippedOrFailed = 0;
      let rangeTotalRemaining =
        plan.mode === 'ranges'
          ? plan.sortedRanges.reduce((sum, [start, end]) => sum + (end - start + 1), 0)
          : 0;

      const advanceEmptyRange = () => {
        if (plan.mode !== 'ranges') return;
        while (rangeIndex < plan.sortedRanges.length && rangeRemaining <= 0) {
          rangeIndex += 1;
          rangeSkippedOrFailed = 0;
          rangeRemaining =
            rangeIndex < plan.sortedRanges.length
              ? plan.sortedRanges[rangeIndex]![1] - plan.sortedRanges[rangeIndex]![0] + 1
              : 0;
        }
      };

      const hasMoreChunks = () =>
        plan.mode === 'ids'
          ? idCursor < orderedTargetRecordIds.length
          : rangeIndex < plan.sortedRanges.length && rangeRemaining > 0;

      while (hasMoreChunks()) {
        if (context.abortSignal?.aborted) {
          return;
        }

        let requestedRowCount = 0;
        let activeRangeStartRow = 0;
        let rangePullCount = 0;
        let sliceRecordIds: ReadonlyArray<RecordId> = [];

        if (plan.mode === 'ids') {
          const batchEnd = idCursor + currentBatchSize;
          let nextSliceEnd: number;
          if (idCursor < acyclicPrefixLength) {
            nextSliceEnd = Math.min(batchEnd, acyclicPrefixLength);
          } else {
            // A required-link component is indivisible, even when it exceeds the batch size.
            nextSliceEnd = componentEnds[componentCursor++]!;
            while (
              componentCursor < componentEnds.length &&
              componentEnds[componentCursor]! <= batchEnd
            ) {
              nextSliceEnd = componentEnds[componentCursor++]!;
            }
          }
          sliceRecordIds = orderedTargetRecordIds.slice(idCursor, nextSliceEnd);
          idCursor += sliceRecordIds.length;
          requestedRowCount = sliceRecordIds.length;
        } else {
          const [startRow] = plan.sortedRanges[rangeIndex]!;
          activeRangeStartRow = startRow + rangeSkippedOrFailed;
          rangePullCount = Math.min(currentBatchSize, rangeRemaining);
          rangeRemaining -= rangePullCount;
          rangeTotalRemaining -= rangePullCount;
          requestedRowCount = rangePullCount;
        }

        const remainingCount =
          plan.mode === 'ids' ? plan.targetRecordIds.length - idCursor : rangeTotalRemaining;
        const estimatedTotalChunks = Math.max(
          chunkIndex + 1 + (remainingCount > 0 ? Math.ceil(remainingCount / currentBatchSize) : 0),
          chunkIndex + 1
        );

        const chunkResult = await this.runInSpan(
          context,
          'teable.DeleteByRangeApplicationService.loadDeleteChunk',
          {
            'teable.batch_index': chunkIndex,
            'teable.chunk_row_count': requestedRowCount,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () =>
            plan.mode === 'ids'
              ? this.loadDeleteChunkByIds(context, plan, chunkIndex, sliceRecordIds)
              : this.loadDeleteChunkByRange(
                  context,
                  plan,
                  chunkIndex,
                  activeRangeStartRow,
                  rangePullCount
                )
        );
        if (chunkResult.isErr()) {
          if (plan.mode === 'ranges') {
            rangeSkippedOrFailed += rangePullCount;
            advanceEmptyRange();
          }
          yield this.createErrorEvent(chunkResult.error, {
            phase: 'preparing',
            batchIndex: chunkIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [],
          });
          chunkIndex += 1;
          continue;
        }

        const chunk = chunkResult.value;
        if (!chunk.recordIds.length) {
          if (plan.mode === 'ranges') {
            if (chunk.skippedRowCount === 0) {
              // No more rows matched in the current view range: finish remaining tail cleanly.
              rangeTotalRemaining -= rangeRemaining;
              rangeRemaining = 0;
            } else {
              rangeSkippedOrFailed += chunk.skippedRowCount;
            }
            advanceEmptyRange();
          }
          chunkIndex += 1;
          continue;
        }

        const pluginExecutionResult = await this.runInSpan(
          context,
          'teable.DeleteByRangeApplicationService.prepareDeleteChunkPlugins',
          {
            'teable.batch_index': chunk.batchIndex,
            'teable.chunk_record_count': chunk.recordIds.length,
            'teable.total_record_count': plan.totalCount,
            'teable.total_chunk_count': estimatedTotalChunks,
            'teable.table_id': plan.table.id().toString(),
            'teable.delete_mode': 'stream',
            'teable.plugin_scope': 'chunk',
          },
          () =>
            this.prepareDeletePluginExecution(
              context,
              plan.table,
              chunk.recordIds,
              chunk.recordSnapshots,
              this.createDeletePluginOrchestration({
                mode: 'stream',
                scope: 'chunk',
                operationId,
                totalRecordCount: plan.totalCount,
                totalChunkCount: estimatedTotalChunks,
                chunkIndex: chunk.batchIndex,
              }),
              {
                previousExecution: previousPluginExecution,
                skipScopeValidation: true,
                filter: plan.rawEffectiveFilter,
              }
            )
        );
        if (pluginExecutionResult.isErr()) {
          if (plan.mode === 'ranges') {
            rangeSkippedOrFailed += chunk.recordIds.length + chunk.skippedRowCount;
            advanceEmptyRange();
          }
          yield this.createErrorEvent(pluginExecutionResult.error, {
            phase: 'guarding',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...chunk.deletedRecordIds],
          });
          chunkIndex += 1;
          continue;
        }

        const pluginExecution = pluginExecutionResult.value;
        const scopeValidationResult = await this.runInSpan(
          context,
          'teable.DeleteByRangeApplicationService.validateDeleteChunkPluginScope',
          {
            'teable.batch_index': chunk.batchIndex,
            'teable.chunk_record_count': chunk.recordIds.length,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
            'teable.delete_mode': 'stream',
          },
          () =>
            this.validateDeletePluginScope(context, plan.table, chunk.recordIds, pluginExecution)
        );
        if (scopeValidationResult.isErr()) {
          if (plan.mode === 'ranges') {
            rangeSkippedOrFailed += chunk.recordIds.length + chunk.skippedRowCount;
            advanceEmptyRange();
          }
          yield this.createErrorEvent(scopeValidationResult.error, {
            phase: 'guarding',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...chunk.deletedRecordIds],
          });
          chunkIndex += 1;
          continue;
        }

        previousPluginExecution = pluginExecution;
        const chunkBackgroundTasks: ExecutionContextBackgroundTask[] = [];
        const chunkContext: IExecutionContext = {
          ...context,
          scheduleBackgroundTask: (task) => {
            chunkBackgroundTasks.push(task);
          },
        };

        const deleteResult = await this.runInSpan(
          context,
          'teable.DeleteByRangeApplicationService.deleteChunk',
          {
            'teable.batch_index': chunk.batchIndex,
            'teable.chunk_record_count': chunk.recordIds.length,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () =>
            this.deleteManyInSingleTransaction(
              chunkContext,
              { ...chunk, table: plan.table },
              pluginExecution,
              operationId,
              {
                operationId,
                groupId: operationId,
                totalRecordCount: plan.totalCount,
                totalChunkCount: estimatedTotalChunks,
                chunkIndex: chunk.batchIndex,
                scope: 'chunk',
              },
              selfLinkPatch
            )
        );

        await drainBackgroundTasks(chunkBackgroundTasks);

        if (deleteResult.isErr()) {
          if (plan.mode === 'ranges') {
            rangeSkippedOrFailed += chunk.recordIds.length + chunk.skippedRowCount;
            advanceEmptyRange();
          }
          yield this.createErrorEvent(deleteResult.error, {
            phase: 'deleting',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...chunk.deletedRecordIds],
          });
          chunkIndex += 1;
          continue;
        }

        if (plan.mode === 'ranges') {
          rangeSkippedOrFailed += chunk.skippedRowCount;
          advanceEmptyRange();
        }

        const persistedRecordSnapshots = deleteResult.value.recordSnapshots;
        const persistedDeletedRecordIds = persistedRecordSnapshots.map((snapshot) => snapshot.id);

        for (const id of persistedDeletedRecordIds) {
          if (deletedRecordIds.length >= MAX_STREAM_DONE_DELETED_RECORD_IDS) {
            break;
          }
          deletedRecordIds.push(id);
        }
        deletedCount += persistedDeletedRecordIds.length;

        const undoRedoResult = await this.runInSpan(
          context,
          'teable.DeleteByRangeApplicationService.recordDeleteChunkUndoRedo',
          {
            'teable.batch_index': chunk.batchIndex,
            'teable.chunk_record_count': chunk.deletedRecordIds.length,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () =>
            this.recordDeleteUndoRedoEntry(
              context,
              plan.table,
              persistedRecordSnapshots,
              persistedDeletedRecordIds,
              undoGroup
            )
        );
        if (undoRedoResult.isErr()) {
          yield this.createErrorEvent(undoRedoResult.error, {
            phase: 'finalizing',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...persistedDeletedRecordIds],
          });
        }

        if (pluginExecution) {
          await pluginExecution.afterCommit();
        }

        if (command.batchSize === undefined) {
          currentBatchSize = computeNextAdaptiveChunkSize(
            persistedRecordSnapshots,
            currentBatchSize
          );
        }

        yield this.createProgressEvent(
          'deleting',
          plan.totalCount,
          deletedCount,
          persistedDeletedRecordIds.length,
          chunk.batchIndex
        );

        chunkIndex += 1;
      }

      if (context.abortSignal?.aborted) {
        return;
      }

      yield this.createDoneEvent(
        {
          deletedCount,
          deletedRecordIds,
          events: [],
        },
        plan.totalCount
      );
    } catch (error) {
      yield this.createErrorEvent(
        domainError.fromUnknown(error, {
          code: 'delete_by_range_stream.failed',
        }),
        {
          phase: 'deleting',
          batchIndex: -1,
          totalCount: 0,
          deletedCount: 0,
          recordIds: [],
        }
      );
    }
  }

  async prepareDelete(
    context: IExecutionContext,
    command: DeleteByRangeCommandLike,
    pageSize: number = DEFAULT_DELETE_QUERY_PAGE_SIZE
  ): Promise<Result<PreparedDeletePlan, DomainError>> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      return err(tableResult.error);
    }
    const table = tableResult.value;

    const orderedFieldIdsResult = table.getOrderedVisibleFieldIds(command.viewId.toString());
    if (orderedFieldIdsResult.isErr()) {
      return err(orderedFieldIdsResult.error);
    }

    const viewResult = table.getView(command.viewId);
    if (viewResult.isErr()) {
      return err(viewResult.error);
    }
    const view = viewResult.value;

    const viewDefaultsResult = view.queryDefaults();
    if (viewDefaultsResult.isErr()) {
      return err(viewDefaultsResult.error);
    }
    const mergedDefaults = viewDefaultsResult.value.merge({
      filter: command.filter,
      sort: command.sort,
      group: command.groupBy,
    });

    const effectiveFilter = command.ignoreViewQuery
      ? (command.filter ?? undefined)
      : (mergedDefaults.filter() ?? undefined);
    const effectiveSort = command.ignoreViewQuery
      ? (command.sort ?? undefined)
      : mergedDefaults.sort();
    const effectiveGroup = command.ignoreViewQuery
      ? (command.groupBy ?? undefined)
      : mergedDefaults.group();

    const actorResolvedFilter = replaceCurrentUserTagInFilter(
      table,
      effectiveFilter,
      context.actorId.toString()
    );
    const filterSpecResult = buildSanitizedRecordConditionSpec(table, actorResolvedFilter);
    if (filterSpecResult.isErr()) {
      return err(filterSpecResult.error);
    }
    const filterSpec = filterSpecResult.value;

    const visibleRowSearch = resolveVisibleRowSearch(command.search, orderedFieldIdsResult.value);
    const groupByOrderByResult = resolveGroupByToOrderBy(effectiveGroup);
    if (groupByOrderByResult.isErr()) {
      return err(groupByOrderByResult.error);
    }
    const sortOrderByResult = resolveOrderBy(effectiveSort, table, effectiveGroup);
    if (sortOrderByResult.isErr()) {
      return err(sortOrderByResult.error);
    }

    const orderBy = mergeOrderByWithViewRowTieBreaker(
      groupByOrderByResult.value,
      sortOrderByResult.value,
      command.viewId.toString()
    );

    const recordsResult = await this.collectRecordsToDelete(context, table, command, {
      filterSpec,
      orderBy,
      search: visibleRowSearch,
      totalCols: orderedFieldIdsResult.value.length,
      pageSize,
      projectionFieldIds: this.resolveDeletePreReadProjectionFieldIds(table),
      // Undo/redo restore snapshots now come from repository capture instead of
      // the pre-read query, so we do not pay the extra row-order join here.
      includeOrders: false,
      includeTotal: false,
    });
    if (recordsResult.isErr()) {
      return err(recordsResult.error);
    }

    if (!recordsResult.value.length) {
      return ok({
        table,
        recordIds: [],
        deletedRecordIds: [],
        recordSnapshots: [],
      });
    }

    const recordIds: RecordId[] = [];
    const recordSnapshots: IDeletedRecordSnapshot[] = [];
    for (const record of recordsResult.value) {
      const recordIdResult = RecordId.create(record.id);
      if (recordIdResult.isErr()) {
        return err(recordIdResult.error);
      }

      recordIds.push(recordIdResult.value);
      recordSnapshots.push(buildDeletedRecordSnapshot(table, record));
    }

    return ok({
      table,
      recordIds,
      deletedRecordIds: recordSnapshots.map((snapshot) => snapshot.id),
      recordSnapshots,
    });
  }

  private async prepareDeleteStreamPlan(
    context: IExecutionContext,
    command: DeleteByRangeStreamCommandLike
  ): Promise<Result<PreparedDeleteStreamPlan, DomainError>> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      return err(tableResult.error);
    }
    const table = tableResult.value;

    const excludedRecordIdsResult = this.parseTargetRecordIdSet(command.excludedTargetRecordIds);
    if (excludedRecordIdsResult.isErr()) {
      return err(excludedRecordIdsResult.error);
    }
    const excludedRecordIds = excludedRecordIdsResult.value;

    const hasExplicitTargetIds = command.targetRecordIds !== undefined;
    if (hasExplicitTargetIds && command.targetRecordIds!.length > 0) {
      const parsedRecordIdsResult = this.parseTargetRecordIds(command.targetRecordIds!);
      if (parsedRecordIdsResult.isErr()) {
        return err(parsedRecordIdsResult.error);
      }
      const recordIds = parsedRecordIdsResult.value.filter(
        (recordId) => !excludedRecordIds.has(recordId.toString())
      );
      const batchSize = resolveDeleteStreamBatchSize(recordIds.length, command.batchSize);

      return ok({
        mode: 'ids',
        table,
        totalCount: recordIds.length,
        batchSize,
        targetRecordIds: recordIds,
        excludedRecordIds,
      });
    }

    const isSelectAll =
      hasExplicitTargetIds &&
      (command.selectAllRecords === true ||
        (command.selectAllRecords === undefined && excludedRecordIds.size > 0));
    if (hasExplicitTargetIds && !isSelectAll) {
      return ok({
        mode: 'ids',
        table,
        totalCount: 0,
        batchSize: resolveDeleteStreamBatchSize(0, command.batchSize),
        targetRecordIds: [],
        excludedRecordIds,
      });
    }

    const orderedFieldIdsResult = table.getOrderedVisibleFieldIds(command.viewId.toString());
    if (orderedFieldIdsResult.isErr()) {
      return err(orderedFieldIdsResult.error);
    }

    const viewResult = table.getView(command.viewId);
    if (viewResult.isErr()) {
      return err(viewResult.error);
    }
    const view = viewResult.value;

    const viewDefaultsResult = view.queryDefaults();
    if (viewDefaultsResult.isErr()) {
      return err(viewDefaultsResult.error);
    }
    const mergedDefaults = viewDefaultsResult.value.merge({
      filter: command.filter,
      sort: command.sort,
      group: command.groupBy,
    });

    const effectiveFilter = command.ignoreViewQuery
      ? (command.filter ?? undefined)
      : (mergedDefaults.filter() ?? undefined);
    const effectiveSort = command.ignoreViewQuery
      ? (command.sort ?? undefined)
      : mergedDefaults.sort();
    const effectiveGroup = command.ignoreViewQuery
      ? (command.groupBy ?? undefined)
      : mergedDefaults.group();

    const actorResolvedFilter = replaceCurrentUserTagInFilter(
      table,
      effectiveFilter,
      context.actorId.toString()
    );
    const filterSpecResult = buildSanitizedRecordConditionSpec(table, actorResolvedFilter);
    if (filterSpecResult.isErr()) {
      return err(filterSpecResult.error);
    }
    const filterSpec = filterSpecResult.value;

    const visibleRowSearch = resolveVisibleRowSearch(command.search, orderedFieldIdsResult.value);
    const groupByOrderByResult = resolveGroupByToOrderBy(effectiveGroup);
    if (groupByOrderByResult.isErr()) {
      return err(groupByOrderByResult.error);
    }
    const sortOrderByResult = resolveOrderBy(effectiveSort, table, effectiveGroup);
    if (sortOrderByResult.isErr()) {
      return err(sortOrderByResult.error);
    }

    const orderBy = mergeOrderByWithViewRowTieBreaker(
      groupByOrderByResult.value,
      sortOrderByResult.value,
      command.viewId.toString()
    );

    const totalRowsResult = await this.countRecordsInScope(
      context,
      table,
      filterSpec,
      visibleRowSearch
    );
    if (totalRowsResult.isErr()) {
      return err(totalRowsResult.error);
    }

    const rowRanges = hasExplicitTargetIds
      ? totalRowsResult.value > 0
        ? ([[0, totalRowsResult.value - 1]] as const)
        : []
      : this.resolveDeleteStreamRowRanges(
          command,
          totalRowsResult.value,
          orderedFieldIdsResult.value.length
        );
    const rawRangeRowCount = rowRanges.reduce(
      (sum, [startRow, endRow]) => sum + (endRow - startRow + 1),
      0
    );
    if (rawRangeRowCount === 0) {
      return ok({
        mode: 'ids',
        table,
        totalCount: 0,
        batchSize: resolveDeleteStreamBatchSize(0, command.batchSize),
        targetRecordIds: [],
        excludedRecordIds,
      });
    }

    const sortedRanges = this.sortRowRangesDescending(rowRanges);
    const rawEffectiveFilter = (actorResolvedFilter ?? undefined) as RecordFilter | undefined;

    // Resolve the selection before deleting any rows. Once resolved, later
    // edits to the view's membership do not change the IDs being deleted.
    const frozenIdsResult = await this.collectFrozenRangeRecordIds(
      context,
      table,
      filterSpec,
      orderBy,
      visibleRowSearch,
      sortedRanges,
      excludedRecordIds
    );
    if (frozenIdsResult.isErr()) {
      return err(frozenIdsResult.error);
    }

    const targetRecordIds = frozenIdsResult.value;
    const batchSize = resolveDeleteStreamBatchSize(targetRecordIds.length, command.batchSize);

    return ok({
      mode: 'ids',
      table,
      totalCount: targetRecordIds.length,
      batchSize,
      targetRecordIds,
      excludedRecordIds,
      rawEffectiveFilter,
    });
  }

  private sortRowRangesDescending(
    rowRanges: ReadonlyArray<readonly [number, number]>
  ): ReadonlyArray<readonly [number, number]> {
    return [...rowRanges].sort((left, right) => {
      if (left[0] !== right[0]) {
        return right[0] - left[0];
      }
      return right[1] - left[1];
    });
  }

  private async collectFrozenRangeRecordIds(
    context: IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined,
    sortedRanges: ReadonlyArray<readonly [number, number]>,
    excludedRecordIds: ReadonlySet<string>
  ): Promise<Result<ReadonlyArray<RecordId>, DomainError>> {
    const collectedIds: RecordId[] = [];
    const seen = new Set<string>();

    for (const [startRow, endRow] of sortedRanges) {
      for (let offset = startRow; offset <= endRow; offset += MAX_DELETE_STREAM_ID_PAGE_SIZE) {
        if (context.abortSignal?.aborted) {
          return err(
            domainError.conflict({
              code: 'delete_by_range_stream.aborted',
              message: 'Delete stream aborted while freezing target record ids',
            })
          );
        }

        const pageEnd = Math.min(endRow, offset + MAX_DELETE_STREAM_ID_PAGE_SIZE - 1);
        const pageResult = await this.queryRecordsForRange(
          context,
          table,
          filterSpec,
          orderBy,
          search,
          offset,
          pageEnd,
          {
            projectionFieldIds: [],
            includeOrders: false,
            includeTotal: false,
            idsOnly: true,
          }
        );
        if (pageResult.isErr()) {
          return err(pageResult.error);
        }

        const rows = pageResult.value;
        if (rows.length === 0) {
          break;
        }
        for (const row of rows) {
          if (excludedRecordIds.has(row.id) || seen.has(row.id)) {
            continue;
          }
          seen.add(row.id);
          const recordIdResult = RecordId.create(row.id);
          if (recordIdResult.isErr()) {
            return err(recordIdResult.error);
          }
          collectedIds.push(recordIdResult.value);
        }
      }
    }

    return ok(collectedIds);
  }

  private async loadSelfReferentialLinkFieldsById(
    context: IExecutionContext,
    table: Table,
    recordIds: ReadonlyArray<RecordId>,
    selfLinkFieldIds: ReadonlyArray<FieldId>
  ): Promise<Result<ReadonlyMap<string, Readonly<Record<string, unknown>>>, DomainError>> {
    const byRecordId = new Map<string, Readonly<Record<string, unknown>>>();
    for (let offset = 0; offset < recordIds.length; offset += SELF_LINK_PREFETCH_BATCH_SIZE) {
      if (context.abortSignal?.aborted) {
        return err(
          domainError.conflict({
            code: 'delete_by_range_stream.aborted',
            message: 'Delete stream aborted while reading self-link snapshots',
          })
        );
      }
      const sliceIds = recordIds.slice(offset, offset + SELF_LINK_PREFETCH_BATCH_SIZE);
      const queryResult = await this.tableRecordQueryRepository.find(
        context,
        table,
        RecordByIdsSpec.create(sliceIds),
        {
          mode: 'stored',
          projectionFieldIds: selfLinkFieldIds,
          valuesOnly: true,
          includeOrders: false,
          includeTotal: false,
        }
      );
      if (queryResult.isErr()) {
        return err(queryResult.error);
      }
      for (const row of queryResult.value.records) {
        byRecordId.set(row.id, row.fields);
      }
    }
    return ok(byRecordId);
  }

  private parseTargetRecordIds(
    recordIds: ReadonlyArray<string>
  ): Result<ReadonlyArray<RecordId>, DomainError> {
    const parsed: RecordId[] = [];
    for (const rawId of recordIds) {
      const recordIdResult = RecordId.create(rawId);
      if (recordIdResult.isErr()) {
        return err(recordIdResult.error);
      }
      parsed.push(recordIdResult.value);
    }
    return ok(parsed);
  }

  private parseTargetRecordIdSet(
    recordIds: ReadonlyArray<string> | undefined
  ): Result<ReadonlySet<string>, DomainError> {
    const parsed = new Set<string>();
    for (const rawId of recordIds ?? []) {
      const recordIdResult = RecordId.create(rawId);
      if (recordIdResult.isErr()) {
        return err(recordIdResult.error);
      }
      parsed.add(recordIdResult.value.toString());
    }
    return ok(parsed);
  }

  private async loadDeleteChunkByIds(
    context: IExecutionContext,
    plan: PreparedDeleteStreamPlan,
    batchIndex: number,
    recordIds: ReadonlyArray<RecordId>
  ): Promise<Result<PreparedDeleteChunk, DomainError>> {
    // Existence check only: ids-only read, and no SQL array_position
    // ordering (an O(ids²) sort per chunk) — the plan's id order is
    // restored in-process below.
    const queryResult = await this.tableRecordQueryRepository.find(
      context,
      plan.table,
      RecordByIdsSpec.create(recordIds),
      {
        mode: 'stored',
        projectionFieldIds: [],
        includeOrders: false,
        includeTotal: false,
        idsOnly: true,
      }
    );
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    const rowsById = new Map(queryResult.value.records.map((record) => [record.id, record]));
    const orderedRecords = recordIds.flatMap((recordId) => {
      const row = rowsById.get(recordId.toString());
      return row ? [row] : [];
    });

    return ok(
      this.prepareDeleteChunkFromRecords(
        plan.table,
        batchIndex,
        orderedRecords,
        plan.excludedRecordIds,
        { includeFallbackSnapshots: false }
      )
    );
  }

  private async loadDeleteChunkByRange(
    context: IExecutionContext,
    plan: Extract<PreparedDeleteStreamPlan, { mode: 'ranges' }>,
    batchIndex: number,
    queryStartRow: number,
    rowCount: number
  ): Promise<Result<PreparedDeleteChunk, DomainError>> {
    const queryResult = await this.queryRecordsForRange(
      context,
      plan.table,
      plan.filterSpec,
      plan.orderBy,
      plan.search,
      queryStartRow,
      queryStartRow + rowCount - 1,
      {
        projectionFieldIds: [],
        includeOrders: false,
        includeTotal: false,
        idsOnly: true,
      }
    );
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    return ok(
      this.prepareDeleteChunkFromRecords(
        plan.table,
        batchIndex,
        queryResult.value,
        plan.excludedRecordIds,
        { includeFallbackSnapshots: false }
      )
    );
  }

  private async prepareDeletePluginExecution(
    context: IExecutionContext,
    table: Table,
    recordIds: ReadonlyArray<RecordId>,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    orchestration: DeletePluginOrchestration,
    options?: {
      previousExecution?: RecordWritePluginExecution;
      skipScopeValidation?: boolean;
      payloadRecordCount?: number;
      filter?: RecordFilter;
    }
  ): Promise<Result<RecordWritePluginExecution | undefined, DomainError>> {
    const pluginExecutionResult = await this.recordWritePluginRunner.prepare(
      {
        kind: RecordWriteOperationKind.deleteMany,
        executionContext: context,
        table,
        orchestration,
        payload: {
          recordIds,
          recordCount: options?.payloadRecordCount ?? recordIds.length,
          ...(options?.filter != null ? { filter: options.filter } : {}),
        },
        isTransactionBound: false,
      },
      { previousExecution: options?.previousExecution }
    );
    if (pluginExecutionResult.isErr()) {
      return err(pluginExecutionResult.error);
    }

    const pluginExecution = pluginExecutionResult.value;
    const guardResult = await pluginExecution.guard();
    if (guardResult.isErr()) {
      return err(guardResult.error);
    }

    const pluginRecordSpecResult = pluginExecution.getRecordSpec();
    if (pluginRecordSpecResult.isErr()) {
      return err(pluginRecordSpecResult.error);
    }

    if (!options?.skipScopeValidation) {
      const scopeResult = await this.ensureRecordsWithinPluginScope(
        table,
        recordSnapshots,
        pluginRecordSpecResult.value
      );
      if (scopeResult.isErr()) {
        return err(scopeResult.error);
      }
    }

    return ok(pluginExecution);
  }

  private async collectRecordsToDelete(
    context: IExecutionContext,
    table: Table,
    command: DeleteByRangeCommandLike,
    options: {
      filterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
      orderBy?: ReadonlyArray<TableRecordOrderBy>;
      search?: RecordQuerySearch;
      totalCols: number;
      pageSize: number;
      projectionFieldIds?: ReadonlyArray<FieldId>;
      includeOrders?: boolean;
      includeTotal?: boolean;
    }
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const records: TableRecordReadModel[] = [];
    const pageSize = Math.max(1, options.pageSize);

    const appendRecords = async (start: number, end: number) => {
      for (let cursor = start; cursor <= end; cursor += pageSize) {
        const pageEnd = Math.min(end, cursor + pageSize - 1);
        const pageResult = await this.queryRecordsForRange(
          context,
          table,
          options.filterSpec,
          options.orderBy,
          options.search,
          cursor,
          pageEnd,
          {
            projectionFieldIds: options.projectionFieldIds,
            includeOrders: options.includeOrders,
            includeTotal: options.includeTotal,
          }
        );
        if (pageResult.isErr()) {
          return err(pageResult.error);
        }

        records.push(...pageResult.value);
      }

      return ok(undefined);
    };

    if (command.rangeType === 'rows') {
      for (const [startRow, endRow] of command.rawRanges) {
        const appendResult = await appendRecords(startRow, endRow);
        if (appendResult.isErr()) {
          return err(appendResult.error);
        }
      }
      return ok(records);
    }

    if (command.rangeType === 'columns') {
      const countLimitResult = PageLimit.create(1);
      if (countLimitResult.isErr()) {
        return ok(records);
      }

      const countPagination = OffsetPagination.create(countLimitResult.value, PageOffset.zero());
      const countResult = await this.tableRecordQueryRepository.find(
        context,
        table,
        options.filterSpec,
        {
          mode: 'stored',
          pagination: countPagination,
          orderBy: options.orderBy,
          search: options.search,
          includeTotal: true,
        }
      );
      if (countResult.isErr()) {
        return err(countResult.error);
      }

      const totalRows = countResult.value.total;
      if (totalRows <= 0) {
        return ok(records);
      }

      const appendResult = await appendRecords(0, totalRows - 1);
      if (appendResult.isErr()) {
        return err(appendResult.error);
      }
      return ok(records);
    }

    const normalizedRanges = normalizeRanges(
      command.rawRanges,
      command.rangeType,
      0,
      options.totalCols
    );
    const [[, startRow], [, endRow]] = normalizedRanges;
    const appendResult = await appendRecords(startRow, endRow);
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    return ok(records);
  }

  private async queryRecordsForRange(
    context: IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined,
    start: number,
    end: number,
    options?: {
      projectionFieldIds?: ReadonlyArray<FieldId>;
      includeOrders?: boolean;
      includeTotal?: boolean;
      idsOnly?: boolean;
    }
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const count = end - start + 1;
    if (count <= 0) {
      return ok([]);
    }

    const limitResult = PageLimit.create(count);
    if (limitResult.isErr()) {
      return ok([]);
    }

    const offsetResult = PageOffset.create(start);
    if (offsetResult.isErr()) {
      return ok([]);
    }

    const pagination = OffsetPagination.create(limitResult.value, offsetResult.value);
    const queryResult = await this.tableRecordQueryRepository.find(context, table, filterSpec, {
      mode: 'stored',
      pagination,
      orderBy,
      search,
      includeOrders: options?.includeOrders,
      includeTotal: options?.includeTotal,
      projectionFieldIds: options?.projectionFieldIds,
      idsOnly: options?.idsOnly,
    });
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    return ok(queryResult.value.records);
  }

  private async countRecordsInScope(
    context: IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    search: RecordQuerySearch | undefined
  ): Promise<Result<number, DomainError>> {
    const countLimitResult = PageLimit.create(1);
    if (countLimitResult.isErr()) {
      return ok(0);
    }

    const countResult = await this.tableRecordQueryRepository.find(context, table, filterSpec, {
      mode: 'stored',
      pagination: OffsetPagination.create(countLimitResult.value, PageOffset.zero()),
      search,
      includeTotal: true,
      idsOnly: true,
    });
    if (countResult.isErr()) {
      return err(countResult.error);
    }

    return ok(countResult.value.total);
  }

  private resolveDeleteStreamRowRanges(
    command: DeleteByRangeCommandLike,
    totalRows: number,
    totalCols: number
  ): ReadonlyArray<readonly [number, number]> {
    if (totalRows <= 0) {
      return [];
    }

    if (command.rangeType === 'columns') {
      return [[0, totalRows - 1]];
    }

    if (command.rangeType === 'rows') {
      const clamped = command.rawRanges
        .map(([startRow, endRow]) => this.clampDeleteRowRange(startRow, endRow, totalRows))
        .filter((range): range is readonly [number, number] => Boolean(range))
        .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
      const merged: Array<readonly [number, number]> = [];
      for (const [startRow, endRow] of clamped) {
        const previous = merged.at(-1);
        if (previous && startRow <= previous[1] + 1) {
          merged[merged.length - 1] = [previous[0], Math.max(previous[1], endRow)];
        } else {
          merged.push([startRow, endRow]);
        }
      }
      return merged;
    }

    const [[, startRow], [, endRow]] = normalizeRanges(
      command.rawRanges,
      command.rangeType,
      totalRows,
      totalCols
    );
    const normalizedRange = this.clampDeleteRowRange(startRow, endRow, totalRows);
    return normalizedRange ? [normalizedRange] : [];
  }

  private clampDeleteRowRange(
    startRow: number,
    endRow: number,
    totalRows: number
  ): readonly [number, number] | null {
    if (totalRows <= 0) {
      return null;
    }

    const normalizedStart = Math.max(0, Math.min(startRow, endRow));
    const normalizedEnd = Math.min(totalRows - 1, Math.max(startRow, endRow));
    if (normalizedEnd < normalizedStart) {
      return null;
    }

    return [normalizedStart, normalizedEnd] as const;
  }

  private async ensureRecordsWithinPluginScope(
    table: Table,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    pluginRecordSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined
  ): Promise<Result<void, DomainError>> {
    if (!pluginRecordSpec || !recordSnapshots.length) {
      return ok(undefined);
    }

    let authorizedRecordCount = 0;
    for (const snapshot of recordSnapshots) {
      const recordResult = TableRecord.fromRawFieldValues({
        id: snapshot.id,
        tableId: table.id(),
        fields: snapshot.fields,
      });
      if (recordResult.isErr()) {
        return err(recordResult.error);
      }

      if (pluginRecordSpec.isSatisfiedBy(recordResult.value)) {
        authorizedRecordCount += 1;
      }
    }

    if (authorizedRecordCount === recordSnapshots.length) {
      return ok(undefined);
    }

    return err(
      domainError.forbidden({
        code: 'record_write_plugin.scope_forbidden',
        message: 'Record write target includes rows outside the allowed scope.',
        details: {
          operation: RecordWriteOperationKind.deleteMany,
          tableId: table.id().toString(),
          requestedRecordCount: recordSnapshots.length,
          authorizedRecordCount,
        },
      })
    );
  }

  private async deleteManyInSingleTransaction(
    context: IExecutionContext,
    plan: PreparedDeletePlan | (PreparedDeleteChunk & { table: Table }),
    pluginExecution?: RecordWritePluginExecution,
    operationId?: string,
    orchestration?: IRecordsDeletedOrchestration,
    selfLinkPatch?: SelfLinkSnapshotPatch
  ): Promise<Result<DeletePersistOutcome, DomainError>> {
    const committed = await this.domainWriteTransaction.execute<{
      recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
    }>(context, async (transactionContext) => {
      if (pluginExecution) {
        const beforePersistResult = await pluginExecution.beforePersist(transactionContext);
        if (beforePersistResult.isErr()) {
          return err(beforePersistResult.error);
        }
      }

      const deleteResult = await this.tableRecordRepository.deleteMany(
        transactionContext,
        plan.table,
        RecordByIdsSpec.create(plan.recordIds)
      );
      let persistedDelete: DeleteManyResult;
      if (deleteResult.isErr()) {
        if (isNotFoundError(deleteResult.error)) {
          persistedDelete = {};
        } else {
          return err(deleteResult.error);
        }
      } else {
        persistedDelete = deleteResult.value;
        const deletedRecordIds = persistedDelete.deletedRecords?.map((record) => record.recordId);
        if (deletedRecordIds?.length) {
          const markerResult = await persistDeletedTrashMarkers(
            this.tableRecordRepository,
            transactionContext,
            plan.table,
            {
              recordIds: deletedRecordIds,
              createdBy: context.actorId.toString(),
              createdTime: new Date().toISOString(),
              operationId,
            }
          );
          if (markerResult.isErr()) {
            return err(markerResult.error);
          }
        }
      }

      const snapshotsResult = this.resolveDeletedSnapshots(
        plan.table,
        plan.recordSnapshots,
        persistedDelete,
        selfLinkPatch
      );
      if (snapshotsResult.isErr()) {
        return err(snapshotsResult.error);
      }

      const recordSnapshots = snapshotsResult.value;
      const recordIds = recordSnapshots.map((snapshot) =>
        RecordId.create(snapshot.id)._unsafeUnwrap()
      );
      const events =
        recordSnapshots.length === 0
          ? []
          : [
              RecordsDeleted.create({
                tableId: plan.table.id(),
                baseId: plan.table.baseId(),
                recordIds,
                recordSnapshots,
                orchestration: orchestration ?? {
                  operationId,
                  totalRecordCount: recordIds.length,
                  totalChunkCount: 1,
                  chunkIndex: 0,
                  scope: 'operation',
                },
              }),
            ];

      return ok(domainWrite.fromEvents({ recordSnapshots }, events));
    });
    if (committed.isErr()) {
      return err(committed.error);
    }

    const write = committed.value;
    return ok({
      recordSnapshots: write.value.recordSnapshots,
      events: write.events,
    });
  }

  private prepareDeleteChunkFromRecords(
    table: Table,
    batchIndex: number,
    records: ReadonlyArray<TableRecordReadModel>,
    excludedRecordIds?: ReadonlySet<string>,
    options?: { includeFallbackSnapshots?: boolean }
  ): PreparedDeleteChunk {
    const recordIds: RecordId[] = [];
    const deletedRecordIds: string[] = [];
    const recordSnapshots: IDeletedRecordSnapshot[] = [];
    const includeFallbackSnapshots = options?.includeFallbackSnapshots ?? true;
    for (const record of records) {
      if (excludedRecordIds?.has(record.id)) {
        continue;
      }
      const recordIdResult = RecordId.create(record.id);
      if (recordIdResult.isOk()) {
        recordIds.push(recordIdResult.value);
        deletedRecordIds.push(record.id);
        if (includeFallbackSnapshots) {
          recordSnapshots.push(buildDeletedRecordSnapshot(table, record));
        }
      }
    }

    return {
      batchIndex,
      recordIds,
      deletedRecordIds,
      recordSnapshots,
      skippedRowCount: records.length - recordIds.length,
    };
  }

  private async finalizeDeletePlan(
    context: IExecutionContext,
    plan: PreparedDeletePlan,
    persist: DeletePersistOutcome,
    pluginExecution?: RecordWritePluginExecution
  ): Promise<Result<DeleteByRangeResult, DomainError>> {
    const { recordSnapshots, events } = persist;
    const undoRedoResult = await this.recordUndoRedoEntry(context, plan.table, recordSnapshots);
    if (undoRedoResult.isErr()) {
      return err(undoRedoResult.error);
    }

    if (pluginExecution) {
      await pluginExecution.afterCommit();
    }

    return ok({
      deletedCount: recordSnapshots.length,
      deletedRecordIds: recordSnapshots.map((snapshot) => snapshot.id),
      events,
    });
  }

  private resolveDeletedSnapshots(
    table: Table,
    fallbackSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    deleteResult: DeleteManyResult,
    selfLinkPatch?: SelfLinkSnapshotPatch
  ): Result<ReadonlyArray<IDeletedRecordSnapshot>, DomainError> {
    const persistedDeletedRecords = deleteResult.deletedRecords;

    const storedSnapshotsResult = requireStoredRecordSnapshots(
      {
        operation: 'delete',
        tableId: table.id().toString(),
        ...(fallbackSnapshots.length > 0 ? { expectedCount: fallbackSnapshots.length } : {}),
      },
      persistedDeletedRecords
    );
    if (storedSnapshotsResult.isOk()) {
      const snapshots = storedSnapshotsResult.value.map((snapshot) =>
        buildDeletedRecordSnapshot(table, snapshot)
      );
      if (!selfLinkPatch?.byRecordId || selfLinkPatch.fieldIds.length === 0) {
        return ok(snapshots);
      }
      return ok(
        snapshots.map((snapshot) => {
          const savedFields = selfLinkPatch.byRecordId?.get(snapshot.id);
          if (!savedFields) {
            return snapshot;
          }
          let updatedFields: Record<string, unknown> | undefined;
          for (const fieldId of selfLinkPatch.fieldIds) {
            const fieldKey = fieldId.toString();
            if (Object.prototype.hasOwnProperty.call(savedFields, fieldKey)) {
              if (!updatedFields) {
                updatedFields = { ...snapshot.fields };
              }
              updatedFields[fieldKey] = savedFields[fieldKey];
            }
          }
          return updatedFields ? { ...snapshot, fields: updatedFields } : snapshot;
        })
      );
    }
    if (Array.isArray(persistedDeletedRecords) && fallbackSnapshots.length > 0) {
      return ok(fallbackSnapshots);
    }
    return err(storedSnapshotsResult.error);
  }

  private resolveDeletePreReadProjectionFieldIds(table: Table): ReadonlyArray<FieldId> {
    return [table.primaryFieldId()];
  }

  private async validateDeletePluginScope(
    context: IExecutionContext,
    table: Table,
    recordIds: ReadonlyArray<RecordId>,
    pluginExecution?: RecordWritePluginExecution
  ): Promise<Result<void, DomainError>> {
    if (!pluginExecution || !recordIds.length) {
      return ok(undefined);
    }

    const pluginRecordSpecResult = pluginExecution.getRecordSpec();
    if (pluginRecordSpecResult.isErr()) {
      return err(pluginRecordSpecResult.error);
    }

    if (!pluginRecordSpecResult.value) {
      return ok(undefined);
    }

    return ensureRecordIdsWithinScope(
      context,
      table,
      recordIds,
      pluginRecordSpecResult.value,
      this.tableRecordQueryRepository,
      RecordWriteOperationKind.deleteMany,
      { projectionFieldIds: this.resolveDeletePreReadProjectionFieldIds(table) }
    );
  }

  private async recordUndoRedoEntry(
    context: IExecutionContext,
    table: Table,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>
  ): Promise<Result<void, DomainError>> {
    return this.recordDeleteUndoRedoEntry(
      context,
      table,
      recordSnapshots,
      recordSnapshots.map((snapshot) => snapshot.id)
    );
  }

  private async recordDeleteUndoRedoEntry(
    context: IExecutionContext,
    table: Table,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    deletedRecordIds: ReadonlyArray<string>,
    group?: { groupId: string; attempted: boolean }
  ): Promise<Result<void, DomainError>> {
    if (!recordSnapshots.length) {
      return ok(undefined);
    }
    const groupInput: UndoEntryGroupInput = group
      ? { groupId: group.groupId, groupPosition: group.attempted ? 'continue' : 'start' }
      : {};
    if (group) group.attempted = true;

    return this.undoRedoStackService.appendRecordDelete(toUndoRedoStackAppendContext(context), {
      tableId: table.id(),
      deletedRecords: recordSnapshots.map((snapshot) => ({
        recordId: snapshot.id,
        fields: snapshot.fields,
        ...(snapshot.version !== undefined ? { version: snapshot.version } : {}),
        ...(snapshot.orders ? { orders: snapshot.orders } : {}),
        ...(snapshot.autoNumber !== undefined ? { autoNumber: snapshot.autoNumber } : {}),
        ...(snapshot.createdTime ? { createdTime: snapshot.createdTime } : {}),
        ...(snapshot.createdBy ? { createdBy: snapshot.createdBy } : {}),
        ...(snapshot.lastModifiedTime ? { lastModifiedTime: snapshot.lastModifiedTime } : {}),
        ...(snapshot.lastModifiedBy ? { lastModifiedBy: snapshot.lastModifiedBy } : {}),
      })),
      deletedRecordIds,
      ...groupInput,
    });
  }

  private createProgressEvent(
    phase: DeleteByRangeStreamProgressEvent['phase'],
    totalCount: number,
    deletedCount: number,
    batchDeletedCount: number,
    batchIndex: number
  ): DeleteByRangeStreamProgressEvent {
    return {
      id: 'progress',
      phase,
      batchIndex,
      totalCount,
      deletedCount,
      batchDeletedCount,
    };
  }

  private createDeletePluginOrchestration(
    input: DeletePluginOrchestration
  ): DeletePluginOrchestration {
    return input;
  }

  private createDoneEvent(
    result: DeleteByRangeResult,
    totalCount: number = result.deletedCount
  ): DeleteByRangeStreamDoneEvent {
    return {
      id: 'done',
      totalCount,
      deletedCount: result.deletedCount,
      data: {
        deletedCount: result.deletedCount,
        deletedRecordIds: [...result.deletedRecordIds],
      },
    };
  }

  private createErrorEvent(
    error: DomainError,
    details: Omit<DeleteByRangeStreamErrorEvent, 'id' | 'message' | 'code' | 'localization'>
  ): DeleteByRangeStreamErrorEvent {
    return {
      id: 'error',
      ...details,
      code: error.code,
      message: error.message,
      ...(error.localization && { localization: error.localization }),
    };
  }

  private async runInSpan<T>(
    context: IExecutionContext,
    name: `teable.${string}`,
    attributes: SpanAttributes,
    callback: () => Promise<T>
  ): Promise<T> {
    const tracer = context.tracer;
    const span = tracer?.startSpan(name, {
      'teable.version': 'v2',
      'teable.component': 'service',
      'teable.operation': name.replace(/^teable\./, ''),
      ...attributes,
    });

    if (!tracer || !span) {
      return callback();
    }

    return tracer.withSpan(span, async () => {
      try {
        return await callback();
      } finally {
        span.end();
      }
    });
  }
}
