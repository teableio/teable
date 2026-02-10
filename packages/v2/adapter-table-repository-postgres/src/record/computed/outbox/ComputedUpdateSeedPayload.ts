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

import type { ComputedUpdateCyclePolicy } from '../ComputedUpdatePlanner';
import type { ComputedUpdateSeedGroupDto } from './ComputedUpdateOutboxPayload';

/**
 * Impact hint for seed tasks - describes which fields changed.
 */
export type SeedImpactHintDto = {
  valueFieldIds: string[];
  linkFieldIds: string[];
};

/**
 * Payload for seed tasks.
 * Unlike computed-update which stores the full plan (steps, edges),
 * seed tasks only store the minimal trigger information.
 * The full plan is computed asynchronously by the worker.
 */
export type ComputedUpdateSeedPayload = {
  taskType: 'seed';
  baseId: string;
  seedTableId: string;
  seedRecordIds: string[];
  extraSeedRecords: ComputedUpdateSeedGroupDto[];
  changedFieldIds: string[];
  changeType: 'insert' | 'update' | 'delete';
  impact?: SeedImpactHintDto;
  cyclePolicy?: ComputedUpdateCyclePolicy;
};

/**
 * Input for creating a seed outbox task.
 */
export type ComputedUpdateSeedTaskInput = ComputedUpdateSeedPayload & {
  runId: string;
  planHash: string;
};

/**
 * Deserialized seed task domain objects.
 */
export type DeserializedSeedTask = {
  baseId: BaseId;
  seedTableId: TableId;
  seedRecordIds: RecordId[];
  extraSeedRecords: Array<{ tableId: TableId; recordIds: RecordId[] }>;
  changedFieldIds: FieldId[];
  changeType: 'insert' | 'update' | 'delete';
  impact?: {
    valueFieldIds: FieldId[];
    linkFieldIds: FieldId[];
  };
  cyclePolicy?: ComputedUpdateCyclePolicy;
};

/**
 * Serialize domain objects to seed payload.
 */
export const serializeSeedPayload = (params: {
  baseId: BaseId;
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<{ tableId: TableId; recordIds: ReadonlyArray<RecordId> }>;
  changedFieldIds: ReadonlyArray<FieldId>;
  changeType: 'insert' | 'update' | 'delete';
  impact?: {
    valueFieldIds: ReadonlyArray<FieldId>;
    linkFieldIds: ReadonlyArray<FieldId>;
  };
  cyclePolicy?: ComputedUpdateCyclePolicy;
}): ComputedUpdateSeedPayload => ({
  taskType: 'seed',
  baseId: params.baseId.toString(),
  seedTableId: params.seedTableId.toString(),
  seedRecordIds: params.seedRecordIds.map((id) => id.toString()),
  extraSeedRecords: params.extraSeedRecords.map((group) => ({
    tableId: group.tableId.toString(),
    recordIds: group.recordIds.map((id) => id.toString()),
  })),
  changedFieldIds: params.changedFieldIds.map((id) => id.toString()),
  changeType: params.changeType,
  impact: params.impact
    ? {
        valueFieldIds: params.impact.valueFieldIds.map((id) => id.toString()),
        linkFieldIds: params.impact.linkFieldIds.map((id) => id.toString()),
      }
    : undefined,
  cyclePolicy: params.cyclePolicy,
});

/**
 * Deserialize seed payload to domain objects.
 */
export const deserializeSeedPayload = (
  payload: ComputedUpdateSeedPayload
): Result<DeserializedSeedTask, DomainError> => {
  const baseIdResult = BaseId.create(payload.baseId);
  if (baseIdResult.isErr()) return err(baseIdResult.error);

  const seedTableIdResult = TableId.create(payload.seedTableId);
  if (seedTableIdResult.isErr()) return err(seedTableIdResult.error);

  // Parse seedRecordIds
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

  // Parse extraSeedRecords
  const extraSeedRecordsResult = (payload.extraSeedRecords ?? []).reduce<
    Result<Array<{ tableId: TableId; recordIds: RecordId[] }>, DomainError>
  >(
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
  if (extraSeedRecordsResult.isErr()) return err(extraSeedRecordsResult.error);

  // Parse changedFieldIds
  const changedFieldIdsResult = payload.changedFieldIds.reduce<Result<FieldId[], DomainError>>(
    (acc, fieldId) =>
      acc.andThen((ids) =>
        FieldId.create(fieldId).map((id) => {
          ids.push(id);
          return ids;
        })
      ),
    ok([])
  );
  if (changedFieldIdsResult.isErr()) return err(changedFieldIdsResult.error);

  // Validate changeType
  const changeType = payload.changeType;
  if (changeType !== 'insert' && changeType !== 'update' && changeType !== 'delete') {
    return err(domainError.validation({ message: 'Invalid changeType in seed payload' }));
  }

  const cyclePolicy = payload.cyclePolicy;
  if (cyclePolicy && cyclePolicy !== 'error' && cyclePolicy !== 'skip') {
    return err(domainError.validation({ message: 'Invalid cyclePolicy in seed payload' }));
  }

  // Parse impact if present
  let impact: DeserializedSeedTask['impact'];
  if (payload.impact) {
    const valueFieldIdsResult = payload.impact.valueFieldIds.reduce<Result<FieldId[], DomainError>>(
      (acc, fieldId) =>
        acc.andThen((ids) =>
          FieldId.create(fieldId).map((id) => {
            ids.push(id);
            return ids;
          })
        ),
      ok([])
    );
    if (valueFieldIdsResult.isErr()) return err(valueFieldIdsResult.error);

    const linkFieldIdsResult = payload.impact.linkFieldIds.reduce<Result<FieldId[], DomainError>>(
      (acc, fieldId) =>
        acc.andThen((ids) =>
          FieldId.create(fieldId).map((id) => {
            ids.push(id);
            return ids;
          })
        ),
      ok([])
    );
    if (linkFieldIdsResult.isErr()) return err(linkFieldIdsResult.error);

    impact = {
      valueFieldIds: valueFieldIdsResult.value,
      linkFieldIds: linkFieldIdsResult.value,
    };
  }

  return ok({
    baseId: baseIdResult.value,
    seedTableId: seedTableIdResult.value,
    seedRecordIds: seedRecordIdsResult.value,
    extraSeedRecords: extraSeedRecordsResult.value,
    changedFieldIds: changedFieldIdsResult.value,
    changeType,
    impact,
    cyclePolicy,
  });
};

/**
 * Compute hash for seed payload (used for task deduplication/merging).
 * Only baseId, seedTableId, and changeType are used for hash -
 * seedRecordIds can be merged across tasks with the same hash.
 */
export const computeSeedHash = (payload: ComputedUpdateSeedPayload, hasher: IHasher): string => {
  const hashInput = {
    taskType: payload.taskType,
    baseId: payload.baseId,
    seedTableId: payload.seedTableId,
    changeType: payload.changeType,
  };
  return hasher.sha256(JSON.stringify(hashInput));
};

/**
 * Build outbox task input for seed task.
 */
export const buildSeedTaskInput = (params: {
  baseId: BaseId;
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<{ tableId: TableId; recordIds: ReadonlyArray<RecordId> }>;
  changedFieldIds: ReadonlyArray<FieldId>;
  changeType: 'insert' | 'update' | 'delete';
  impact?: {
    valueFieldIds: ReadonlyArray<FieldId>;
    linkFieldIds: ReadonlyArray<FieldId>;
  };
  cyclePolicy?: ComputedUpdateCyclePolicy;
  hasher: IHasher;
  runId: string;
}): ComputedUpdateSeedTaskInput => {
  const payload = serializeSeedPayload({
    baseId: params.baseId,
    seedTableId: params.seedTableId,
    seedRecordIds: params.seedRecordIds,
    extraSeedRecords: params.extraSeedRecords,
    changedFieldIds: params.changedFieldIds,
    changeType: params.changeType,
    impact: params.impact,
    cyclePolicy: params.cyclePolicy,
  });

  return {
    ...payload,
    runId: params.runId,
    planHash: computeSeedHash(payload, params.hasher),
  };
};

/**
 * Check if a payload is a seed task.
 */
export const isSeedPayload = (payload: unknown): payload is ComputedUpdateSeedPayload => {
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { taskType?: string }).taskType === 'seed';
};

/**
 * Merge two seed payloads by combining their seedRecordIds and extraSeedRecords.
 * Returns a new payload with deduplicated record IDs.
 */
export const mergeSeedPayloads = (
  existing: ComputedUpdateSeedPayload,
  incoming: ComputedUpdateSeedPayload
): ComputedUpdateSeedPayload => {
  // Merge seedRecordIds (dedupe)
  const mergedSeedRecordIds = [...new Set([...existing.seedRecordIds, ...incoming.seedRecordIds])];

  // Merge changedFieldIds (dedupe)
  const mergedChangedFieldIds = [
    ...new Set([...existing.changedFieldIds, ...incoming.changedFieldIds]),
  ];

  // Merge extraSeedRecords by tableId
  const extraByTable = new Map<string, Set<string>>();
  for (const group of [...existing.extraSeedRecords, ...incoming.extraSeedRecords]) {
    const existing = extraByTable.get(group.tableId) ?? new Set();
    for (const recordId of group.recordIds) {
      existing.add(recordId);
    }
    extraByTable.set(group.tableId, existing);
  }
  const mergedExtraSeedRecords: ComputedUpdateSeedGroupDto[] = [];
  for (const [tableId, recordIds] of extraByTable) {
    mergedExtraSeedRecords.push({ tableId, recordIds: [...recordIds] });
  }

  // Merge impact if both have it
  let mergedImpact: SeedImpactHintDto | undefined;
  if (existing.impact || incoming.impact) {
    const valueFieldIds = new Set<string>();
    const linkFieldIds = new Set<string>();
    if (existing.impact) {
      existing.impact.valueFieldIds.forEach((id) => valueFieldIds.add(id));
      existing.impact.linkFieldIds.forEach((id) => linkFieldIds.add(id));
    }
    if (incoming.impact) {
      incoming.impact.valueFieldIds.forEach((id) => valueFieldIds.add(id));
      incoming.impact.linkFieldIds.forEach((id) => linkFieldIds.add(id));
    }
    mergedImpact = {
      valueFieldIds: [...valueFieldIds],
      linkFieldIds: [...linkFieldIds],
    };
  }

  const mergedCyclePolicy =
    existing.cyclePolicy === 'skip' || incoming.cyclePolicy === 'skip'
      ? 'skip'
      : existing.cyclePolicy ?? incoming.cyclePolicy;

  return {
    taskType: 'seed',
    baseId: existing.baseId,
    seedTableId: existing.seedTableId,
    seedRecordIds: mergedSeedRecordIds,
    extraSeedRecords: mergedExtraSeedRecords,
    changedFieldIds: mergedChangedFieldIds,
    changeType: existing.changeType, // Keep the existing changeType
    impact: mergedImpact,
    cyclePolicy: mergedCyclePolicy,
  };
};
