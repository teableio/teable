import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  createComputedOutboxWakeup,
  defaultComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';

import {
  groupComputedOutboxAnomalies,
  type ComputedOutboxAnomalyGroup as DomainComputedOutboxAnomalyGroup,
} from '@teable/v2-core';

import type {
  IComputedOutboxMaintenanceAnomaly,
  IComputedOutboxMaintenanceTarget,
} from '../../../global/data-db-client-manager.service';
import {
  DataDbBindingNotReadyError,
  DataDbClientManager,
} from '../../../global/data-db-client-manager.service';
import { mapWithConcurrency } from '../../../utils/map-with-concurrency';
import { DataDbHealthService, type DataDbHealthState } from '../../space/data-db-health.service';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import { COMPUTED_OUTBOX_ANOMALY_FETCH_CAP, COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './constants';

export type ComputedOutboxAnomaly = IComputedOutboxMaintenanceAnomaly & {
  targetId: string;
  storage: IComputedOutboxMaintenanceTarget['storage'];
};

export type ComputedOutboxAnomalyGroup = DomainComputedOutboxAnomalyGroup & {
  /** Health of the BYODB connection backing this target; absent for default storage / healthy-untracked. */
  targetHealth?: DataDbHealthState;
};

export { buildComputedOutboxAnomalyGroupKey, groupComputedOutboxAnomalies } from '@teable/v2-core';

const GROUP_RECOVERY_PUBLISH_CONCURRENCY = 8;

@Injectable()
export class ComputedOutboxAnomalyService {
  private readonly logger = new Logger(ComputedOutboxAnomalyService.name);

  constructor(
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly spaceDataDbMigrationGuard: SpaceDataDbMigrationGuardService,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher,
    @Optional() private readonly dataDbHealthService?: DataDbHealthService
  ) {}

  async list(
    groupLimit: number,
    options?: { filter?: (group: DomainComputedOutboxAnomalyGroup) => boolean }
  ): Promise<{
    sampledAt: string;
    total: number;
    groupTotal: number;
    matchedGroupTotal: number;
    groups: ComputedOutboxAnomalyGroup[];
    unavailableTargetCount: number;
  }> {
    const [targets, byodbBoundBaseIds] = await Promise.all([
      this.dataDbClientManager.listComputedOutboxMaintenanceTargets(),
      this.dataDbClientManager.listByodbBoundBaseIds(),
    ]);
    // A filtered listing must be able to reach matches anywhere in the retained
    // window, not just among the most recent items, so it fetches at the cap.
    const fetchLimit = options?.filter
      ? COMPUTED_OUTBOX_ANOMALY_FETCH_CAP
      : Math.min(COMPUTED_OUTBOX_ANOMALY_FETCH_CAP, Math.max(groupLimit * 40, 200));
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

    // The ledger queries already exclude orphans (entries whose base routes to a
    // different storage target); re-check here against the same target inventory
    // as a drift guard, so a stale ledger row can never surface a recover action
    // that the routing guard would reject. Also treat BYODB-bound bases whose
    // connection is disabled/unready as routed away from default storage — they
    // are missing from the queryable inventory but must not be recovered there.
    const byodbRoutedBaseIds = new Set([
      ...targets
        .filter((target) => target.storage === 'byodb')
        .flatMap((target) => (target.baseSpaceMapping ?? []).map((mapping) => mapping.baseId)),
      ...byodbBoundBaseIds,
    ]);

    const routableBaseIdsByTarget = new Map(
      targets.map((target) => [
        target.cacheKey,
        target.storage === 'byodb'
          ? new Set((target.baseSpaceMapping ?? []).map((mapping) => mapping.baseId))
          : null,
      ])
    );
    const isRoutedToItsTarget = (item: ComputedOutboxAnomaly): boolean => {
      const routableBaseIds = routableBaseIdsByTarget.get(item.targetId);
      return routableBaseIds
        ? routableBaseIds.has(item.baseId)
        : !byodbRoutedBaseIds.has(item.baseId);
    };

    const fetchedItems = results
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
    const items = fetchedItems.filter(isRoutedToItsTarget);
    const orphanedCount = fetchedItems.length - items.length;
    if (orphanedCount > 0) {
      this.logger.warn('computed:outbox:anomaly_orphans_hidden', { orphanedCount });
    }

    const { groups, groupTotal, matchedGroupTotal } = groupComputedOutboxAnomalies(items, {
      groupLimit,
      filter: options?.filter,
    });
    const listedGroups = groups as ComputedOutboxAnomalyGroup[];
    await this.attachTargetHealth(listedGroups);

    return {
      sampledAt: new Date().toISOString(),
      total: Math.max(
        0,
        results.reduce((sum, result) => sum + (result.snapshot?.total ?? 0), 0) - orphanedCount
      ),
      groupTotal,
      matchedGroupTotal,
      groups: listedGroups,
      unavailableTargetCount: results.filter((result) => !result.snapshot).length,
    };
  }

  /**
   * Attribute anomaly groups on a BYODB target to that connection's health, so
   * the admin page can say "this whole group is the read-only database" instead
   * of presenting each signature as an independent mystery. For byodb targets
   * the cacheKey IS the connection id; lookups ride the health service's cache.
   */
  private async attachTargetHealth(groups: ComputedOutboxAnomalyGroup[]): Promise<void> {
    if (!this.dataDbHealthService) return;
    const byodbTargetIds = [
      ...new Set(
        groups.filter((group) => group.storage === 'byodb').map((group) => group.targetId)
      ),
    ];
    if (!byodbTargetIds.length) return;
    const healthByTarget = new Map<string, DataDbHealthState>();
    await Promise.all(
      byodbTargetIds.map(async (targetId) => {
        const state = await this.dataDbHealthService!.getHealthStateForConnection(targetId);
        if (state !== 'untracked') healthByTarget.set(targetId, state);
      })
    );
    for (const group of groups) {
      const health = healthByTarget.get(group.targetId);
      if (health) group.targetHealth = health;
    }
  }

  /**
   * Resolve where durable tasks currently stand across every storage target's
   * ledger. Tasks absent from the result have left the ledger entirely
   * (settled — typically a later retry succeeded).
   */
  async resolveLedgerStates(
    taskIds: ReadonlyArray<string>
  ): Promise<Map<string, 'pending' | 'processing' | 'dead'>> {
    const uniqueTaskIds = [...new Set(taskIds)];
    if (!uniqueTaskIds.length) return new Map();

    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const perTarget = await mapWithConcurrency(targets, 4, async (target) => {
      try {
        return await this.dataDbClientManager.lookupComputedOutboxMaintenanceTaskStates(
          target,
          uniqueTaskIds
        );
      } catch (error) {
        this.logger.warn('computed:outbox:ledger_state_target_failed', {
          targetId: target.cacheKey,
          storage: target.storage,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return new Map<string, 'pending' | 'processing' | 'dead'>();
      }
    });

    const merged = new Map<string, 'pending' | 'processing' | 'dead'>();
    for (const states of perTarget) {
      for (const [taskId, state] of states) {
        const existing = merged.get(taskId);
        if (existing === 'dead') continue;
        if (existing === 'processing' && state === 'pending') continue;
        merged.set(taskId, state);
      }
    }
    return merged;
  }

  private async resolveCurrentStorageTarget(baseId: string) {
    try {
      return await this.dataDbClientManager.getDataDatabaseForBase(baseId);
    } catch (error) {
      if (error instanceof DataDbBindingNotReadyError) {
        throw new ConflictException('Computed outbox Base data database is not ready');
      }
      throw error;
    }
  }

  async assertWritableTarget(baseId: string, targetId: string): Promise<void> {
    await this.spaceDataDbMigrationGuard.assertBaseWritable(baseId);
    const current = await this.resolveCurrentStorageTarget(baseId);
    if (current.cacheKey !== targetId)
      throw new ConflictException('Computed outbox Base no longer routes to this storage target');
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

    // Same routing guard as the batch path: replaying an anomaly on a storage
    // the base no longer routes to would compute against stale data.
    const baseId = await this.dataDbClientManager.peekComputedOutboxMaintenanceAnomalyBase(
      target,
      input.taskId,
      input.kind
    );
    if (!baseId) throw new NotFoundException('Computed outbox anomaly no longer exists');
    await this.spaceDataDbMigrationGuard.assertBaseWritable(baseId);
    const currentTarget = await this.resolveCurrentStorageTarget(baseId);
    if (currentTarget.cacheKey !== target.cacheKey) {
      throw new ConflictException('Computed outbox Base no longer routes to this storage target');
    }

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

  async recoverDeadLetterBatch(input: {
    targetId: string;
    baseId: string;
    seedTableId: string;
    errorSignature: string;
  }): Promise<{
    targetId: string;
    recovered: number;
    inserted: number;
    alreadyPending: number;
    deliveryAccepted: number;
    deliveryDeferred: number;
  }> {
    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const target = targets.find((candidate) => candidate.cacheKey === input.targetId);
    if (!target) throw new NotFoundException('Computed outbox storage target not found');

    await this.spaceDataDbMigrationGuard.assertBaseWritable(input.baseId);
    const currentTarget = await this.resolveCurrentStorageTarget(input.baseId);
    if (currentTarget.cacheKey !== target.cacheKey) {
      throw new ConflictException('Computed outbox Base no longer routes to this storage target');
    }

    const recovery = await this.dataDbClientManager.recoverComputedOutboxMaintenanceDeadLetterBatch(
      target,
      {
        baseId: input.baseId,
        seedTableId: input.seedTableId,
        errorSignature: input.errorSignature,
      }
    );
    const deliveries = await mapWithConcurrency(
      recovery.tasks,
      GROUP_RECOVERY_PUBLISH_CONCURRENCY,
      async (task) => {
        try {
          const outcome = await this.wakeupPublisher.runAsConsumer(() =>
            this.wakeupPublisher.publish(
              createComputedOutboxWakeup({
                taskId: task.taskId,
                baseId: task.baseId,
                availableAt: new Date(),
                cause: 'replay',
              })
            )
          );
          return outcome.status === 'accepted' ? 'accepted' : 'deferred';
        } catch (error) {
          this.logger.warn('computed:outbox:anomaly_batch_publish_deferred', {
            taskId: task.taskId,
            targetId: input.targetId,
            errorType: error instanceof Error ? error.name : 'UnknownError',
          });
          return 'deferred';
        }
      }
    );
    const deliveryAccepted = deliveries.filter((delivery) => delivery === 'accepted').length;
    const deliveryDeferred = deliveries.length - deliveryAccepted;

    this.logger.log('computed:outbox:anomaly_batch_recovered', {
      targetId: input.targetId,
      baseId: input.baseId,
      seedTableId: input.seedTableId,
      recovered: recovery.tasks.length,
      inserted: recovery.inserted,
      alreadyPending: recovery.alreadyPending,
      deliveryAccepted,
      deliveryDeferred,
    });
    return {
      targetId: input.targetId,
      recovered: recovery.tasks.length,
      inserted: recovery.inserted,
      alreadyPending: recovery.alreadyPending,
      deliveryAccepted,
      deliveryDeferred,
    };
  }

  /**
   * Permanently drop one root-cause group of dead letters without replaying it.
   * Unlike recovery there is deliberately no base-writable or routing guard:
   * the primary use case is a group whose base was permanently deleted, so the
   * base may not resolve to any storage target anymore.
   */
  async discardDeadLetterBatch(input: {
    targetId: string;
    baseId: string;
    seedTableId: string;
    errorSignature: string;
  }): Promise<{ targetId: string; discarded: number }> {
    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const target = targets.find((candidate) => candidate.cacheKey === input.targetId);
    if (!target) throw new NotFoundException('Computed outbox storage target not found');

    const { discarded } =
      await this.dataDbClientManager.discardComputedOutboxMaintenanceDeadLetterBatch(target, {
        baseId: input.baseId,
        seedTableId: input.seedTableId,
        errorSignature: input.errorSignature,
      });

    this.logger.log('computed:outbox:anomaly_batch_discarded', {
      targetId: input.targetId,
      baseId: input.baseId,
      seedTableId: input.seedTableId,
      discarded,
    });
    return { targetId: input.targetId, discarded };
  }
}
