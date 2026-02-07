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
  ComputedDependencyEdge,
  ComputedUpdatePlan,
  UpdateStep,
} from '../ComputedUpdatePlanner';

export type ComputedUpdateStepDto = {
  tableId: string;
  fieldIds: string[];
  level: number;
};

export type ComputedDependencyEdgeDto = {
  fromFieldId: string;
  toFieldId: string;
  fromTableId: string;
  toTableId: string;
  linkFieldId?: string;
  propagationMode?: ComputedDependencyEdge['propagationMode'];
  /** Filter condition for conditionalFiltered mode */
  filterCondition?: {
    foreignTableId: string;
    filterDto: unknown;
  };
  order: number;
};

export type ComputedUpdateSeedGroupDto = {
  tableId: string;
  recordIds: string[];
};

export type ComputedUpdateOutboxPayload = {
  baseId: string;
  seedTableId: string;
  seedRecordIds: string[];
  extraSeedRecords: ComputedUpdateSeedGroupDto[];
  steps: ComputedUpdateStepDto[];
  edges: ComputedDependencyEdgeDto[];
  estimatedComplexity: number;
  changeType: ComputedUpdatePlan['changeType'];
  runId?: string;
  originRunIds?: string[];
  runTotalSteps?: number;
  runCompletedStepsBefore?: number;
  /** Stage depth for limiting cascading updates */
  stageDepth?: number;
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
    steps: plan.steps.map(serializeStep),
    edges: plan.edges.map(serializeEdge),
    estimatedComplexity: plan.estimatedComplexity,
    changeType: plan.changeType,
  };
};

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
}): ComputedUpdateOutboxTaskInput => {
  const payload = serializeComputedUpdatePlan(params.plan);
  const affectedTableIds = params.affectedTableIds ?? [
    ...new Set(payload.steps.map((step) => step.tableId)),
  ];
  const affectedFieldIds = params.affectedFieldIds ?? [
    ...new Set(payload.steps.flatMap((step) => step.fieldIds)),
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
                      })
                    );
                  };

                  const filterConditionResult = parseFilterCondition();
                  if (filterConditionResult && filterConditionResult.isErr()) {
                    return err(filterConditionResult.error);
                  }
                  const filterCondition = filterConditionResult?.value;

                  if (edge.linkFieldId) {
                    return FieldId.create(edge.linkFieldId).map((linkFieldId) => ({
                      linkFieldId,
                      fromFieldId,
                      toFieldId,
                      fromTableId,
                      toTableId,
                      propagationMode: propagationMode ?? 'linkTraversal',
                      filterCondition,
                      order: edge.order,
                    }));
                  }
                  return ok({
                    linkFieldId: undefined,
                    fromFieldId,
                    toFieldId,
                    fromTableId,
                    toTableId,
                    propagationMode: propagationMode ?? 'allTargetRecords',
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

  const changeType = payload.changeType;
  if (changeType !== 'insert' && changeType !== 'update' && changeType !== 'delete') {
    return err(domainError.validation({ message: 'Invalid changeType in outbox payload' }));
  }

  return ok({
    baseId: baseIdResult.value,
    seedTableId: seedTableIdResult.value,
    seedRecordIds: seedRecordIdsResult.value,
    extraSeedRecords: extraSeedRecordsResult.value,
    steps: stepsResult.value,
    edges: edgesResult.value,
    estimatedComplexity: payload.estimatedComplexity,
    changeType,
    // Note: sameTableBatches are derived from steps at planning time,
    // so we don't serialize/deserialize them. They will be empty for outbox tasks.
    sameTableBatches: [],
  });
};

const serializeStep = (step: UpdateStep): ComputedUpdateStepDto => ({
  tableId: step.tableId.toString(),
  fieldIds: step.fieldIds.map((id) => id.toString()),
  level: step.level,
});

const serializeEdge = (edge: ComputedDependencyEdge): ComputedDependencyEdgeDto => ({
  fromFieldId: edge.fromFieldId.toString(),
  toFieldId: edge.toFieldId.toString(),
  fromTableId: edge.fromTableId.toString(),
  toTableId: edge.toTableId.toString(),
  linkFieldId: edge.linkFieldId?.toString(),
  propagationMode: edge.propagationMode,
  filterCondition: edge.filterCondition
    ? {
        foreignTableId: edge.filterCondition.foreignTableId.toString(),
        filterDto: edge.filterCondition.filterDto,
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
