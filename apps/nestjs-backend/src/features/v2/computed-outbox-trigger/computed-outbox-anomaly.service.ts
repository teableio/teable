import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  createComputedOutboxWakeup,
  defaultComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';

import type {
  IComputedOutboxMaintenanceAnomaly,
  IComputedOutboxMaintenanceTarget,
} from '../../../global/data-db-client-manager.service';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import {
  COMPUTED_OUTBOX_ANOMALY_FETCH_CAP,
  COMPUTED_OUTBOX_ANOMALY_GROUP_SAMPLE_LIMIT,
  COMPUTED_OUTBOX_WAKEUP_PUBLISHER,
} from './constants';
import { mapWithConcurrency } from './map-with-concurrency';

export type ComputedOutboxAnomaly = IComputedOutboxMaintenanceAnomaly & {
  targetId: string;
  storage: IComputedOutboxMaintenanceTarget['storage'];
};

export type ComputedOutboxAnomalyGroup = {
  groupKey: string;
  kind: ComputedOutboxAnomaly['kind'];
  targetId: string;
  storage: ComputedOutboxAnomaly['storage'];
  baseId: string;
  seedTableId: string;
  lastError: string | null;
  failedSql: string | null;
  failureKind: string | null;
  failurePhase: string | null;
  affectedTableName: string | null;
  count: number;
  latestOccurredAt: Date;
  items: ComputedOutboxAnomaly[];
};

export const buildComputedOutboxAnomalyGroupKey = (
  item: Pick<ComputedOutboxAnomaly, 'kind' | 'baseId' | 'seedTableId' | 'lastError'>
): string =>
  [item.kind, item.baseId, item.seedTableId, (item.lastError ?? '').slice(0, 500)].join('\u0001');

export const groupComputedOutboxAnomalies = (
  items: ReadonlyArray<ComputedOutboxAnomaly>,
  options?: { groupLimit?: number; sampleLimit?: number }
): {
  groups: ComputedOutboxAnomalyGroup[];
  groupTotal: number;
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
    if (!existing) {
      groupsByKey.set(groupKey, {
        groupKey,
        kind: item.kind,
        targetId: item.targetId,
        storage: item.storage,
        baseId: item.baseId,
        seedTableId: item.seedTableId,
        lastError: item.lastError,
        failedSql: item.failedSql,
        failureKind: item.failureKind,
        failurePhase: item.failurePhase,
        affectedTableName: item.affectedTableName,
        count: 1,
        latestOccurredAt: item.occurredAt,
        items: [item],
      });
      continue;
    }

    existing.count += 1;
    if (
      item.occurredAt.getTime() > existing.latestOccurredAt.getTime() ||
      (item.occurredAt.getTime() === existing.latestOccurredAt.getTime() &&
        item.taskId.localeCompare(existing.items[0]?.taskId ?? '') < 0)
    ) {
      existing.targetId = item.targetId;
      existing.storage = item.storage;
      existing.lastError = item.lastError;
      existing.failedSql = item.failedSql ?? existing.failedSql;
      existing.failureKind = item.failureKind ?? existing.failureKind;
      existing.failurePhase = item.failurePhase ?? existing.failurePhase;
      existing.affectedTableName = item.affectedTableName ?? existing.affectedTableName;
      existing.latestOccurredAt = item.occurredAt;
    } else if (!existing.failedSql && item.failedSql) {
      existing.failedSql = item.failedSql;
      existing.failureKind = item.failureKind ?? existing.failureKind;
      existing.failurePhase = item.failurePhase ?? existing.failurePhase;
      existing.affectedTableName = item.affectedTableName ?? existing.affectedTableName;
    }

    if (existing.items.length < sampleLimit) {
      existing.items.push(item);
    }
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

  return {
    groupTotal: groups.length,
    groups: groups.slice(0, groupLimit),
  };
};

@Injectable()
export class ComputedOutboxAnomalyService {
  private readonly logger = new Logger(ComputedOutboxAnomalyService.name);

  constructor(
    private readonly dataDbClientManager: DataDbClientManager,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher
  ) {}

  async list(groupLimit: number): Promise<{
    sampledAt: string;
    total: number;
    groupTotal: number;
    groups: ComputedOutboxAnomalyGroup[];
    unavailableTargetCount: number;
  }> {
    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const fetchLimit = Math.min(COMPUTED_OUTBOX_ANOMALY_FETCH_CAP, Math.max(groupLimit * 40, 200));
    const results = await mapWithConcurrency(targets, 4, async (target) => {
      try {
        const snapshot = await this.dataDbClientManager.listComputedOutboxMaintenanceAnomalies(
          target,
          defaultComputedUpdateOutboxConfig.processingLeaseMs,
          fetchLimit
        );
        return { target, snapshot };
      } catch (error) {
        this.logger.warn('computed:outbox:anomaly_target_failed', {
          targetId: target.cacheKey,
          storage: target.storage,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return { target };
      }
    });

    const items = results
      .flatMap((result) =>
        (result.snapshot?.items ?? []).map((item) => ({
          ...item,
          targetId: result.target.cacheKey,
          storage: result.target.storage,
        }))
      )
      .sort(
        (left, right) =>
          right.occurredAt.getTime() - left.occurredAt.getTime() ||
          left.taskId.localeCompare(right.taskId)
      );

    const { groups, groupTotal } = groupComputedOutboxAnomalies(items, { groupLimit });

    return {
      sampledAt: new Date().toISOString(),
      total: results.reduce((sum, result) => sum + (result.snapshot?.total ?? 0), 0),
      groupTotal,
      groups,
      unavailableTargetCount: results.filter((result) => !result.snapshot).length,
    };
  }

  async recover(input: { targetId: string; taskId: string; kind: 'dead' | 'stale' }): Promise<{
    taskId: string;
    kind: 'dead' | 'stale';
    recovered: true;
    delivery: 'accepted' | 'deferred';
  }> {
    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const target = targets.find((candidate) => candidate.cacheKey === input.targetId);
    if (!target) throw new NotFoundException('Computed outbox storage target not found');

    const recovery = await this.dataDbClientManager.recoverComputedOutboxMaintenanceAnomaly(
      target,
      input.taskId,
      input.kind,
      defaultComputedUpdateOutboxConfig.processingLeaseMs
    );
    if (recovery.status !== 'recovered') {
      if (recovery.status === 'conflict') {
        throw new ConflictException('An equivalent pending computed task already exists');
      }
      throw new NotFoundException('Computed outbox anomaly no longer exists');
    }

    let delivery: 'accepted' | 'deferred' = 'deferred';
    try {
      const outcome = await this.wakeupPublisher.runAsConsumer(() =>
        this.wakeupPublisher.publish(
          createComputedOutboxWakeup({
            taskId: input.taskId,
            baseId: recovery.baseId,
            availableAt: new Date(),
            cause: 'replay',
          })
        )
      );
      if (outcome.status === 'accepted') delivery = 'accepted';
    } catch (error) {
      this.logger.warn('computed:outbox:anomaly_publish_deferred', {
        taskId: input.taskId,
        kind: input.kind,
        targetId: input.targetId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    this.logger.log('computed:outbox:anomaly_recovered', {
      taskId: input.taskId,
      kind: input.kind,
      targetId: input.targetId,
      delivery,
    });
    return { taskId: input.taskId, kind: input.kind, recovered: true, delivery };
  }
}
