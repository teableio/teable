import { normalizeComputedOutboxErrorSignature } from './errorSignature';
import type { ComputedOutboxAnomaly, ComputedOutboxAnomalyGroup } from './types';

export const COMPUTED_OUTBOX_ANOMALY_GROUP_SAMPLE_LIMIT = 12;

export const buildComputedOutboxAnomalyGroupKey = (
  item: Pick<ComputedOutboxAnomaly, 'targetId' | 'kind' | 'baseId' | 'seedTableId' | 'lastError'>
): string =>
  [
    item.targetId,
    item.kind,
    item.baseId,
    item.seedTableId,
    normalizeComputedOutboxErrorSignature(item.lastError),
  ].join('\u0001');

const createComputedOutboxAnomalyGroup = (
  item: ComputedOutboxAnomaly,
  groupKey: string
): ComputedOutboxAnomalyGroup => ({
  groupKey,
  kind: item.kind,
  targetId: item.targetId,
  storage: item.storage,
  baseId: item.baseId,
  seedTableId: item.seedTableId,
  lastError: item.lastError,
  errorSignature: normalizeComputedOutboxErrorSignature(item.lastError),
  failedSql: item.failedSql,
  failureKind: item.failureKind,
  failurePhase: item.failurePhase,
  affectedTableName: item.affectedTableName,
  count: 1,
  latestOccurredAt: item.occurredAt,
  items: [item],
});

const mergeComputedOutboxAnomalyIntoGroup = (
  group: ComputedOutboxAnomalyGroup,
  item: ComputedOutboxAnomaly,
  sampleLimit: number
) => {
  group.count += 1;
  const itemOccurredAt = item.occurredAt.getTime();
  const latestOccurredAt = group.latestOccurredAt.getTime();
  const isLatest =
    itemOccurredAt > latestOccurredAt ||
    (itemOccurredAt === latestOccurredAt &&
      item.taskId.localeCompare(group.items[0]?.taskId ?? '') < 0);

  if (isLatest) {
    group.lastError = item.lastError;
    group.failedSql = item.failedSql ?? group.failedSql;
    group.failureKind = item.failureKind ?? group.failureKind;
    group.failurePhase = item.failurePhase ?? group.failurePhase;
    group.affectedTableName = item.affectedTableName ?? group.affectedTableName;
    group.latestOccurredAt = item.occurredAt;
  } else if (!group.failedSql && item.failedSql) {
    group.failedSql = item.failedSql;
    group.failureKind = item.failureKind ?? group.failureKind;
    group.failurePhase = item.failurePhase ?? group.failurePhase;
    group.affectedTableName = item.affectedTableName ?? group.affectedTableName;
  }

  if (group.items.length < sampleLimit) group.items.push(item);
};

export const groupComputedOutboxAnomalies = (
  items: ReadonlyArray<ComputedOutboxAnomaly>,
  options?: {
    groupLimit?: number;
    sampleLimit?: number;
    filter?: (group: ComputedOutboxAnomalyGroup) => boolean;
  }
): {
  groups: ComputedOutboxAnomalyGroup[];
  groupTotal: number;
  matchedGroupTotal: number;
} => {
  const groupLimit = Math.max(1, options?.groupLimit ?? 30);
  const sampleLimit = Math.max(
    1,
    options?.sampleLimit ?? COMPUTED_OUTBOX_ANOMALY_GROUP_SAMPLE_LIMIT
  );
  const groupsByKey = new Map<string, ComputedOutboxAnomalyGroup>();

  for (const item of items) {
    const groupKey = buildComputedOutboxAnomalyGroupKey(item);
    const existing = groupsByKey.get(groupKey);
    if (existing) {
      mergeComputedOutboxAnomalyIntoGroup(existing, item, sampleLimit);
      continue;
    }
    groupsByKey.set(groupKey, createComputedOutboxAnomalyGroup(item, groupKey));
  }

  const groups = [...groupsByKey.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) =>
          right.occurredAt.getTime() - left.occurredAt.getTime() ||
          left.taskId.localeCompare(right.taskId)
      ),
    }))
    .sort(
      (left, right) =>
        right.latestOccurredAt.getTime() - left.latestOccurredAt.getTime() ||
        right.count - left.count ||
        left.groupKey.localeCompare(right.groupKey)
    );
  const matched = options?.filter ? groups.filter(options.filter) : groups;

  return {
    groupTotal: groups.length,
    matchedGroupTotal: matched.length,
    groups: matched.slice(0, groupLimit),
  };
};
