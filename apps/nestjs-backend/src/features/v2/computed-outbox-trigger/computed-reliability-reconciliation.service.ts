import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import {
  isComputedReliabilityConfigured,
  isComputedReliabilityEnabled,
  isComputedReliabilityReconciliationEnabled,
} from '@teable/v2-adapter-table-repository-postgres';
import { type IComputedActivityReader, v2CoreTokens } from '@teable/v2-core';
import createKnex, { type Knex } from 'knex';
import { CacheService } from '../../../cache/cache.service';
import {
  applyComputedReliabilityBaseFilter,
  computedReliabilityConfig,
  isComputedReliabilityReady,
  reliabilityCandidateQuery,
  reliabilityTable,
} from '../../../global/computed-reliability-maintenance';
import {
  type IComputedOutboxMaintenanceTarget,
  DataDbClientManager,
} from '../../../global/data-db-client-manager.service';
import { V2ContainerService } from '../v2-container.service';
import { reliabilityReconciliation, setReliabilitySnapshot } from './computed-reliability.metrics';

@Injectable()
export class ComputedReliabilityReconciliationService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ComputedReliabilityReconciliationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private targetCursor = 0;
  private readonly cursors = new Map<string, string>();
  constructor(
    private readonly manager: DataDbClientManager,
    private readonly containers: V2ContainerService,
    private readonly cache: CacheService
  ) {}
  onApplicationBootstrap() {
    // Retention remains active when optional projection reconciliation is disabled.
    if (!isComputedReliabilityConfigured(computedReliabilityConfig())) return;
    this.timer = setInterval(() => void this.runOnce(), 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async runOnce() {
    if (this.running || !isComputedReliabilityConfigured(computedReliabilityConfig())) return;
    this.running = true;
    const deadline = Date.now() + 20_000;
    try {
      const targets = await this.manager.listComputedOutboxMaintenanceTargets();
      const routedAway = await this.manager.listByodbBoundBaseIds();
      for (let visited = 0; visited < Math.min(targets.length, 10); visited++) {
        if (Date.now() >= deadline) break;
        const target = targets[this.targetCursor % targets.length];
        this.targetCursor = (this.targetCursor + 1) % targets.length;
        await this.maintainTarget(target, routedAway, Math.min(deadline, Date.now() + 5000));
      }
      const current = await this.cache.getMany(targets.map((target) => this.snapshotKey(target)));
      const complete =
        current.length === targets.length &&
        current.every((snapshot) => snapshot && Date.now() - snapshot.sampledAt < 330_000);
      setReliabilitySnapshot(
        complete ? current.reduce((sum, snapshot) => sum + snapshot!.count, 0) : undefined,
        complete
          ? current.reduce(
              (age, snapshot) =>
                Math.max(age, snapshot!.oldestAt === null ? 0 : Date.now() - snapshot!.oldestAt),
              0
            )
          : undefined
      );
    } catch (error) {
      setReliabilitySnapshot();
      this.unavailable(error);
    } finally {
      this.running = false;
    }
  }
  private async maintainTarget(
    target: IComputedOutboxMaintenanceTarget,
    routedAway: string[],
    deadline = Date.now() + 5000
  ) {
    // Keep the pacing key until TTL expiry: releasing it would allow staggered pods to repeat work.
    // With an in-memory cache this only paces one process; the database lock still prevents overlap.
    let shouldMaintain: boolean;
    let shouldSample = false;
    try {
      shouldMaintain = await this.cache.setnx(
        `lock:computed-reliability:pace:${target.cacheKey}`,
        '1',
        60
      );
      // A pod skipping maintenance can sample immediately, without opening a connection when
      // another sampler owns the lease. Maintenance owners acquire this lease only after work.
      if (!shouldMaintain) {
        shouldSample = await this.claimSample(target, deadline);
        if (!shouldSample) return;
      }
    } catch (error) {
      this.unavailable(error, target.cacheKey);
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const db = createKnex({
      client: 'pg',
      connection: {
        connectionString: target.connectionUrl ?? target.url,
        connectionTimeoutMillis: remaining,
      },
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: remaining,
    });
    try {
      const maintained =
        shouldMaintain &&
        (await db.transaction(async (trx) => {
          if (
            !(await this.query(trx, deadline, () =>
              isComputedReliabilityReady(trx, target.internalSchema)
            ))
          ) {
            reliabilityReconciliation.add(1, { outcome: 'not_migrated' });
            return false;
          }
          const lock = await this.query(trx, deadline, () =>
            trx.raw<{ rows: Array<{ acquired: boolean }> }>(
              'select pg_try_advisory_xact_lock(hashtext(?)) as acquired',
              [`computed-reliability-maintenance:${target.internalSchema ?? 'public'}`]
            )
          );
          if (!lock.rows[0]?.acquired) return false;
          await this.cleanup(trx, target, routedAway, deadline);
          if (Date.now() < deadline) {
            await this.closeUncomputable(trx, target, deadline);
          }
          if (
            isComputedReliabilityReconciliationEnabled(computedReliabilityConfig()) &&
            Date.now() < deadline
          ) {
            await this.reconcileTables(trx, target, routedAway, deadline);
          }
          return true;
        }));
      if (maintained) reliabilityReconciliation.add(1, { outcome: 'ready' });
      // Metrics are lower priority and use a separate transaction: a count timeout must never
      // roll back retention or prevent reconciliation. Never present partial counts as exact totals.
      if (
        Date.now() < deadline &&
        (shouldSample ||
          (await this.cache.setnx(
            `lock:computed-reliability:metrics:${this.snapshotKey(target)}`,
            '1',
            300
          )))
      ) {
        const sampleDeadline = Math.min(deadline, Date.now() + 1000);
        const snapshot = await db.transaction(async (trx) => {
          if (
            !(await this.query(trx, sampleDeadline, () =>
              isComputedReliabilityReady(trx, target.internalSchema)
            ))
          )
            return;
          return this.query(trx, sampleDeadline, () => this.snapshot(trx, target, routedAway));
        });
        if (snapshot)
          await this.cache.setDetail(
            this.snapshotKey(target),
            {
              count: snapshot.count,
              oldestAt: snapshot.oldestAt,
              sampledAt: Date.now(),
            },
            330
          );
      }
    } catch (error) {
      this.unavailable(error, target.cacheKey);
    } finally {
      await db.destroy();
    }
  }
  private async claimSample(target: IComputedOutboxMaintenanceTarget, deadline: number) {
    if (Date.now() >= deadline) return false;
    return this.cache.setnx(
      `lock:computed-reliability:metrics:${this.snapshotKey(target)}`,
      '1',
      300
    );
  }
  private snapshotKey(
    target: IComputedOutboxMaintenanceTarget
  ): `computed-reliability:snapshot:${string}` {
    const bases = [...(computedReliabilityConfig().baseIds ?? [])]
      .sort((a, b) => Number(a > b) - Number(a < b))
      .join(',');
    return `computed-reliability:snapshot:${target.cacheKey}:${bases}`;
  }
  private async query<T>(
    trx: Knex.Transaction,
    deadline: number,
    operation: () => PromiseLike<T>
  ): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Computed reliability maintenance budget exhausted');
    await trx.raw("select set_config('statement_timeout', ?, true)", [String(remaining)]);
    if (Date.now() >= deadline)
      throw new Error('Computed reliability maintenance budget exhausted');
    return await operation();
  }
  private unavailable(error: unknown, targetId?: string) {
    reliabilityReconciliation.add(1, { outcome: 'unavailable' });
    this.logger.warn('computed:reliability:maintenance_unavailable', {
      targetId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  private async snapshot(db: Knex, target: IComputedOutboxMaintenanceTarget, routedAway: string[]) {
    const query = reliabilityTable(db, target.internalSchema, 'computed_reliability_issue').where(
      'status',
      'open'
    );
    applyComputedReliabilityBaseFilter(query, target, routedAway);
    const row = await query.count('* as count').min('first_seen_at as oldest').first();
    return {
      count: Number(row?.count ?? 0),
      oldestAt: row?.oldest ? new Date(String(row.oldest)).getTime() : null,
    };
  }
  private qualifyReliabilityTable(target: IComputedOutboxMaintenanceTarget, name: string): string {
    const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
    return target.internalSchema ? `${quote(target.internalSchema)}.${quote(name)}` : quote(name);
  }
  private async closeUncomputable(
    trx: Knex.Transaction,
    target: IComputedOutboxMaintenanceTarget,
    deadline: number
  ) {
    const field = await this.query(trx, deadline, () =>
      trx.raw<{ rows: Array<{ rel: string | null }> }>(`select to_regclass('public.field') as rel`)
    );
    if (!field?.rows?.[0]?.rel) return;
    const issue = this.qualifyReliabilityTable(target, 'computed_reliability_issue');
    const scope = this.qualifyReliabilityTable(target, 'computed_reliability_scope');
    await this.query(trx, deadline, () =>
      trx.raw(
        `update ${issue} i
         set status = 'not_applicable',
             closed_at = now(),
             confirmed_by = 'system:uncomputable-field',
             confirmation_reason = 'Every scoped field is deleted or in error and can no longer be computed'
         where i.status not in ('resolved', 'not_applicable')
           and i.scope_complete = true
           and exists (select 1 from ${scope} s where s.issue_id = i.id)
           and not exists (
             select 1
             from ${scope} s
             join public.field f on f.id = s.field_id
             where s.issue_id = i.id
               and f.deleted_time is null
               and f.has_error is not true
           )`
      )
    );
  }
  private async cleanup(
    trx: Knex.Transaction,
    target: IComputedOutboxMaintenanceTarget,
    routedAway: string[],
    deadline = Date.now() + 5000
  ) {
    const query = reliabilityTable(trx, target.internalSchema, 'computed_reliability_issue')
      .whereIn('status', ['resolved', 'not_applicable'])
      .where('closed_at', '<', new Date(Date.now() - 30 * 86400000));
    applyComputedReliabilityBaseFilter(query, target, routedAway);
    const expired = await this.query(trx, deadline, () =>
      query.orderBy('closed_at').limit(100).forUpdate().skipLocked().select('id')
    );
    const ids = expired.map((issue) => String(issue.id));
    if (!ids.length) return;
    await this.query(trx, deadline, () =>
      reliabilityTable(trx, target.internalSchema, 'computed_reliability_scope')
        .whereIn('issue_id', ids)
        .delete()
    );
    await this.query(trx, deadline, () =>
      reliabilityTable(trx, target.internalSchema, 'computed_reliability_issue')
        .whereIn('id', ids)
        .delete()
    );
  }
  private async reconcileTables(
    trx: Knex.Transaction,
    target: IComputedOutboxMaintenanceTarget,
    routedAway: string[],
    deadline: number
  ) {
    const query = reliabilityCandidateQuery(trx, target.internalSchema);
    applyComputedReliabilityBaseFilter(query, target, routedAway);
    const candidates = await this.query(trx, deadline, () =>
      query
        .where('table_id', '>', this.cursors.get(target.cacheKey) ?? '')
        .orderBy('table_id')
        .limit(100)
    );
    if (!candidates.length) {
      this.cursors.delete(target.cacheKey);
      return;
    }
    for (const candidate of candidates) {
      if (Date.now() >= deadline) break;
      this.cursors.set(target.cacheKey, String(candidate.table_id));
      await this.reconcileCandidate(
        target,
        String(candidate.base_id),
        String(candidate.table_id),
        new Set(routedAway),
        deadline - Date.now()
      );
    }
  }
  private async reconcileCandidate(
    target: IComputedOutboxMaintenanceTarget,
    baseId: string,
    tableId: string,
    routedAway: Set<string>,
    budgetMs = 5000
  ): Promise<number> {
    const deadline = Date.now() + budgetMs;
    const routedHere =
      target.storage === 'byodb'
        ? target.baseSpaceMapping?.some((mapping) => mapping.baseId === baseId)
        : !routedAway.has(baseId);
    if (!routedHere || !isComputedReliabilityEnabled(baseId, computedReliabilityConfig())) return 0;
    try {
      const container = await this.containers.getContainerForTable(tableId);
      const remaining = deadline - Date.now();
      if (remaining <= 0) return 0;
      const result = await container
        .resolve<IComputedActivityReader>(v2CoreTokens.computedActivityReader)
        .getByTableId(undefined, tableId, baseId, { budgetMs: remaining, heal: true });
      reliabilityReconciliation.add(1, { outcome: result.isOk() ? 'checked' : 'failed' });
      if (result.isOk() && result.value.reconciliationPerformed === true)
        reliabilityReconciliation.add(1, { outcome: 'corrected' });
      return result.isOk() ? 1 : 0;
    } catch (error) {
      this.unavailable(error, target.cacheKey);
      return 0;
    }
  }
}
