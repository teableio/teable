import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { getMetaDatabaseUrl } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import createKnex from 'knex';
import { decryptDataDbUrl } from './data-db-url-secret';

export type DataDbHealthState = 'healthy' | 'read_only' | 'unreachable' | 'degraded';

export type DataDbHealthProbeResult = {
  state: DataDbHealthState;
  reason: string | null;
};

export type DataDbHealthSnapshot = {
  state: DataDbHealthState | 'untracked';
  changedAt: Date | null;
};

type HealthTrackedConnection = {
  id: string;
  healthState: string;
  consecutiveHealthFailures: number;
  healthChangedAt: Date | null;
};

/**
 * A customer database can reject writes while still accepting reads (e.g. a
 * Supabase project forced read-only by its disk quota, or a replica endpoint),
 * so a read-based validation keeps reporting "ready" through a write outage.
 * The health lane is deliberately separate from the binding lifecycle
 * (`status`/`state`): lifecycle answers "is this connection configured and
 * migrated", health answers "can it make progress right now".
 */
const READ_ONLY_MESSAGE_PATTERN =
  /in a read-only transaction|READ_ONLY_DATABASE|connection is read-only/i;

const CONNECTION_FAILURE_PATTERNS: ReadonlyArray<RegExp> = [
  /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|EAI_AGAIN/i,
  /timeout acquiring a connection|connection terminated|connection refused/i,
  /password authentication failed|no pg_hba\.conf entry/i,
  /the database system is (starting up|shutting down|in recovery mode)/i,
];

const HEALTH_SWEEP_LOCK_KEY = 'teable:data-db-health-sweep:v1';
const HEALTH_PROBE_CONNECT_TIMEOUT_MS = 5_000;
const HEALTH_PROBE_QUERY_TIMEOUT_MS = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60_000;
/** Runtime failures arrive per task; one ledger write per connection per window is enough. */
const PASSIVE_REPORT_THROTTLE_MS = 60_000;
/** Non-deterministic failures only degrade the connection after this many in a row. */
const DEGRADED_AFTER_CONSECUTIVE_FAILURES = 3;
/**
 * Hot paths (write fail-fast, computed wakeup breaker) consult health per
 * request; this TTL bounds their meta-DB cost. A state change invalidates the
 * whole cache, so recovery propagates immediately instead of after the TTL.
 */
const HOT_PATH_HEALTH_CACHE_TTL_MS = 30_000;
const HOT_PATH_HEALTH_CACHE_MAX_ENTRIES = 10_000;

const sweepIntervalMs = (): number => {
  const parsed = Number(process.env.TEABLE_DATA_DB_HEALTH_SWEEP_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SWEEP_INTERVAL_MS;
};

const isSweepDisabled = (): boolean => process.env.TEABLE_DATA_DB_HEALTH_SWEEP_DISABLED === 'true';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class DataDbHealthService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DataDbHealthService.name);
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private sweeping = false;
  private readonly passiveReportAt = new Map<string, number>();
  private readonly hotPathHealthCache = new Map<
    string,
    { state: DataDbHealthState | 'untracked'; changedAt: Date | null; expiresAt: number }
  >();
  private readonly recoveredListeners = new Set<() => void>();

  constructor(@Optional() private readonly prismaService?: PrismaService) {}

  onApplicationBootstrap() {
    if (!this.prismaService || isSweepDisabled()) return;
    this.sweepTimer = setInterval(() => {
      void this.sweepOnce().catch((error) => {
        this.logger.warn('data_db:health_sweep_failed', { error: describeError(error) });
      });
    }, sweepIntervalMs());
    this.sweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.recoveredListeners.clear();
  }

  /**
   * Passive signal from a write path that failed against a base's data
   * database (computed outbox, API writes). Fire-and-forget: callers must not
   * fail their own path on a health bookkeeping error.
   */
  async reportWriteFailure(input: { baseId: string; message: string }): Promise<void> {
    if (!this.prismaService) return;
    try {
      const connection = await this.resolveConnectionForBase(input.baseId);
      if (!connection) return;
      const now = Date.now();
      const lastReportAt = this.passiveReportAt.get(connection.id) ?? 0;
      if (now - lastReportAt < PASSIVE_REPORT_THROTTLE_MS) return;
      this.passiveReportAt.set(connection.id, now);
      await this.recordFailure(connection, input.message);
    } catch (error) {
      this.logger.warn('data_db:health_report_failed', {
        baseId: input.baseId,
        error: describeError(error),
      });
    }
  }

  /**
   * Failure observed while operating directly on a known connection
   * (schema migration, retest). Not throttled: these paths already run rarely.
   */
  async reportConnectionFailure(input: { connectionId: string; message: string }): Promise<void> {
    if (!this.prismaService) return;
    try {
      const connection = await this.findConnection(input.connectionId);
      if (!connection) return;
      await this.recordFailure(connection, input.message);
    } catch (error) {
      this.logger.warn('data_db:health_report_failed', {
        connectionId: input.connectionId,
        error: describeError(error),
      });
    }
  }

  /** A successful write-bearing operation proves the connection healthy again. */
  async reportConnectionRecovered(connectionId: string): Promise<void> {
    if (!this.prismaService) return;
    try {
      const connection = await this.findConnection(connectionId);
      if (!connection) return;
      await this.transition(connection, { state: 'healthy', reason: null });
    } catch (error) {
      this.logger.warn('data_db:health_report_failed', {
        connectionId,
        error: describeError(error),
      });
    }
  }

  /**
   * Cheap health lookup for hot paths. Returns 'untracked' for default-storage
   * bases and on any lookup failure — health must never take a write path down
   * on its own. Cached with a short TTL; transitions flush the cache.
   */
  async getHealthStateForBase(baseId: string): Promise<DataDbHealthState | 'untracked'> {
    return (await this.getHealthSnapshotForBase(baseId)).state;
  }

  /**
   * Hot-path snapshot including `healthChangedAt` so computed wake-ups can
   * share one stepped backoff per base instead of a fixed 5-minute loop.
   */
  async getHealthSnapshotForBase(baseId: string): Promise<DataDbHealthSnapshot> {
    return await this.getCachedHealthSnapshot(`base:${baseId}`, () =>
      this.resolveConnectionForBase(baseId)
    );
  }

  /** Space-level variant of {@link getHealthStateForBase} for space-scoped writes. */
  async getHealthStateForSpace(spaceId: string): Promise<DataDbHealthState | 'untracked'> {
    return (
      await this.getCachedHealthSnapshot(`space:${spaceId}`, () =>
        this.resolveConnectionForSpace(spaceId)
      )
    ).state;
  }

  /** Connection-level variant for admin views that already know the connection id. */
  async getHealthStateForConnection(
    connectionId: string
  ): Promise<DataDbHealthState | 'untracked'> {
    return (
      await this.getCachedHealthSnapshot(`conn:${connectionId}`, () =>
        this.findConnection(connectionId)
      )
    ).state;
  }

  /**
   * Notified after a persisted transition *to* healthy. Computed outbox redrive
   * uses this to re-arm parked tasks as soon as a customer database is writable
   * again (Supabase quota top-up, replica promotion), rather than waiting for
   * the next 5-minute reconcile.
   */
  onRecovered(listener: () => void): () => void {
    this.recoveredListeners.add(listener);
    return () => {
      this.recoveredListeners.delete(listener);
    };
  }

  /**
   * Live writability probe for one base. Used by the unhealthy-BYODB sentinel
   * so a quota top-up is visible before the fleet sweep. Returns 'untracked'
   * when the base has no BYODB binding or the probe cannot run.
   */
  async probeAndRefreshForBase(baseId: string): Promise<DataDbHealthState | 'untracked'> {
    if (!this.prismaService) return 'untracked';
    try {
      const base = await this.prismaService.base.findUnique({
        where: { id: baseId },
        select: { spaceId: true },
      });
      if (!base) return 'untracked';
      const binding = await this.prismaService.spaceDataDbBinding.findUnique({
        where: { spaceId: base.spaceId },
        select: {
          mode: true,
          dataDbConnection: {
            select: {
              id: true,
              healthState: true,
              consecutiveHealthFailures: true,
              healthChangedAt: true,
              encryptedUrl: true,
            },
          },
        },
      });
      if (binding?.mode !== 'byodb' || !binding.dataDbConnection) return 'untracked';
      const connection = binding.dataDbConnection;
      const result = await this.probeConnection(connection);
      await this.transition(connection, result);
      return result.state;
    } catch (error) {
      this.logger.warn('data_db:health_probe_for_base_failed', {
        baseId,
        error: describeError(error),
      });
      return 'untracked';
    }
  }

  /**
   * Active probe: reachability plus write-ability signals that a plain read
   * validation cannot see. Uses a throwaway single-connection pool like the
   * outbox maintenance queries — customer databases must not accumulate idle
   * Teable connections.
   */
  async probeConnection(connection: {
    id: string;
    encryptedUrl: string;
  }): Promise<DataDbHealthProbeResult> {
    let url: string;
    try {
      url = decryptDataDbUrl(connection.encryptedUrl);
    } catch (error) {
      return { state: 'degraded', reason: `connection secret unreadable: ${describeError(error)}` };
    }
    const client = createKnex({
      client: 'pg',
      connection: {
        connectionString: url,
        connectionTimeoutMillis: HEALTH_PROBE_CONNECT_TIMEOUT_MS,
      },
      acquireConnectionTimeout: HEALTH_PROBE_CONNECT_TIMEOUT_MS,
      pool: { min: 0, max: 1 },
    });
    try {
      const result = await client
        .raw<{
          rows: Array<{ readOnly: string; inRecovery: boolean }>;
        }>(
          `select current_setting('transaction_read_only') as "readOnly", pg_is_in_recovery() as "inRecovery"`
        )
        .timeout(HEALTH_PROBE_QUERY_TIMEOUT_MS, { cancel: true });
      const row = result.rows?.[0];
      if (row?.inRecovery) {
        return { state: 'read_only', reason: 'endpoint is a standby/replica (pg_is_in_recovery)' };
      }
      if (row?.readOnly === 'on') {
        return {
          state: 'read_only',
          reason:
            'transaction_read_only is on (commonly provider quota enforcement, e.g. Supabase disk limit)',
        };
      }
      return { state: 'healthy', reason: null };
    } catch (error) {
      const message = describeError(error);
      if (READ_ONLY_MESSAGE_PATTERN.test(message)) {
        return { state: 'read_only', reason: message };
      }
      return { state: 'unreachable', reason: message };
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  /**
   * Probe every BYODB connection and persist transitions. Fleet-deduplicated
   * with a meta-DB advisory lock (same pattern as the outbox redrive sweeper);
   * losing the lease is normal and means another instance is sweeping.
   */
  async sweepOnce(): Promise<{ probed: number; skipped?: 'lease_busy' | 'already_running' }> {
    if (!this.prismaService || this.sweeping) return { probed: 0, skipped: 'already_running' };
    this.sweeping = true;
    try {
      let probed = 0;
      const acquired = await this.withSweepLease(async () => {
        const connections = await this.prismaService!.dataDbConnection.findMany({
          where: {
            status: { not: 'disabled' },
            spaceBindings: { some: { mode: 'byodb' } },
          },
          select: {
            id: true,
            encryptedUrl: true,
            healthState: true,
            consecutiveHealthFailures: true,
            healthChangedAt: true,
          },
        });
        for (const connection of connections) {
          const result = await this.probeConnection(connection);
          await this.transition(connection, result);
          probed += 1;
        }
      });
      if (!acquired) return { probed: 0, skipped: 'lease_busy' };
      return { probed };
    } finally {
      this.sweeping = false;
    }
  }

  private async recordFailure(connection: HealthTrackedConnection, message: string): Promise<void> {
    if (READ_ONLY_MESSAGE_PATTERN.test(message)) {
      await this.transition(connection, { state: 'read_only', reason: message });
      return;
    }
    if (CONNECTION_FAILURE_PATTERNS.some((pattern) => pattern.test(message))) {
      await this.transition(connection, { state: 'unreachable', reason: message });
      return;
    }
    const failures = connection.consecutiveHealthFailures + 1;
    if (failures >= DEGRADED_AFTER_CONSECUTIVE_FAILURES) {
      await this.transition(connection, { state: 'degraded', reason: message, failures });
      return;
    }
    await this.prismaService!.dataDbConnection.update({
      where: { id: connection.id },
      data: { consecutiveHealthFailures: failures, lastHealthCheckAt: new Date() },
    });
  }

  private async transition(
    connection: HealthTrackedConnection,
    next: { state: DataDbHealthState; reason: string | null; failures?: number }
  ): Promise<void> {
    const now = new Date();
    const failures =
      next.state === 'healthy' ? 0 : next.failures ?? connection.consecutiveHealthFailures + 1;
    if (connection.healthState === next.state) {
      await this.prismaService!.dataDbConnection.update({
        where: { id: connection.id },
        data: {
          lastHealthCheckAt: now,
          healthReason: next.state === 'healthy' ? null : next.reason ?? undefined,
          consecutiveHealthFailures: failures,
        },
      });
      return;
    }
    await this.prismaService!.dataDbConnection.update({
      where: { id: connection.id },
      data: {
        healthState: next.state,
        healthReason: next.reason,
        healthChangedAt: now,
        lastHealthCheckAt: now,
        consecutiveHealthFailures: failures,
      },
    });
    // Hot-path consumers must see a transition (esp. recovery) before the TTL.
    this.hotPathHealthCache.clear();
    // State *transitions* are the log-worthy signal; steady-state stays quiet.
    const payload = {
      connectionId: connection.id,
      from: connection.healthState,
      to: next.state,
      reason: next.reason,
    };
    if (next.state === 'healthy') {
      this.logger.log('data_db:health_state_changed', payload);
      this.notifyRecovered();
    } else {
      this.logger.warn('data_db:health_state_changed', payload);
    }
  }

  private notifyRecovered(): void {
    for (const listener of this.recoveredListeners) {
      try {
        listener();
      } catch (error) {
        this.logger.warn('data_db:health_recovered_listener_failed', {
          error: describeError(error),
        });
      }
    }
  }

  private async findConnection(connectionId: string): Promise<HealthTrackedConnection | null> {
    return await this.prismaService!.dataDbConnection.findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        healthState: true,
        consecutiveHealthFailures: true,
        healthChangedAt: true,
      },
    });
  }

  private async resolveConnectionForBase(baseId: string): Promise<HealthTrackedConnection | null> {
    const base = await this.prismaService!.base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) return null;
    return await this.resolveConnectionForSpace(base.spaceId);
  }

  private async resolveConnectionForSpace(
    spaceId: string
  ): Promise<HealthTrackedConnection | null> {
    const binding = await this.prismaService!.spaceDataDbBinding.findUnique({
      where: { spaceId },
      select: {
        mode: true,
        dataDbConnection: {
          select: {
            id: true,
            healthState: true,
            consecutiveHealthFailures: true,
            healthChangedAt: true,
          },
        },
      },
    });
    if (binding?.mode !== 'byodb') return null;
    return binding.dataDbConnection;
  }

  private async getCachedHealthSnapshot(
    cacheKey: string,
    resolve: () => Promise<HealthTrackedConnection | null>
  ): Promise<DataDbHealthSnapshot> {
    const untracked: DataDbHealthSnapshot = { state: 'untracked', changedAt: null };
    if (!this.prismaService) return untracked;
    const now = Date.now();
    const cached = this.hotPathHealthCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { state: cached.state, changedAt: cached.changedAt };
    }
    let state: DataDbHealthState | 'untracked' = 'untracked';
    let changedAt: Date | null = null;
    try {
      const connection = await resolve();
      if (connection) {
        state = connection.healthState as DataDbHealthState;
        changedAt = connection.healthChangedAt;
      }
    } catch (error) {
      this.logger.warn('data_db:health_lookup_failed', {
        cacheKey,
        error: describeError(error),
      });
    }
    if (this.hotPathHealthCache.size >= HOT_PATH_HEALTH_CACHE_MAX_ENTRIES) {
      this.hotPathHealthCache.clear();
    }
    this.hotPathHealthCache.set(cacheKey, {
      state,
      changedAt,
      expiresAt: now + HOT_PATH_HEALTH_CACHE_TTL_MS,
    });
    return { state, changedAt };
  }

  private async withSweepLease(run: () => Promise<void>): Promise<boolean> {
    const client = createKnex({
      client: 'pg',
      connection: {
        connectionString: getMetaDatabaseUrl(),
        connectionTimeoutMillis: HEALTH_PROBE_CONNECT_TIMEOUT_MS,
      },
      acquireConnectionTimeout: HEALTH_PROBE_CONNECT_TIMEOUT_MS,
      pool: { min: 0, max: 1 },
    });
    let connection: unknown;
    try {
      connection = await client.client.acquireConnection();
      const lockResult = await client
        .raw<{
          rows: Array<{ acquired: boolean }>;
        }>('select pg_try_advisory_lock(hashtext(?)) as acquired', [HEALTH_SWEEP_LOCK_KEY])
        .connection(connection)
        .timeout(HEALTH_PROBE_QUERY_TIMEOUT_MS, { cancel: true });
      if (!lockResult.rows[0]?.acquired) return false;
      try {
        await run();
        return true;
      } finally {
        await client
          .raw('select pg_advisory_unlock(hashtext(?))', [HEALTH_SWEEP_LOCK_KEY])
          .connection(connection)
          .timeout(HEALTH_PROBE_QUERY_TIMEOUT_MS, { cancel: true })
          .catch(() => undefined);
      }
    } finally {
      if (connection) await client.client.releaseConnection(connection);
      await client.destroy();
    }
  }
}
