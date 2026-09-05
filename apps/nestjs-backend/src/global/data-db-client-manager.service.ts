import { Inject, Injectable, Optional } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import {
  DataPrismaService,
  createScopedDataPrismaClient,
  getMetaDatabaseUrl,
} from '@teable/db-data-prisma';
import { PgPoolRegistry, PrismaService } from '@teable/db-main-prisma';
import createKnex, { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { PoolClient } from 'pg';
import { CustomHttpException } from '../custom.exception';
import { withDataDbInternalSchemaParam } from '../features/space/data-db-internal-schema';
import { DataDbMigrationService } from '../features/space/data-db-migration.service';
import { decryptDataDbUrl } from '../features/space/data-db-url-secret';
import type { IClsStore } from '../types/cls';
import {
  buildComputedOutboxActivePauseExclusion,
  buildComputedOutboxAnomalyListQuery,
  buildComputedOutboxDeadLetterBatchSelectionQuery,
  buildComputedOutboxLineageRunChainQuery,
  buildComputedOutboxLineageTaskLookupQuery,
  buildComputedOutboxRecoveryPlanHash,
  buildComputedOutboxOrphanedDeferralRestoreQuery,
  buildComputedOutboxRoutedFilter,
  buildComputedOutboxRunHistoryExistsQuery,
  buildComputedOutboxStaleRecoverySelectQuery,
  buildComputedOutboxTaskStatesQuery,
  buildComputedOutboxWakeupCandidatesQuery,
  COMPUTED_OUTBOX_ERROR_SIGNATURE_SQL,
  qualifyComputedOutboxTable,
  type ComputedOutboxDeadLetterBatchSelection,
  type ComputedOutboxWakeupCandidateQueryOptions,
  type ComputedOutboxWakeupCandidateQueryTarget,
} from './computed-outbox-maintenance-query';
import {
  DATA_DB_PRISMA_CACHE_NAMESPACE,
  DataDbRuntimeCacheService,
} from './data-db-runtime-cache.service';
import { DATA_KNEX } from './knex';

export interface IResolvedDataDatabase {
  cacheKey: string;
  url: string;
  /** Raw connection URL without Teable's internal-schema startup parameters. */
  connectionUrl?: string;
  isMetaFallback: boolean;
  connectionId?: string;
  internalSchema?: string;
}

export type IComputedOutboxMaintenanceTarget = IResolvedDataDatabase & {
  storage: 'default' | 'byodb';
  /** Meta-DB routing needed to evaluate space pause scopes in a BYODB data database. */
  baseSpaceMapping?: ReadonlyArray<{ baseId: string; spaceId: string }>;
};

export type IComputedOutboxMaintenanceSnapshot = {
  duePending: number;
  scheduledPending: number;
  /** Pending tasks blocked by an active table/base/space pause scope. */
  pausedPending: number;
  activeProcessing: number;
  staleProcessing: number;
  dead: number;
  /** Problem groups (same key as the admin anomaly list), not raw task rows. */
  anomalyGroups: number;
  oldestDueAgeMs: number;
  oldestPausedAgeMs: number;
  activePauseScopeCount: number;
};

export type IComputedOutboxMaintenanceAnomaly = {
  kind: 'dead' | 'stale';
  taskId: string;
  baseId: string;
  seedTableId: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  failedSql: string | null;
  failureKind: string | null;
  failurePhase: string | null;
  affectedTableName: string | null;
  occurredAt: Date;
};

export type IComputedOutboxMaintenanceAnomalySnapshot = {
  total: number;
  items: IComputedOutboxMaintenanceAnomaly[];
};

export type IComputedOutboxMaintenanceRecovery =
  | { status: 'recovered'; baseId: string }
  | { status: 'not_found' | 'conflict' };

export type IComputedOutboxMaintenanceDeadLetterBatchRecovery = {
  tasks: Array<{ taskId: string; baseId: string }>;
  inserted: number;
  alreadyPending: number;
};

export type IComputedOutboxWakeupCandidate = {
  taskId: string;
  baseId: string;
  availableAt: Date;
  revision: string;
};

export interface IDataDbPreviewBinding {
  spaceId: string;
  connectionId: string;
  encryptedUrl: string;
  internalSchema: string;
  urlFingerprint?: string | null;
  displayHost?: string | null;
  displayDatabase?: string | null;
}

export interface IDataDbRoutingOptions {
  useTransaction?: boolean;
  previewBinding?: IDataDbPreviewBinding;
  sourceConnectionId?: string | null;
}

type IMetaRoutingClient = PrismaService | NonNullable<IClsStore['tx']['client']>;

/**
 * Missing row and `mode: 'default'` both mean the platform meta DB — unbinding
 * rewrites `mode` rather than deleting the row. `state` is not consulted.
 */
const isBoundToDataDb = <T extends { mode: string }>(binding: T | null): binding is T =>
  binding !== null && binding.mode !== 'default';

export class DataDbBaseNotFoundError extends Error {
  constructor(readonly baseId: string) {
    super(`Base ${baseId} not found`);
    this.name = 'DataDbBaseNotFoundError';
  }
}

export class DataDbBindingNotReadyError extends CustomHttpException {
  readonly spaceId: string;

  constructor(spaceId: string) {
    super(
      `Data database binding for space ${spaceId} is not ready`,
      HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
      { spaceId }
    );
    this.name = 'DataDbBindingNotReadyError';
    this.spaceId = spaceId;
  }
}

type IResolvedSpaceDataDbRoute =
  | { isMetaFallback: true }
  | { connectionId: string; internalSchema: string; isMetaFallback: false; url: string };

const COMPUTED_OUTBOX_REDRIVE_LOCK_KEY = 'v2:computed-outbox:global-redrive:v1';
const COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS = 5000;
const COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS = 10_000;
const COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE = 500;

type IComputedOutboxSchemaTarget = Pick<ComputedOutboxWakeupCandidateQueryTarget, 'internalSchema'>;

const createComputedOutboxMaintenanceKnex = (target: IComputedOutboxMaintenanceTarget) =>
  createKnex({
    client: 'pg',
    connection: {
      // Never rely on URL `options=-c search_path=...`: pgbouncer/CNPG ignore it.
      // Pair this raw URL with schema-qualified SQL / knex.withSchema().
      connectionString: target.connectionUrl ?? target.url,
      connectionTimeoutMillis: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
    },
    acquireConnectionTimeout: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
    pool: { min: 0, max: 1 },
  });

const computedOutboxKnexTable = (
  db: Knex | Knex.Transaction,
  target: IComputedOutboxSchemaTarget,
  table: string
) => (target.internalSchema ? db(table).withSchema(target.internalSchema) : db(table));

/** Normalized lineage row over outbox / dead-letter / run-history (T6908). */
export type IComputedOutboxLineageRow = {
  source: 'live' | 'dead' | 'history';
  taskId: string;
  baseId: string;
  seedTableId: string;
  changeType: string;
  runId: string;
  originRunIds: string[] | null;
  status: 'pending' | 'processing' | 'dead' | 'succeeded';
  stageDepth: number | string;
  predecessorTaskId: string | null;
  attempts: number | string;
  estimatedComplexity: number | string;
  runTotalSteps: number | string;
  runCompletedStepsBefore: number | string;
  syncMaxLevel: number | string | null;
  sourceFieldIds: string[] | null;
  seedRecordCount: number | string | null;
  affectedTableIds: string[] | null;
  affectedFieldIds: string[] | null;
  sourceChangedAt: Date | string | null;
  enqueuedAt: Date | string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  failedAt: Date | string | null;
  durationMs: number | string | null;
  lastError: string | null;
  steps: unknown | null;
  edges: unknown | null;
};

export type IComputedOutboxLineageLookup = {
  task: IComputedOutboxLineageRow;
  chain: IComputedOutboxLineageRow[];
};

export type IComputedOutboxDeadLetterRow = {
  taskId: string;
  baseId: string;
  seedTableId: string;
  seedRecordIds: unknown | null;
  changeType: string;
  steps: unknown | null;
  edges: unknown | null;
  maxAttempts: number | string;
  estimatedComplexity: number | string | null;
  planHash: string | null;
  dirtyStats: unknown | null;
  runId: string | null;
  originRunIds: string[] | null;
  runTotalSteps: number | string | null;
  runCompletedStepsBefore: number | string | null;
  affectedTableIds: string[] | null;
  affectedFieldIds: string[] | null;
  syncMaxLevel: number | string | null;
  createdAt: Date | string;
};

const COMPUTED_OUTBOX_DEAD_LETTER_COLUMNS = {
  taskId: 'id',
  baseId: 'base_id',
  seedTableId: 'seed_table_id',
  seedRecordIds: 'seed_record_ids',
  changeType: 'change_type',
  steps: 'steps',
  edges: 'edges',
  maxAttempts: 'max_attempts',
  estimatedComplexity: 'estimated_complexity',
  planHash: 'plan_hash',
  dirtyStats: 'dirty_stats',
  runId: 'run_id',
  originRunIds: 'origin_run_ids',
  runTotalSteps: 'run_total_steps',
  runCompletedStepsBefore: 'run_completed_steps_before',
  affectedTableIds: 'affected_table_ids',
  affectedFieldIds: 'affected_field_ids',
  syncMaxLevel: 'sync_max_level',
  createdAt: 'created_at',
} as const;

const toRecoveredComputedOutboxRow = (
  dead: IComputedOutboxDeadLetterRow,
  planHash: string,
  now: Date
) => ({
  id: dead.taskId,
  base_id: dead.baseId,
  seed_table_id: dead.seedTableId,
  seed_record_ids: dead.seedRecordIds == null ? null : JSON.stringify(dead.seedRecordIds),
  change_type: dead.changeType,
  steps: dead.steps == null ? null : JSON.stringify(dead.steps),
  edges: dead.edges == null ? null : JSON.stringify(dead.edges),
  status: 'pending',
  attempts: 0,
  max_attempts: dead.maxAttempts,
  next_run_at: now,
  locked_at: null,
  locked_by: null,
  last_error: null,
  estimated_complexity: dead.estimatedComplexity,
  plan_hash: planHash,
  dirty_stats: dead.dirtyStats == null ? null : JSON.stringify(dead.dirtyStats),
  run_id: dead.runId,
  origin_run_ids: dead.originRunIds,
  run_total_steps: dead.runTotalSteps,
  run_completed_steps_before: dead.runCompletedStepsBefore,
  affected_table_ids: dead.affectedTableIds,
  affected_field_ids: dead.affectedFieldIds,
  sync_max_level: dead.syncMaxLevel,
  created_at: dead.createdAt,
  updated_at: now,
});

const restoreComputedOutboxDeadLetter = async (
  trx: Knex.Transaction,
  dead: IComputedOutboxDeadLetterRow,
  target: IComputedOutboxSchemaTarget = {}
): Promise<boolean> => {
  const inserted = await computedOutboxKnexTable(trx, target, 'computed_update_outbox')
    .insert(toRecoveredComputedOutboxRow(dead, dead.planHash ?? dead.taskId, new Date()))
    .onConflict()
    .ignore()
    .returning('id');
  return inserted.length > 0;
};

export const restoreComputedOutboxDeadLetterRows = async (
  trx: Knex.Transaction,
  rows: ReadonlyArray<IComputedOutboxDeadLetterRow>,
  target: IComputedOutboxSchemaTarget = {}
): Promise<IComputedOutboxMaintenanceDeadLetterBatchRecovery> => {
  // This pre-check is load-bearing, not an optimization: a task id already durable in the
  // outbox may hold the identical replay plan hash from an earlier recovery. Re-inserting
  // it could trip the pending plan-hash unique index before Postgres reaches the id
  // conflict, and `on conflict (id)` below would surface that as a transaction abort.
  const alreadyPendingTaskIds = new Set<string>();
  for (let offset = 0; offset < rows.length; offset += COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE) {
    const taskIds = rows
      .slice(offset, offset + COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE)
      .map((dead) => dead.taskId);
    if (taskIds.length === 0) continue;
    const existing = (await computedOutboxKnexTable(trx, target, 'computed_update_outbox')
      .whereIn('id', taskIds)
      .pluck('id')) as string[];
    for (const taskId of existing) alreadyPendingTaskIds.add(String(taskId));
  }

  const rowsToInsert = rows.filter((dead) => !alreadyPendingTaskIds.has(dead.taskId));
  const insertedTaskIds = new Set<string>();

  for (
    let offset = 0;
    offset < rowsToInsert.length;
    offset += COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE
  ) {
    const chunk = rowsToInsert.slice(offset, offset + COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE);
    const now = new Date();
    const inserted = (await computedOutboxKnexTable(trx, target, 'computed_update_outbox')
      .insert(
        chunk.map((dead) =>
          toRecoveredComputedOutboxRow(
            dead,
            buildComputedOutboxRecoveryPlanHash(dead.planHash ?? dead.taskId, dead.taskId),
            now
          )
        )
      )
      // Replayed plan hashes are unique per original task. A remaining conflict can only
      // be the same durable task id, which is already safe for consumer delivery.
      .onConflict('id')
      .ignore()
      .returning('id')) as Array<{ id: string }>;
    for (const row of inserted) insertedTaskIds.add(String(row.id));
  }

  for (let offset = 0; offset < rows.length; offset += COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE) {
    const taskIds = rows
      .slice(offset, offset + COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE)
      .map((dead) => dead.taskId);
    if (taskIds.length > 0) {
      await computedOutboxKnexTable(trx, target, 'computed_update_dead_letter')
        .whereIn('id', taskIds)
        .delete();
    }
  }

  return {
    tasks: rows.map((dead) => ({ taskId: dead.taskId, baseId: dead.baseId })),
    inserted: insertedTaskIds.size,
    alreadyPending: rows.length - insertedTaskIds.size,
  };
};

@Injectable()
export class DataDbClientManager {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly metaFallbackDataPrismaService: DataPrismaService,
    @InjectModel(DATA_KNEX) private readonly metaFallbackDataKnex: Knex,
    private readonly runtimeCache: DataDbRuntimeCacheService,
    private readonly pgPoolRegistry: PgPoolRegistry,
    @Optional()
    private readonly dataDbMigrationService?: DataDbMigrationService,
    @Optional()
    @Inject(ClsService)
    private readonly cls?: ClsService<IClsStore>
  ) {}

  private getMetaRoutingClient(options?: IDataDbRoutingOptions): IMetaRoutingClient {
    return options?.useTransaction ? this.prismaService.txClient() : this.prismaService;
  }

  /**
   * Request-scoped dedupe for routing lookups. Guards, container resolution and
   * query paths each re-resolve the same table/space routing inside one request;
   * the mapping is stable, so cache it for the request. Transactional lookups
   * bypass the cache — they may observe uncommitted meta rows.
   */
  private async withRoutingCache<T>(
    key: string,
    options: IDataDbRoutingOptions | undefined,
    load: () => Promise<T>
  ): Promise<T> {
    if (options?.useTransaction || !this.cls?.isActive() || typeof this.cls.get !== 'function') {
      return load();
    }
    let cache = this.cls.get('dataDbRoutingCache');
    if (!cache) {
      cache = new Map<string, unknown>();
      this.cls.set('dataDbRoutingCache', cache);
    }
    if (cache.has(key)) {
      return cache.get(key) as T;
    }
    const value = await load();
    cache.set(key, value);
    return value;
  }

  async getDataDatabaseForSpace(
    spaceId: string,
    options?: IDataDbRoutingOptions
  ): Promise<IResolvedDataDatabase> {
    return this.withRoutingCache(`space:${spaceId}`, options, () =>
      this.getDataDatabaseForSpaceUncached(spaceId, options)
    );
  }

  private async getDataDatabaseForSpaceUncached(
    spaceId: string,
    options?: IDataDbRoutingOptions
  ): Promise<IResolvedDataDatabase> {
    const resolved = await this.resolveSpaceDataDb(spaceId, options);

    if (resolved.isMetaFallback) {
      return {
        cacheKey: 'meta-fallback',
        url: getMetaDatabaseUrl(),
        connectionUrl: getMetaDatabaseUrl(),
        isMetaFallback: true,
      };
    }

    return {
      cacheKey: resolved.connectionId,
      connectionId: resolved.connectionId,
      internalSchema: resolved.internalSchema,
      url: withDataDbInternalSchemaParam(resolved.url, resolved.internalSchema),
      connectionUrl: resolved.url,
      isMetaFallback: false,
    };
  }

  async getDataDatabaseUrlForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    return (await this.getDataDatabaseForSpace(spaceId, options)).url;
  }

  async getDataDatabaseForBase(baseId: string, options?: IDataDbRoutingOptions) {
    const spaceId = await this.withRoutingCache(`base:${baseId}`, options, async () => {
      const base = await this.getMetaRoutingClient(options).base.findUnique({
        where: { id: baseId },
        select: { spaceId: true },
      });
      if (!base) {
        throw new DataDbBaseNotFoundError(baseId);
      }
      return base.spaceId;
    });
    return await this.getDataDatabaseForSpace(spaceId, options);
  }

  async getDataDatabaseUrlForBase(baseId: string, options?: IDataDbRoutingOptions) {
    return (await this.getDataDatabaseForBase(baseId, options)).url;
  }

  async getDataDatabaseForTable(tableId: string, options?: IDataDbRoutingOptions) {
    const spaceId = await this.withRoutingCache(`table:${tableId}`, options, async () => {
      const table = await this.getMetaRoutingClient(options).tableMeta.findUnique({
        where: { id: tableId },
        select: { base: { select: { spaceId: true } } },
      });
      if (!table) {
        throw new Error(`Table ${tableId} not found`);
      }
      return table.base.spaceId;
    });
    return await this.getDataDatabaseForSpace(spaceId, options);
  }

  /**
   * Stops at the binding row: `resolveSpaceDataDb` would migrate the bound
   * database first, which throws once that database is gone — exactly when a
   * failed cleanup needs this answer.
   */
  async isMetaFallbackForBase(baseId: string, options?: IDataDbRoutingOptions) {
    const base = await this.getMetaRoutingClient(options).base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new Error(`Base ${baseId} not found`);
    }
    return !isBoundToDataDb(await this.findSpaceDataDbBinding(base.spaceId, options));
  }

  private async findSpaceDataDbBinding(spaceId: string, options?: IDataDbRoutingOptions) {
    return await this.getMetaRoutingClient(options).spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });
  }

  async listComputedOutboxMaintenanceTargets(): Promise<
    ReadonlyArray<IComputedOutboxMaintenanceTarget>
  > {
    const connections = await this.prismaService.dataDbConnection.findMany({
      where: {
        status: 'ready',
        spaceBindings: {
          some: {
            mode: 'byodb',
            state: 'ready',
          },
        },
      },
      select: {
        id: true,
        encryptedUrl: true,
        internalSchema: true,
        spaceBindings: {
          where: { mode: 'byodb', state: 'ready' },
          select: { spaceId: true },
        },
      },
    });
    const spaceIds = [
      ...new Set(
        connections.flatMap((connection) => connection.spaceBindings.map((b) => b.spaceId))
      ),
    ];
    const bases =
      spaceIds.length > 0
        ? await this.prismaService.base.findMany({
            where: { spaceId: { in: spaceIds } },
            select: { id: true, spaceId: true },
          })
        : [];
    const basesBySpace = new Map<string, Array<{ baseId: string; spaceId: string }>>();
    for (const base of bases) {
      const mapping = basesBySpace.get(base.spaceId) ?? [];
      mapping.push({ baseId: base.id, spaceId: base.spaceId });
      basesBySpace.set(base.spaceId, mapping);
    }

    return [
      {
        cacheKey: 'meta-fallback',
        url: getMetaDatabaseUrl(),
        connectionUrl: getMetaDatabaseUrl(),
        isMetaFallback: true,
        storage: 'default',
      },
      ...connections.map((connection) => ({
        cacheKey: connection.id,
        connectionId: connection.id,
        internalSchema: connection.internalSchema,
        connectionUrl: decryptDataDbUrl(connection.encryptedUrl),
        url: withDataDbInternalSchemaParam(
          decryptDataDbUrl(connection.encryptedUrl),
          connection.internalSchema
        ),
        isMetaFallback: false as const,
        storage: 'byodb' as const,
        baseSpaceMapping: connection.spaceBindings.flatMap(
          (binding) => basesBySpace.get(binding.spaceId) ?? []
        ),
      })),
    ];
  }

  /**
   * Bases whose space currently has a BYODB binding, including bindings whose
   * connection is disabled/unready and therefore absent from the queryable
   * maintenance inventory. Used to hide leftover default-storage anomalies
   * that must not be recovered onto the meta database.
   */
  async listByodbBoundBaseIds(): Promise<string[]> {
    const bases = await this.prismaService.base.findMany({
      where: {
        deletedTime: null,
        space: {
          dataDbBinding: {
            is: { mode: 'byodb' },
          },
        },
      },
      select: { id: true },
    });
    return bases.map((base) => base.id);
  }

  /**
   * Reconcile pause-deferral orphans: pending rows future-dated beyond every
   * legitimate schedule with no active pause scope covering them (see
   * buildComputedOutboxOrphanedDeferralRestoreQuery). Returns restored rows.
   */
  async restoreOrphanedComputedOutboxDeferrals(
    target: IComputedOutboxMaintenanceTarget,
    orphanedDeferralThresholdMs: number
  ): Promise<number> {
    const client = createComputedOutboxMaintenanceKnex(target);
    try {
      const restoreQuery = buildComputedOutboxOrphanedDeferralRestoreQuery(
        target,
        orphanedDeferralThresholdMs
      );
      const result = await client
        .raw<{ rowCount: number }>(restoreQuery.sql, restoreQuery.bindings)
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      return Number((result as { rowCount?: number }).rowCount ?? 0);
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  async *iterateComputedOutboxWakeupCandidates(
    target: IComputedOutboxMaintenanceTarget,
    processingLeaseMs: number,
    batchSize = 500,
    options: ComputedOutboxWakeupCandidateQueryOptions = {}
  ): AsyncGenerator<ReadonlyArray<IComputedOutboxWakeupCandidate>> {
    const client = createComputedOutboxMaintenanceKnex(target);
    let afterId: string | undefined;
    const normalizedBatchSize = Math.max(1, Math.trunc(batchSize));

    try {
      while (true) {
        const candidateQuery = buildComputedOutboxWakeupCandidatesQuery(
          target,
          processingLeaseMs,
          normalizedBatchSize,
          afterId,
          options
        );
        const result = await client
          .raw<{
            rows: Array<{
              taskId: string;
              baseId: string;
              status: 'pending' | 'processing';
              nextRunAt: Date | string;
              lockedAt: Date | string | null;
              attempts: number;
              updatedAt: Date | string;
            }>;
          }>(candidateQuery.sql, candidateQuery.bindings)
          .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
        const rows = result.rows as Array<{
          taskId: string;
          baseId: string;
          status: 'pending' | 'processing';
          nextRunAt: Date | string;
          lockedAt: Date | string | null;
          attempts: number;
          updatedAt: Date | string;
        }>;
        if (rows.length === 0) return;

        yield rows.map((row) => {
          const dueAt =
            row.status === 'processing' && row.lockedAt
              ? new Date(row.lockedAt).getTime() + processingLeaseMs
              : new Date(row.nextRunAt).getTime();
          return {
            taskId: String(row.taskId),
            baseId: String(row.baseId),
            availableAt: new Date(dueAt),
            revision: [
              new Date(row.updatedAt).getTime(),
              row.attempts,
              new Date(row.nextRunAt).getTime(),
              row.lockedAt ? new Date(row.lockedAt).getTime() : 0,
            ].join('-'),
          };
        });

        afterId = String(rows[rows.length - 1]?.taskId);
        if (rows.length < normalizedBatchSize) return;
      }
    } finally {
      await client.destroy();
    }
  }

  async withComputedOutboxRedriveLease(run: () => Promise<void>): Promise<boolean> {
    const client = createKnex({
      client: 'pg',
      connection: {
        connectionString: getMetaDatabaseUrl(),
        connectionTimeoutMillis: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
      },
      acquireConnectionTimeout: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
      pool: { min: 0, max: 1 },
    });
    let connection: unknown;
    try {
      connection = await client.client.acquireConnection();
      const lockResult = await client
        .raw<{
          rows: Array<{ acquired: boolean }>;
        }>('select pg_try_advisory_lock(hashtext(?)) as acquired', [
          COMPUTED_OUTBOX_REDRIVE_LOCK_KEY,
        ])
        .connection(connection)
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      if (!lockResult.rows[0]?.acquired) return false;

      try {
        await run();
        return true;
      } finally {
        await client
          .raw('select pg_advisory_unlock(hashtext(?))', [COMPUTED_OUTBOX_REDRIVE_LOCK_KEY])
          .connection(connection)
          .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true })
          .catch(() => undefined);
      }
    } finally {
      if (connection) await client.client.releaseConnection(connection);
      await client.destroy();
    }
  }

  async inspectComputedOutboxMaintenanceTarget(
    target: IComputedOutboxMaintenanceTarget,
    processingLeaseMs: number
  ): Promise<IComputedOutboxMaintenanceSnapshot> {
    const client = createComputedOutboxMaintenanceKnex(target);
    const pauseExclusion = buildComputedOutboxActivePauseExclusion(target);
    // Anomaly counts (dead / stale) must match the anomaly list, which hides
    // entries whose base no longer routes here (BYODB migration, deleted base).
    // anomalyGroups uses the same (base, seed table, error signature) key as the list.
    const routedFilter = buildComputedOutboxRoutedFilter(target);
    const outboxTable = qualifyComputedOutboxTable(target, 'computed_update_outbox');
    const deadLetterTable = qualifyComputedOutboxTable(target, 'computed_update_dead_letter');
    const pauseScopeTable = qualifyComputedOutboxTable(target, 'computed_update_pause_scope');
    try {
      const result = await client
        .raw<{
          rows: Array<Record<string, string | number | null>>;
        }>(
          `with ${routedFilter.cte},
          outbox_state as (
            select o.*,
              ${pauseExclusion.sql} as actionable,
              (${routedFilter.condition('o.base_id')}) as routed
            from ${outboxTable} as o
          )
        select
          count(*) filter (
            where status = 'pending' and next_run_at <= now() and actionable
          ) as due_pending,
          count(*) filter (
            where status = 'pending' and next_run_at > now() and actionable
          ) as scheduled_pending,
          count(*) filter (where status = 'pending' and not actionable) as paused_pending,
          count(*) filter (
            where status = 'processing'
              and locked_at is not null
              and locked_at > now() - (? * interval '1 millisecond')
          ) as active_processing,
          count(*) filter (
            where status = 'processing'
              and actionable
              and routed
              and (locked_at is null or locked_at <= now() - (? * interval '1 millisecond'))
          ) as stale_processing,
          coalesce(
            extract(epoch from (now() - min(next_run_at) filter (
              where status = 'pending' and next_run_at <= now() and actionable
            ))) * 1000,
            0
          ) as oldest_due_age_ms,
          coalesce(
            extract(epoch from (now() - min(created_at) filter (
              where status = 'pending' and not actionable
            ))) * 1000,
            0
          ) as oldest_paused_age_ms,
          (
            select count(*)
            from ${pauseScopeTable}
            where resume_at is null or resume_at > now()
          ) as active_pause_scope_count,
          (
            select count(*)
            from ${deadLetterTable}
            where ${routedFilter.condition('base_id')}
          ) as dead,
          (
            select count(*)
            from (
              select 1
              from ${deadLetterTable}
              where ${routedFilter.condition('base_id')}
              group by base_id, seed_table_id, ${COMPUTED_OUTBOX_ERROR_SIGNATURE_SQL}
            ) dead_groups
          ) as dead_groups,
          (
            select count(*)
            from (
              select 1
              from outbox_state
              where status = 'processing'
                and actionable
                and routed
                and (locked_at is null or locked_at <= now() - (? * interval '1 millisecond'))
              group by base_id, seed_table_id, ${COMPUTED_OUTBOX_ERROR_SIGNATURE_SQL}
            ) stale_groups
          ) as stale_groups
        from outbox_state`,
          [
            ...routedFilter.bindings,
            ...pauseExclusion.bindings,
            processingLeaseMs,
            processingLeaseMs,
            processingLeaseMs,
          ]
        )
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      const row = result.rows[0] ?? {};
      return {
        duePending: Number(row.due_pending ?? 0),
        scheduledPending: Number(row.scheduled_pending ?? 0),
        pausedPending: Number(row.paused_pending ?? 0),
        activeProcessing: Number(row.active_processing ?? 0),
        staleProcessing: Number(row.stale_processing ?? 0),
        dead: Number(row.dead ?? 0),
        anomalyGroups: Number(row.dead_groups ?? 0) + Number(row.stale_groups ?? 0),
        oldestDueAgeMs: Number(row.oldest_due_age_ms ?? 0),
        oldestPausedAgeMs: Number(row.oldest_paused_age_ms ?? 0),
        activePauseScopeCount: Number(row.active_pause_scope_count ?? 0),
      };
    } finally {
      await client.destroy();
    }
  }

  async listComputedOutboxMaintenanceAnomalies(
    target: IComputedOutboxMaintenanceTarget,
    processingLeaseMs: number,
    limit: number
  ): Promise<IComputedOutboxMaintenanceAnomalySnapshot> {
    const client = createComputedOutboxMaintenanceKnex(target);
    const query = buildComputedOutboxAnomalyListQuery(target, processingLeaseMs, limit);

    try {
      const result = await client
        .raw<{
          rows: Array<{
            kind: 'dead' | 'stale';
            taskId: string;
            baseId: string;
            seedTableId: string;
            attempts: number | string;
            maxAttempts: number | string;
            lastError: string | null;
            failedSql: string | null;
            failureKind: string | null;
            failurePhase: string | null;
            affectedTableName: string | null;
            occurredAt: Date | string;
            total: number | string;
          }>;
        }>(query.sql, query.bindings)
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });

      return {
        total: Number(result.rows[0]?.total ?? 0),
        items: result.rows.map((row) => ({
          kind: row.kind,
          taskId: String(row.taskId),
          baseId: String(row.baseId),
          seedTableId: String(row.seedTableId),
          attempts: Number(row.attempts),
          maxAttempts: Number(row.maxAttempts),
          lastError: row.lastError,
          failedSql: row.failedSql,
          failureKind: row.failureKind,
          failurePhase: row.failurePhase,
          affectedTableName: row.affectedTableName,
          occurredAt: new Date(row.occurredAt),
        })),
      };
    } finally {
      await client.destroy();
    }
  }

  /** Read an anomaly's base id without mutating it, so recovery can validate routing first. */
  async peekComputedOutboxMaintenanceAnomalyBase(
    target: IComputedOutboxMaintenanceTarget,
    taskId: string,
    kind: 'dead' | 'stale'
  ): Promise<string | null> {
    const client = createComputedOutboxMaintenanceKnex(target);
    try {
      const table = kind === 'dead' ? 'computed_update_dead_letter' : 'computed_update_outbox';
      const row = await computedOutboxKnexTable(client, target, table)
        .select('base_id')
        .where({ id: taskId })
        .first<{ base_id: string } | undefined>()
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      return row ? String(row.base_id) : null;
    } finally {
      await client.destroy();
    }
  }

  /**
   * Batch-resolve where the given durable tasks currently stand in one storage
   * target's ledger. Tasks absent from the result are not in this target at all.
   */
  async lookupComputedOutboxMaintenanceTaskStates(
    target: IComputedOutboxMaintenanceTarget,
    taskIds: ReadonlyArray<string>
  ): Promise<Map<string, 'pending' | 'processing' | 'dead'>> {
    if (!taskIds.length) return new Map();
    const client = createComputedOutboxMaintenanceKnex(target);
    const query = buildComputedOutboxTaskStatesQuery(target, taskIds);
    try {
      const result = await client
        .raw<{
          rows: Array<{ taskId: string; state: 'pending' | 'processing' | 'dead' }>;
        }>(query.sql, query.bindings)
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      const states = new Map<string, 'pending' | 'processing' | 'dead'>();
      for (const row of result.rows) {
        // A task can transiently appear in both tables mid-recovery; dead wins
        // so the UI always points at the actionable anomaly entry.
        const existing = states.get(row.taskId);
        if (existing === 'dead') continue;
        states.set(row.taskId, row.state);
      }
      return states;
    } finally {
      await client.destroy();
    }
  }

  /**
   * Resolve one task's lineage on a single storage target: the task itself
   * (live outbox / dead letter / run history) plus every ledger entry sharing
   * its run lineage. Returns null when the task is unknown to this target.
   * The run-history arm is included only when the ledger table exists, so
   * targets whose data-db migration has not landed still answer.
   */
  async lookupComputedOutboxLineage(
    target: IComputedOutboxMaintenanceTarget,
    taskId: string,
    options: { chainLimit?: number } = {}
  ): Promise<IComputedOutboxLineageLookup | null> {
    const client = createComputedOutboxMaintenanceKnex(target);
    try {
      const existsQuery = buildComputedOutboxRunHistoryExistsQuery(target);
      const existsResult = await client
        .raw<{ rows: Array<{ exists: boolean }> }>(existsQuery.sql, existsQuery.bindings)
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      const includeHistory = Boolean(existsResult.rows[0]?.exists);

      const lookupQuery = buildComputedOutboxLineageTaskLookupQuery(target, taskId, includeHistory);
      const lookupResult = await client
        .raw<{ rows: IComputedOutboxLineageRow[] }>(lookupQuery.sql, lookupQuery.bindings)
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      // A task can transiently sit in more than one ledger mid-recovery; the
      // live row reflects current state, then dead, then history.
      const priority: Record<IComputedOutboxLineageRow['source'], number> = {
        live: 0,
        dead: 1,
        history: 2,
      };
      const task = [...lookupResult.rows].sort(
        (a, b) => priority[a.source] - priority[b.source]
      )[0];
      if (!task) return null;

      const runIds = [
        ...new Set([String(task.runId), ...(task.originRunIds ?? []).map(String)]),
      ].filter((id) => id.length > 0);
      if (!runIds.length) return { task, chain: [task] };

      const chainQuery = buildComputedOutboxLineageRunChainQuery(
        target,
        runIds,
        includeHistory,
        options.chainLimit ?? 200
      );
      const chainResult = await client
        .raw<{ rows: IComputedOutboxLineageRow[] }>(chainQuery.sql, chainQuery.bindings)
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      // Dedupe by taskId with the same source priority the lookup used.
      const byTaskId = new Map<string, IComputedOutboxLineageRow>();
      for (const row of chainResult.rows) {
        const existing = byTaskId.get(String(row.taskId));
        if (!existing || priority[row.source] < priority[existing.source]) {
          byTaskId.set(String(row.taskId), row);
        }
      }
      if (!byTaskId.has(String(task.taskId))) byTaskId.set(String(task.taskId), task);
      return { task, chain: [...byTaskId.values()] };
    } finally {
      await client.destroy();
    }
  }

  async recoverComputedOutboxMaintenanceAnomaly(
    target: IComputedOutboxMaintenanceTarget,
    taskId: string,
    kind: 'dead' | 'stale',
    processingLeaseMs: number
  ): Promise<IComputedOutboxMaintenanceRecovery> {
    const client = createComputedOutboxMaintenanceKnex(target);

    try {
      if (kind === 'stale') {
        const query = buildComputedOutboxStaleRecoverySelectQuery(
          target,
          taskId,
          processingLeaseMs
        );
        const result = await client
          .raw<{ rows: Array<{ baseId: string }> }>(query.sql, query.bindings)
          .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
        const row = result.rows[0];
        return row ? { status: 'recovered', baseId: String(row.baseId) } : { status: 'not_found' };
      }

      return await client.transaction(async (trx) => {
        const dead = (await computedOutboxKnexTable(trx, target, 'computed_update_dead_letter')
          .select(COMPUTED_OUTBOX_DEAD_LETTER_COLUMNS)
          .where({ id: taskId })
          .forUpdate()
          .first()) as IComputedOutboxDeadLetterRow | undefined;
        if (!dead) return { status: 'not_found' } as const;

        const inserted = await restoreComputedOutboxDeadLetter(trx, dead, target);
        if (!inserted) return { status: 'conflict' } as const;

        await computedOutboxKnexTable(trx, target, 'computed_update_dead_letter')
          .where({ id: taskId })
          .delete();
        return { status: 'recovered', baseId: dead.baseId } as const;
      });
    } finally {
      await client.destroy();
    }
  }

  async recoverComputedOutboxMaintenanceDeadLetterBatch(
    target: IComputedOutboxMaintenanceTarget,
    selection: ComputedOutboxDeadLetterBatchSelection
  ): Promise<IComputedOutboxMaintenanceDeadLetterBatchRecovery> {
    const client = createComputedOutboxMaintenanceKnex(target);
    const query = buildComputedOutboxDeadLetterBatchSelectionQuery(target, selection);

    try {
      return await client.transaction(async (trx) => {
        const selected = await trx
          .raw<{ rows: Array<{ taskId: string }> }>(query.sql, query.bindings)
          .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
        const taskIds = selected.rows.map((row) => String(row.taskId));

        const tasks: Array<{ taskId: string; baseId: string }> = [];
        let inserted = 0;
        let alreadyPending = 0;
        for (
          let offset = 0;
          offset < taskIds.length;
          offset += COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE
        ) {
          const chunkIds = taskIds.slice(
            offset,
            offset + COMPUTED_OUTBOX_RECOVERY_INSERT_CHUNK_SIZE
          );
          const fetched = (await computedOutboxKnexTable(trx, target, 'computed_update_dead_letter')
            .select(COMPUTED_OUTBOX_DEAD_LETTER_COLUMNS)
            .whereIn('id', chunkIds)) as IComputedOutboxDeadLetterRow[];
          const byTaskId = new Map(fetched.map((row) => [row.taskId, row]));
          const rows = chunkIds.flatMap((id) => byTaskId.get(id) ?? []);
          const recovery = await restoreComputedOutboxDeadLetterRows(trx, rows, target);
          tasks.push(...recovery.tasks);
          inserted += recovery.inserted;
          alreadyPending += recovery.alreadyPending;
        }
        return { tasks, inserted, alreadyPending };
      });
    } finally {
      await client.destroy();
    }
  }

  /**
   * Permanently drop one root-cause group of dead letters without replaying
   * it. The selection is keyed exactly like batch recovery, so an admin can
   * only discard the same population the anomaly page shows. No routing guard:
   * the primary use case is a group whose base no longer exists anywhere.
   */
  async discardComputedOutboxMaintenanceDeadLetterBatch(
    target: IComputedOutboxMaintenanceTarget,
    selection: ComputedOutboxDeadLetterBatchSelection
  ): Promise<{ discarded: number }> {
    const client = createComputedOutboxMaintenanceKnex(target);
    const query = buildComputedOutboxDeadLetterBatchSelectionQuery(target, selection);

    try {
      return await client.transaction(async (trx) => {
        const selected = await trx
          .raw<{ rows: Array<{ taskId: string }> }>(query.sql, query.bindings)
          .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
        const taskIds = selected.rows.map((row) => String(row.taskId));
        if (!taskIds.length) return { discarded: 0 };
        const discarded = await computedOutboxKnexTable(trx, target, 'computed_update_dead_letter')
          .whereIn('id', taskIds)
          .delete();
        return { discarded };
      });
    } finally {
      await client.destroy();
    }
  }

  async getDataDatabaseUrlForTable(tableId: string, options?: IDataDbRoutingOptions) {
    return (await this.getDataDatabaseForTable(tableId, options)).url;
  }

  /** Returns a compiler-only Knex handle. Execute queries through withDataKnexConnectionForSpace. */
  async dataKnexForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    await this.resolveSpaceDataDb(spaceId, options);
    return this.metaFallbackDataKnex;
  }

  async withDataKnexConnectionForSpace<T>(
    spaceId: string,
    fn: (knex: Knex, connection: PoolClient) => Promise<T>,
    options?: IDataDbRoutingOptions
  ): Promise<T> {
    const resolved = await this.resolveSpaceDataDb(spaceId, options);
    const connectionString = resolved.isMetaFallback ? getMetaDatabaseUrl() : resolved.url;
    const poolLease = this.pgPoolRegistry.acquire(connectionString, {
      ...(!resolved.isMetaFallback
        ? { max: Number(process.env.BYODB_DATA_DB_POOL_MAX ?? 5) }
        : undefined),
    });
    let connection: PoolClient | undefined;
    try {
      connection = await poolLease.pool.connect();
      return await fn(this.metaFallbackDataKnex, connection);
    } finally {
      connection?.release();
      await poolLease.release();
    }
  }

  async dataPrismaForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    const resolved = await this.resolveSpaceDataDb(spaceId, options);

    if (resolved.isMetaFallback) {
      return this.metaFallbackDataPrismaService;
    }

    return await this.runtimeCache.getOrCreate(
      DATA_DB_PRISMA_CACHE_NAMESPACE,
      resolved.connectionId,
      async () => {
        const poolLease = this.pgPoolRegistry.acquire(resolved.url, {
          max: Number(process.env.BYODB_DATA_DB_POOL_MAX ?? 5),
        });
        try {
          return createScopedDataPrismaClient(poolLease, resolved.internalSchema);
        } catch (error) {
          await poolLease.release();
          throw error;
        }
      },
      (client) => client.$disconnect()
    );
  }

  /** Returns a compiler-only Knex handle. Execute queries through withDataKnexConnectionForBase. */
  async dataKnexForBase(baseId: string, options?: IDataDbRoutingOptions) {
    const base = await this.getMetaRoutingClient(options).base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new Error(`Base ${baseId} not found`);
    }
    return await this.dataKnexForSpace(base.spaceId, options);
  }

  async withDataKnexConnectionForBase<T>(
    baseId: string,
    fn: (knex: Knex, connection: PoolClient) => Promise<T>,
    options?: IDataDbRoutingOptions
  ): Promise<T> {
    const base = await this.getMetaRoutingClient(options).base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new Error(`Base ${baseId} not found`);
    }
    return this.withDataKnexConnectionForSpace(base.spaceId, fn, options);
  }

  /** Returns a compiler-only Knex handle. Execute queries through withDataKnexConnectionForTable. */
  async dataKnexForTable(tableId: string, options?: IDataDbRoutingOptions) {
    const table = await this.getMetaRoutingClient(options).tableMeta.findUnique({
      where: { id: tableId },
      select: { base: { select: { spaceId: true } } },
    });
    if (!table) {
      throw new Error(`Table ${tableId} not found`);
    }
    return await this.dataKnexForSpace(table.base.spaceId, options);
  }

  async withDataKnexConnectionForTable<T>(
    tableId: string,
    fn: (knex: Knex, connection: PoolClient) => Promise<T>,
    options?: IDataDbRoutingOptions
  ): Promise<T> {
    const table = await this.getMetaRoutingClient(options).tableMeta.findUnique({
      where: { id: tableId },
      select: { base: { select: { spaceId: true } } },
    });
    if (!table) {
      throw new Error(`Table ${tableId} not found`);
    }
    return this.withDataKnexConnectionForSpace(table.base.spaceId, fn, options);
  }

  async dataPrismaForTable(tableId: string, options?: IDataDbRoutingOptions) {
    const table = await this.getMetaRoutingClient(options).tableMeta.findUnique({
      where: { id: tableId },
      select: { base: { select: { spaceId: true } } },
    });
    if (!table) {
      throw new Error(`Table ${tableId} not found`);
    }
    return await this.dataPrismaForSpace(table.base.spaceId, options);
  }

  async dataPrismaForBase(baseId: string, options?: IDataDbRoutingOptions) {
    const base = await this.getMetaRoutingClient(options).base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new Error(`Base ${baseId} not found`);
    }
    return await this.dataPrismaForSpace(base.spaceId, options);
  }

  async invalidateConnection(connectionId: string) {
    await this.runtimeCache.deleteByKey(connectionId);
  }

  private async resolveSpaceDataDb(
    spaceId: string,
    options?: IDataDbRoutingOptions
  ): Promise<IResolvedSpaceDataDbRoute> {
    if ('sourceConnectionId' in (options ?? {})) {
      return await this.resolveSourceSpaceDataDb(options);
    }

    if (options?.previewBinding?.spaceId === spaceId) {
      return this.resolvePreviewSpaceDataDb(spaceId, options.previewBinding);
    }

    const binding = await this.findSpaceDataDbBinding(spaceId, options);

    if (!isBoundToDataDb(binding)) {
      // A bound space must never silently fall back to the meta database:
      // DDL or writes landing there materialize into the orphaned source
      // schema as "ghost" tables (meta alive, physical relation missing in
      // the real data db). The transaction-scoped client can observe state
      // that diverges from the primary, so re-check before accepting the
      // fallback; the non-transactional path already read from the primary.
      if (options?.useTransaction) {
        const primaryBinding = await this.prismaService.spaceDataDbBinding.findUnique({
          where: { spaceId },
          select: { mode: true },
        });
        if (primaryBinding && primaryBinding.mode !== 'default') {
          throw new Error(
            `Data database routing for space ${spaceId} resolved to the meta fallback while a '${primaryBinding.mode}' binding exists`
          );
        }
      }
      return { isMetaFallback: true };
    }

    const connection = binding.dataDbConnection;
    if (!connection) {
      throw new Error(`Data database connection for space ${spaceId} was not found`);
    }

    const migratableStates = this.dataDbMigrationService
      ? ['ready', 'migrating', 'error']
      : ['ready'];

    if (!migratableStates.includes(binding.state)) {
      throw new DataDbBindingNotReadyError(spaceId);
    }

    if (!migratableStates.includes(connection.status)) {
      throw new DataDbBindingNotReadyError(spaceId);
    }

    if (!connection.encryptedUrl) {
      throw new Error(`Data database connection for space ${spaceId} has no encrypted URL`);
    }

    if (this.cls?.isActive()) {
      this.cls.set('dataDb', {
        mode: 'byodb',
        spaceId,
        connectionId: connection.id,
        urlFingerprint: connection.urlFingerprint,
        displayHost: connection.displayHost,
        displayDatabase: connection.displayDatabase,
        internalSchema: connection.internalSchema,
      });
    }

    const url = decryptDataDbUrl(connection.encryptedUrl);
    await this.dataDbMigrationService?.ensureConnectionMigrated({
      connectionId: connection.id,
      internalSchema: connection.internalSchema,
      url,
    });

    return {
      connectionId: connection.id,
      internalSchema: connection.internalSchema,
      isMetaFallback: false,
      url,
    };
  }

  private resolvePreviewSpaceDataDb(
    spaceId: string,
    preview: IDataDbPreviewBinding
  ): IResolvedSpaceDataDbRoute {
    if (this.cls?.isActive()) {
      this.cls.set('dataDb', {
        mode: 'byodb',
        spaceId,
        connectionId: preview.connectionId,
        urlFingerprint: preview.urlFingerprint ?? null,
        displayHost: preview.displayHost ?? null,
        displayDatabase: preview.displayDatabase ?? null,
        internalSchema: preview.internalSchema,
      });
    }

    return {
      connectionId: preview.connectionId,
      internalSchema: preview.internalSchema,
      isMetaFallback: false,
      url: decryptDataDbUrl(preview.encryptedUrl),
    };
  }

  private async resolveSourceSpaceDataDb(
    options?: IDataDbRoutingOptions
  ): Promise<IResolvedSpaceDataDbRoute> {
    const sourceConnectionId = options?.sourceConnectionId ?? null;
    if (!sourceConnectionId) {
      return { isMetaFallback: true };
    }

    const connection = await this.getMetaRoutingClient(options).dataDbConnection.findUnique({
      where: { id: sourceConnectionId },
    });
    if (!connection?.encryptedUrl) {
      throw new Error(`Data database source connection ${sourceConnectionId} was not found`);
    }

    return {
      connectionId: connection.id,
      internalSchema: connection.internalSchema,
      isMetaFallback: false,
      url: decryptDataDbUrl(connection.encryptedUrl),
    };
  }

  async onModuleDestroy() {
    await this.runtimeCache.deleteByNamespace(DATA_DB_PRISMA_CACHE_NAMESPACE);
  }
}
