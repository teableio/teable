import {
  BaseId,
  domainError,
  FieldId,
  RecordId,
  TableId,
  type DomainError,
  type IHasher,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DirtyRecordStats } from '../ComputedFieldUpdater';
import type {
  AllTargetRecordsReason,
  ComputedBeforeImageRecord,
  ComputedDependencyEdge,
  ComputedUpdatePlan,
  SameTableBatch,
  UpdateStep,
} from '../ComputedUpdatePlanner';
import { isAllTargetRecordsReason } from '../ComputedUpdatePlanner';

export type ComputedUpdateStepDto = {
  tableId: string;
  fieldIds: string[];
  level: number;
};

export type SameTableBatchDto = {
  tableId: string;
  steps: ComputedUpdateStepDto[];
  minLevel: number;
  maxLevel: number;
};

export type ComputedDependencyEdgeDto = {
  fromFieldId: string;
  toFieldId: string;
  /**
   * All target computed fields covered by this (deduplicated) propagation edge.
   * Absent only on payloads serialized before this field existed; consumers must
   * fall back to table-granular handling for such edges.
   */
  propagationTargetFieldIds?: string[];
  /** Absent in old tasks; never infer complete provenance from fromFieldId. */
  propagationSourceFieldIds?: string[];
  fromTableId: string;
  toTableId: string;
  linkFieldId?: string;
  propagationMode?: ComputedDependencyEdge['propagationMode'];
  allTargetRecordsReasons?: AllTargetRecordsReason[];
  /** Filter condition for conditionalFiltered mode */
  filterCondition?: {
    foreignTableId: string;
    filterDto: unknown;
    includeBeforeImage?: boolean;
  };
  order: number;
};

export type ComputedUpdateSeedGroupDto = {
  tableId: string;
  recordIds: string[];
};

export type ComputedBeforeImageRecordDto = {
  recordId: string;
  fieldValuesByDbName: Record<string, unknown>;
};

export type ComputedRealtimeOrchestrationDto = {
  operationId?: string;
  groupId?: string;
  totalRecordCount: number;
  totalChunkCount: number;
  chunkIndex: number;
  scope: 'operation' | 'chunk';
};

export const mergeBeforeImageRecordDtos = (
  existing: ReadonlyArray<ComputedBeforeImageRecordDto>,
  incoming: ReadonlyArray<ComputedBeforeImageRecordDto>
): ComputedBeforeImageRecordDto[] => {
  const byRecordId = new Map<string, Record<string, unknown>>();

  const merge = (records: ReadonlyArray<ComputedBeforeImageRecordDto>): void => {
    for (const record of records) {
      const existingFields = byRecordId.get(record.recordId);
      if (!existingFields) {
        byRecordId.set(record.recordId, { ...record.fieldValuesByDbName });
        continue;
      }

      for (const [dbFieldName, oldValue] of Object.entries(record.fieldValuesByDbName)) {
        if (!(dbFieldName in existingFields)) {
          existingFields[dbFieldName] = oldValue;
        }
      }
    }
  };

  merge(existing);
  merge(incoming);

  return [...byRecordId].map(([recordId, fieldValuesByDbName]) => ({
    recordId,
    fieldValuesByDbName,
  }));
};

export type ComputedUpdateOutboxPayload = {
  baseId: string;
  seedTableId: string;
  seedRecordIds: string[];
  extraSeedRecords: ComputedUpdateSeedGroupDto[];
  beforeImageRecords: ComputedBeforeImageRecordDto[];
  steps: ComputedUpdateStepDto[];
  sameTableBatches?: SameTableBatchDto[];
  edges: ComputedDependencyEdgeDto[];
  estimatedComplexity: number;
  changeType: ComputedUpdatePlan['changeType'];
  runId?: string;
  originRunIds?: string[];
  runTotalSteps?: number;
  runCompletedStepsBefore?: number;
  /** Stage depth for limiting cascading updates */
  stageDepth?: number;
  /** Table IDs where ALL records should be seeded as dirty (avoids storing individual record IDs) */
  seedAllTableIds?: string[];
  /** Whole-table seeding resume cursors (last seeded __id per table id). */
  seedAllCursors?: Record<string, string>;
  /** Stage-ledger scope (continuation chain root task id). */
  ledgerScopeId?: string;
  orchestration?: ComputedRealtimeOrchestrationDto;
};

export type ComputedUpdateRunMeta = {
  runId: string;
  originRunIds: string[];
  runTotalSteps: number;
  runCompletedStepsBefore: number;
};

export type ComputedUpdateOutboxTaskInput = ComputedUpdateOutboxPayload &
  ComputedUpdateRunMeta & {
    planHash: string;
    dirtyStats?: ReadonlyArray<DirtyRecordStats>;
    affectedTableIds: string[];
    affectedFieldIds: string[];
    syncMaxLevel: number;
    /**
     * Earliest source-mutation time the task's work traces back to. Carried
     * forward across stage continuations so the run-history ledger can derive
     * source-change → converged end-to-end latency. Absent on fresh enqueues:
     * the outbox stamps `now` at insert.
     */
    sourceChangedAt?: Date;
    /** Original mutation field ids for this run. Bounded by schema width. */
    sourceFieldIds?: ReadonlyArray<string>;
    /** Task this continuation was staged from (lineage chain pointer). */
    predecessorTaskId?: string;
  };

export type ComputedUpdateOutboxItem = ComputedUpdateOutboxTaskInput & {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'dead';
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const serializeComputedUpdatePlan = (
  plan: ComputedUpdatePlan
): ComputedUpdateOutboxPayload => {
  return {
    baseId: plan.baseId.toString(),
    seedTableId: plan.seedTableId.toString(),
    seedRecordIds: plan.seedRecordIds.map((id) => id.toString()),
    extraSeedRecords: serializeSeedGroups(plan.extraSeedRecords),
    beforeImageRecords: serializeBeforeImageRecords(plan.beforeImageRecords ?? []),
    steps: plan.steps.map(serializeStep),
    sameTableBatches: plan.sameTableBatches.map(serializeSameTableBatch),
    edges: plan.edges.map(serializeEdge),
    estimatedComplexity: plan.estimatedComplexity,
    changeType: plan.changeType,
    seedAllTableIds: plan.seedAllTableIds?.map((id) => id.toString()),
    seedAllCursors:
      plan.seedAllCursors && Object.keys(plan.seedAllCursors).length > 0
        ? { ...plan.seedAllCursors }
        : undefined,
    ledgerScopeId: plan.ledgerScopeId,
  };
};

/**
 * Lineage-scoped idempotency key for stage continuations: same-shape continuations
 * from different runs, stages, or predecessor tasks must never merge in the outbox,
 * or run progress, retries, and activity attribution blur together.
 */
export const buildContinuationPlanHash = (
  basePlanHash: string,
  lineage: { runId: string; stageIndex: number; predecessorTaskId: string }
): string =>
  `${basePlanHash}:run:${lineage.runId}:stage:${lineage.stageIndex}:from:${lineage.predecessorTaskId}`;

export const computePlanHash = (payload: ComputedUpdateOutboxPayload, hasher: IHasher): string => {
  const hashInput = {
    baseId: payload.baseId,
    seedTableId: payload.seedTableId,
    changeType: payload.changeType,
    steps: payload.steps,
    edges: payload.edges,
  };
  return hasher.sha256(JSON.stringify(hashInput));
};

export const buildOutboxTaskInput = (params: {
  plan: ComputedUpdatePlan;
  dirtyStats?: ReadonlyArray<DirtyRecordStats>;
  syncMaxLevel: number;
  hasher: IHasher;
  runId: string;
  originRunIds: string[];
  runTotalSteps: number;
  runCompletedStepsBefore: number;
  affectedTableIds?: string[];
  affectedFieldIds?: string[];
  stageDepth?: number;
  sourceChangedAt?: Date;
  predecessorTaskId?: string;
  /** Original mutation field ids for this run. Bounded by schema width. */
  sourceFieldIds?: ReadonlyArray<string>;
  orchestration?: ComputedRealtimeOrchestrationDto;
}): ComputedUpdateOutboxTaskInput => {
  const payload = serializeComputedUpdatePlan(params.plan);
  const affectedTableIds = params.affectedTableIds ?? [
    ...new Set([
      ...payload.steps.map((step) => step.tableId),
      ...payload.edges.map((edge) => edge.toTableId),
    ]),
  ];
  const stepOutputFieldIds = payload.steps.flatMap((step) => step.fieldIds);
  const affectedFieldIds = params.affectedFieldIds ?? [
    ...new Set(
      stepOutputFieldIds.length > 0
        ? stepOutputFieldIds
        : payload.edges.flatMap((edge) => edge.propagationTargetFieldIds ?? [edge.toFieldId])
    ),
  ];

  return {
    ...payload,
    runId: params.runId,
    originRunIds: params.originRunIds,
    runTotalSteps: params.runTotalSteps,
    runCompletedStepsBefore: params.runCompletedStepsBefore,
    planHash: computePlanHash(payload, params.hasher),
    dirtyStats: params.dirtyStats,
    affectedTableIds,
    affectedFieldIds,
    syncMaxLevel: params.syncMaxLevel,
    stageDepth: params.stageDepth ?? 0,
    sourceChangedAt: params.sourceChangedAt,
    predecessorTaskId: params.predecessorTaskId,
    ...(params.sourceFieldIds?.length ? { sourceFieldIds: [...params.sourceFieldIds] } : {}),
    orchestration: params.orchestration,
  };
};

export const mergeComputedRealtimeOrchestration = (
  existing: ComputedRealtimeOrchestrationDto | undefined,
  incoming: ComputedRealtimeOrchestrationDto | undefined
): ComputedRealtimeOrchestrationDto | undefined => {
  if (!existing) return incoming ? { ...incoming } : undefined;
  if (!incoming) return { ...existing };

  const sameOperationId = existing.operationId && existing.operationId === incoming.operationId;
  const sameGroupId = existing.groupId && existing.groupId === incoming.groupId;

  if (!sameOperationId && !sameGroupId) {
    return undefined;
  }

  return {
    operationId: sameOperationId ? existing.operationId : undefined,
    groupId: sameGroupId ? existing.groupId : undefined,
    totalRecordCount: Math.max(existing.totalRecordCount, incoming.totalRecordCount),
    totalChunkCount: Math.max(existing.totalChunkCount, incoming.totalChunkCount),
    chunkIndex: Math.min(existing.chunkIndex, incoming.chunkIndex),
    scope: existing.scope === 'operation' || incoming.scope === 'operation' ? 'operation' : 'chunk',
  };
};

export const deserializeComputedUpdatePlan = (
  payload: ComputedUpdateOutboxPayload
): Result<ComputedUpdatePlan, DomainError> => {
  const baseIdResult = BaseId.create(payload.baseId);
  if (baseIdResult.isErr()) return err(baseIdResult.error);
  const seedTableIdResult = TableId.create(payload.seedTableId);
  if (seedTableIdResult.isErr()) return err(seedTableIdResult.error);

  const seedRecordIdsResult = payload.seedRecordIds.reduce<Result<RecordId[], DomainError>>(
    (acc, recordId) =>
      acc.andThen((ids) =>
        RecordId.create(recordId).map((id) => {
          ids.push(id);
          return ids;
        })
      ),
    ok([])
  );
  if (seedRecordIdsResult.isErr()) return err(seedRecordIdsResult.error);

  const stepsResult = payload.steps.reduce<Result<UpdateStep[], DomainError>>(
    (acc, step) =>
      acc.andThen((steps) =>
        TableId.create(step.tableId)
          .andThen((tableId) =>
            step.fieldIds
              .reduce<Result<FieldId[], DomainError>>(
                (fieldAcc, fieldId) =>
                  fieldAcc.andThen((fieldIds) =>
                    FieldId.create(fieldId).map((id) => {
                      fieldIds.push(id);
                      return fieldIds;
                    })
                  ),
                ok([])
              )
              .map((fieldIds) => ({ tableId, fieldIds, level: step.level }))
          )
          .map((resolved) => {
            steps.push(resolved);
            return steps;
          })
      ),
    ok([])
  );
  if (stepsResult.isErr()) return err(stepsResult.error);

  const sameTableBatchesResult = (payload.sameTableBatches ?? []).reduce<
    Result<SameTableBatch[], DomainError>
  >(
    (acc, batch) =>
      acc.andThen((batches) =>
        TableId.create(batch.tableId).andThen((tableId) => {
          const batchStepsResult = batch.steps.reduce<Result<UpdateStep[], DomainError>>(
            (stepAcc, step) =>
              stepAcc.andThen((steps) =>
                TableId.create(step.tableId)
                  .andThen((stepTableId) =>
                    step.fieldIds
                      .reduce<Result<FieldId[], DomainError>>(
                        (fieldAcc, fieldId) =>
                          fieldAcc.andThen((fieldIds) =>
                            FieldId.create(fieldId).map((id) => {
                              fieldIds.push(id);
                              return fieldIds;
                            })
                          ),
                        ok([])
                      )
                      .map((fieldIds) => ({ tableId: stepTableId, fieldIds, level: step.level }))
                  )
                  .map((resolved) => {
                    steps.push(resolved);
                    return steps;
                  })
              ),
            ok([])
          );

          return batchStepsResult.map((steps) => {
            batches.push({
              tableId,
              steps,
              minLevel: batch.minLevel,
              maxLevel: batch.maxLevel,
            });
            return batches;
          });
        })
      ),
    ok([])
  );
  if (sameTableBatchesResult.isErr()) return err(sameTableBatchesResult.error);

  const edgesResult = payload.edges.reduce<Result<ComputedDependencyEdge[], DomainError>>(
    (acc, edge) =>
      acc.andThen((edges) => {
        const propagationMode = edge.propagationMode;
        if (
          propagationMode !== undefined &&
          propagationMode !== 'linkTraversal' &&
          propagationMode !== 'allTargetRecords' &&
          propagationMode !== 'conditionalFiltered'
        ) {
          return err(
            domainError.validation({ message: 'Invalid propagationMode in outbox payload' })
          );
        }

        if (
          edge.allTargetRecordsReasons?.some(
            (reason) => typeof reason !== 'string' || !isAllTargetRecordsReason(reason)
          )
        ) {
          return err(
            domainError.validation({ message: 'Invalid allTargetRecordsReasons in outbox payload' })
          );
        }

        return TableId.create(edge.fromTableId)
          .andThen((fromTableId) =>
            TableId.create(edge.toTableId).andThen((toTableId) =>
              FieldId.create(edge.fromFieldId).andThen((fromFieldId) =>
                FieldId.create(edge.toFieldId).andThen((toFieldId) => {
                  // Parse optional filterCondition
                  const parseFilterCondition = ():
                    | Result<
                        { foreignTableId: TableId; filterDto: unknown } | undefined,
                        DomainError
                      >
                    | undefined => {
                    if (!edge.filterCondition) return ok(undefined);
                    return TableId.create(edge.filterCondition.foreignTableId).map(
                      (foreignTableId) => ({
                        foreignTableId,
                        filterDto: edge.filterCondition!.filterDto,
                        includeBeforeImage: edge.filterCondition!.includeBeforeImage,
                      })
                    );
                  };

                  const filterConditionResult = parseFilterCondition();
                  if (filterConditionResult && filterConditionResult.isErr()) {
                    return err(filterConditionResult.error);
                  }
                  const filterCondition = filterConditionResult?.value;

                  const targetFieldIdsResult = (edge.propagationTargetFieldIds ?? []).reduce<
                    Result<FieldId[], DomainError>
                  >(
                    (targetAcc, targetFieldId) =>
                      targetAcc.andThen((targetIds) =>
                        FieldId.create(targetFieldId).map((id) => {
                          targetIds.push(id);
                          return targetIds;
                        })
                      ),
                    ok([])
                  );
                  if (targetFieldIdsResult.isErr()) return err(targetFieldIdsResult.error);
                  const propagationTargetFieldIds =
                    targetFieldIdsResult.value.length > 0 ? targetFieldIdsResult.value : undefined;

                  if (
                    edge.propagationSourceFieldIds !== undefined &&
                    !Array.isArray(edge.propagationSourceFieldIds)
                  ) {
                    return err(
                      domainError.validation({
                        message: 'Invalid propagationSourceFieldIds in outbox payload',
                      })
                    );
                  }
                  const sourceFieldIdsResult = (edge.propagationSourceFieldIds ?? []).reduce<
                    Result<FieldId[], DomainError>
                  >(
                    (sourceAcc, rawId) =>
                      sourceAcc.andThen((ids) => FieldId.create(rawId).map((id) => [...ids, id])),
                    ok([])
                  );
                  if (sourceFieldIdsResult.isErr()) return err(sourceFieldIdsResult.error);
                  const propagationSourceFieldIds = sourceFieldIdsResult.value.length
                    ? sourceFieldIdsResult.value
                    : undefined;
                  if (
                    propagationSourceFieldIds &&
                    !propagationSourceFieldIds.some((id) => id.equals(fromFieldId))
                  ) {
                    return err(
                      domainError.validation({
                        message: 'Source provenance must contain fromFieldId',
                      })
                    );
                  }

                  if (edge.linkFieldId) {
                    return FieldId.create(edge.linkFieldId).map((linkFieldId) => ({
                      linkFieldId,
                      fromFieldId,
                      toFieldId,
                      propagationTargetFieldIds,
                      propagationSourceFieldIds,
                      fromTableId,
                      toTableId,
                      propagationMode: propagationMode ?? 'linkTraversal',
                      allTargetRecordsReasons: edge.allTargetRecordsReasons,
                      filterCondition,
                      order: edge.order,
                    }));
                  }
                  return ok({
                    linkFieldId: undefined,
                    fromFieldId,
                    toFieldId,
                    propagationTargetFieldIds,
                    propagationSourceFieldIds,
                    fromTableId,
                    toTableId,
                    propagationMode: propagationMode ?? 'allTargetRecords',
                    allTargetRecordsReasons: edge.allTargetRecordsReasons,
                    filterCondition,
                    order: edge.order,
                  });
                })
              )
            )
          )
          .map((resolved) => {
            edges.push(resolved);
            return edges;
          });
      }),
    ok([])
  );
  if (edgesResult.isErr()) return err(edgesResult.error);

  const extraSeedRecordsResult = deserializeSeedGroups(payload.extraSeedRecords ?? []);
  if (extraSeedRecordsResult.isErr()) return err(extraSeedRecordsResult.error);
  const beforeImageRecordsResult = deserializeBeforeImageRecords(payload.beforeImageRecords ?? []);
  if (beforeImageRecordsResult.isErr()) return err(beforeImageRecordsResult.error);

  const changeType = payload.changeType;
  if (changeType !== 'insert' && changeType !== 'update' && changeType !== 'delete') {
    return err(domainError.validation({ message: 'Invalid changeType in outbox payload' }));
  }

  return ok({
    baseId: baseIdResult.value,
    seedTableId: seedTableIdResult.value,
    seedRecordIds: seedRecordIdsResult.value,
    extraSeedRecords: extraSeedRecordsResult.value,
    beforeImageRecords: beforeImageRecordsResult.value,
    steps: stepsResult.value,
    edges: edgesResult.value,
    estimatedComplexity: payload.estimatedComplexity,
    changeType,
    sameTableBatches: sameTableBatchesResult.value,
    seedAllTableIds: payload.seedAllTableIds?.reduce<TableId[]>((acc, id) => {
      const result = TableId.create(id);
      if (result.isOk()) acc.push(result.value);
      return acc;
    }, []),
    seedAllCursors:
      payload.seedAllCursors && Object.keys(payload.seedAllCursors).length > 0
        ? { ...payload.seedAllCursors }
        : undefined,
    ledgerScopeId: payload.ledgerScopeId,
  });
};

const serializeStep = (step: UpdateStep): ComputedUpdateStepDto => ({
  tableId: step.tableId.toString(),
  fieldIds: step.fieldIds.map((id) => id.toString()),
  level: step.level,
});

const serializeSameTableBatch = (batch: SameTableBatch): SameTableBatchDto => ({
  tableId: batch.tableId.toString(),
  steps: batch.steps.map(serializeStep),
  minLevel: batch.minLevel,
  maxLevel: batch.maxLevel,
});

const serializeEdge = (edge: ComputedDependencyEdge): ComputedDependencyEdgeDto => ({
  fromFieldId: edge.fromFieldId.toString(),
  toFieldId: edge.toFieldId.toString(),
  ...(edge.propagationSourceFieldIds?.length
    ? {
        propagationSourceFieldIds: [
          ...new Set(edge.propagationSourceFieldIds.map((id) => id.toString())),
        ].sort(),
      }
    : {}),
  // Always emit targets (defaulting to toFieldId) so deserialized edges keep
  // field-granular target info; presence marks the info as trustworthy.
  propagationTargetFieldIds: [
    ...new Set(
      (edge.propagationTargetFieldIds ?? [edge.toFieldId]).map((fieldId) => fieldId.toString())
    ),
  ],
  fromTableId: edge.fromTableId.toString(),
  toTableId: edge.toTableId.toString(),
  linkFieldId: edge.linkFieldId?.toString(),
  propagationMode: edge.propagationMode,
  allTargetRecordsReasons: edge.allTargetRecordsReasons
    ? [...edge.allTargetRecordsReasons]
    : undefined,
  filterCondition: edge.filterCondition
    ? {
        foreignTableId: edge.filterCondition.foreignTableId.toString(),
        filterDto: edge.filterCondition.filterDto,
        includeBeforeImage: edge.filterCondition.includeBeforeImage,
      }
    : undefined,
  order: edge.order,
});

const serializeSeedGroups = (
  groups: ReadonlyArray<{ tableId: TableId; recordIds: ReadonlyArray<RecordId> }>
): ComputedUpdateSeedGroupDto[] => {
  return groups.map((group) => ({
    tableId: group.tableId.toString(),
    recordIds: group.recordIds.map((recordId) => recordId.toString()),
  }));
};

const deserializeSeedGroups = (
  groups: ReadonlyArray<ComputedUpdateSeedGroupDto>
): Result<Array<{ tableId: TableId; recordIds: RecordId[] }>, DomainError> => {
  return groups.reduce<Result<Array<{ tableId: TableId; recordIds: RecordId[] }>, DomainError>>(
    (acc, group) =>
      acc.andThen((parsed) =>
        TableId.create(group.tableId)
          .andThen((tableId) =>
            group.recordIds
              .reduce<Result<RecordId[], DomainError>>(
                (recordAcc, recordId) =>
                  recordAcc.andThen((recordIds) =>
                    RecordId.create(recordId).map((id) => {
                      recordIds.push(id);
                      return recordIds;
                    })
                  ),
                ok([])
              )
              .map((recordIds) => ({ tableId, recordIds }))
          )
          .map((entry) => {
            parsed.push(entry);
            return parsed;
          })
      ),
    ok([])
  );
};

const serializeBeforeImageRecords = (
  records: ReadonlyArray<ComputedBeforeImageRecord>
): ComputedBeforeImageRecordDto[] =>
  records.map((record) => ({
    recordId: record.recordId.toString(),
    fieldValuesByDbName: { ...record.fieldValuesByDbName },
  }));

const deserializeBeforeImageRecords = (
  records: ReadonlyArray<ComputedBeforeImageRecordDto>
): Result<ComputedBeforeImageRecord[], DomainError> => {
  return records.reduce<Result<ComputedBeforeImageRecord[], DomainError>>(
    (acc, record) =>
      acc.andThen((parsed) =>
        RecordId.create(record.recordId).map((recordId) => {
          parsed.push({
            recordId,
            fieldValuesByDbName: { ...record.fieldValuesByDbName },
          });
          return parsed;
        })
      ),
    ok([])
  );
};
