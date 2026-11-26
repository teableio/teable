/* eslint-disable @typescript-eslint/naming-convention */
import { randomUUID } from 'node:crypto';
import {
  getPostgresTransaction,
  pgErrorCode,
  resolvePostgresDbOrTx,
  v2DataDbTokens,
  v2MetaDbTokens,
  type IV2PostgresDbConfig,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  TRANSACTION_RETRYABLE_CONTENTION_CODE,
  domainError,
  v2CoreTokens,
  type BaseId,
  type DomainError,
  type IExecutionContext,
  type IUnitOfWork,
  type IUnitOfWorkTransaction,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import {
  err,
  ok,
  vcsDomainError,
  type IBaseVcsSnapshot,
  type IBaseVcsPatchSummary,
  type IVcsStoredChange,
  type Result,
  type VcsChangeOpKind,
  type VcsEntityType,
} from '@teable/v2-vcs';
import {
  type IBaseVcsLogRepository,
  type IVcsChangePage,
  type IVcsChangeRowInput,
  type IVcsCommit,
  type IVcsCommitInput,
  type IVcsEnableResult,
  type IVcsRevisionComparison,
  type VcsCheckpointCapture,
  type IVcsHeadState,
  type IVcsPullCursor,
  type IVcsPushMetadataLockTargets,
  type IVcsPushPhysicalTableLockTarget,
  type SelectHistoricalCheckpointRecords,
} from '@teable/v2-vcs/server';
import { type ColumnType, type Kysely, sql, type Transaction, type RawBuilder } from 'kysely';

import {
  captureCheckpoint,
  compareRevisions,
  readCheckpointTableIds,
  readHistoricalSelection,
  readSnapshot,
} from './checkpointStore';
import {
  computeVcsTableScopeTag,
  encodeVcsPullCursor,
  isCursorBeforeRetention,
  isValidPgSnapshotText,
} from './cursor';
import { v2VcsPostgresTokens, type IV2VcsPostgresAdapterConfig } from './tokens';

export interface IBaseVcsHeadTableRow {
  base_id: string;
  enabled: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  enabled_barrier_xid?: ColumnType<string, string | undefined, string | undefined>;
  head_revision: string | number;
  min_retained_seq: ColumnType<
    string | number,
    string | number | undefined,
    string | number | undefined
  >;
  min_retained_xid: ColumnType<string, string | undefined, string | undefined>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
}

export interface IBaseVcsChangeTableRow {
  seq: ColumnType<string | number, string | number | undefined, never>;
  tx_id: ColumnType<string, string | undefined, never>;
  base_id: string;
  revision: ColumnType<
    string | number | null,
    string | number | null | undefined,
    string | number | null | undefined
  >;
  origin_push_id: string | null;
  table_id: string;
  entity_type: VcsEntityType;
  entity_id: string;
  field_id: string | null;
  op_kind: VcsChangeOpKind;
  before_value: unknown;
  after_value: unknown;
  actor_id: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface IBaseVcsCommitTableRow {
  commit_id: string;
  base_id: string;
  revision: string | number;
  parent_revision: string | number;
  parents: ColumnType<Array<string | number>, unknown, unknown>;
  seq_upto: ColumnType<string | number, string | number | undefined, string | number | undefined>;
  origin_push_id: string | null;
  actor_id: string;
  message: string | null;
  summary_json: unknown;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface IBaseVcsDatabase {
  base_vcs_head: IBaseVcsHeadTableRow;
  base_vcs_change: IBaseVcsChangeTableRow;
  base_vcs_commit: IBaseVcsCommitTableRow;
}

export interface ICompactChangesOptions {
  readonly maxAgeMs?: number;
  readonly maxRows?: number;
}

export interface ICompactChangesResult {
  readonly deletedCount: number;
  readonly minRetainedSeq: number;
  readonly minRetainedXid: string;
}

const CHANGE_INSERT_CHUNK_SIZE = 500;
// Each new view order column needs a heap backfill and index within the atomic push.
const MAX_ATOMIC_VIEW_ORDER_BACKFILL_CELLS = 1_000;
const DEFAULT_ENABLED_CACHE_TTL_MS = 30_000;
const DEFAULT_ENABLE_QUIESCE_TIMEOUT_MS = 15_000;
const DEFAULT_ENABLE_QUIESCE_POLL_MS = 15;
const DEFAULT_COMPACTION_INTERVAL_COMMITS = 50;
const DEFAULT_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_MAX_ROWS = 100_000;
const DIRECT_WRITE_ORIGIN_SENTINEL = '__direct_write__';

// Keep microsecond precision in PostgreSQL, including when the clock moves backwards.
const nextModificationFence = sql<Date>`GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')`;

function lockError(error: unknown, nowait: boolean): DomainError {
  if (nowait && pgErrorCode(error) === '55P03') {
    return domainError.infrastructure({
      code: TRANSACTION_RETRYABLE_CONTENTION_CODE,
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
  return vcsDomainError.infrastructure({
    code: 'vcs.lock_failed',
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

function notEnabled(baseId: string): DomainError {
  return vcsDomainError.conflict({
    code: 'vcs.not_enabled',
    message: 'Base VCS is not enabled on this base; enable VCS first.',
    details: { baseId },
  });
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toNumber = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIsoTimestamp = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return new Date().toISOString();
};

const toPgRegclassIdentifier = (rawTableName: string): string =>
  rawTableName
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');

const buildTableFilterSql = (
  tableIds?: readonly string[],
  columnRef: 'table_id' | 'c.table_id' = 'table_id'
): RawBuilder<unknown> => {
  if (!tableIds || tableIds.length === 0) {
    return sql``;
  }
  const col = columnRef === 'c.table_id' ? sql`c.table_id` : sql`table_id`;
  return sql`AND ${col} IN (${sql.join(tableIds)})`;
};

const toStoredChange = (
  baseId: string,
  row: {
    seq: string | number;
    tx_id: string;
    revision: string | number | null;
    origin_push_id: string | null;
    table_id: string;
    entity_type: VcsEntityType;
    entity_id: string;
    field_id: string | null;
    op_kind: VcsChangeOpKind;
    before_value: unknown;
    after_value: unknown;
    actor_id: string | null;
    created_at: unknown;
  }
): IVcsStoredChange => ({
  baseId,
  seq: toNumber(row.seq),
  txId: String(row.tx_id ?? '0'),
  revision: row.revision === null || row.revision === undefined ? null : toNumber(row.revision),
  originPushId: row.origin_push_id ?? null,
  tableId: row.table_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  fieldId: row.field_id ?? null,
  opKind: row.op_kind,
  beforeValue: row.before_value ?? null,
  afterValue: row.after_value ?? null,
  actorId: row.actor_id ?? null,
  createdAt: toIsoTimestamp(row.created_at),
});

const toCommitRecord = (row: {
  commit_id: string;
  base_id: string;
  revision: string | number;
  parent_revision: string | number;
  parents: Array<string | number>;
  seq_upto: string | number;
  origin_push_id: string | null;
  actor_id: string;
  message: string | null;
  summary_json: unknown;
  created_at: unknown;
}): IVcsCommit => ({
  commitId: row.commit_id,
  baseId: row.base_id,
  revision: toNumber(row.revision),
  parentRevision: toNumber(row.parent_revision),
  parents: Array.isArray(row.parents) ? row.parents.map(toNumber) : [],
  seqUpto: toNumber(row.seq_upto),
  originPushId: row.origin_push_id ?? null,
  actorId: row.actor_id,
  message: row.message ?? null,
  summary: row.summary_json as IBaseVcsPatchSummary,
  createdAt: toIsoTimestamp(row.created_at),
});

const collectOriginPushIds = (changes: readonly IVcsStoredChange[]): string[] => {
  const pushIds = new Set<string>();
  let hasDirectWrite = false;
  for (const c of changes) {
    if (c.originPushId) {
      pushIds.add(c.originPushId);
    } else {
      hasDirectWrite = true;
    }
  }
  const result = Array.from(pushIds);
  if (hasDirectWrite) {
    // Include a non-push marker so PullBaseVcsService never fast-forwards over mixed/direct edits.
    result.push(DIRECT_WRITE_ORIGIN_SENTINEL);
  }
  return result;
};

@injectable()
export class PostgresBaseVcsLogRepository implements IBaseVcsLogRepository {
  /** Positive-only cache (`enabled === true`). Negative `false` results are never cached. */
  private readonly enabledTrueCache = new Map<string, number>();

  constructor(
    @inject(v2DataDbTokens.db)
    private readonly dataDb: Kysely<IBaseVcsDatabase>,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: IUnitOfWork,
    @inject(v2MetaDbTokens.db)
    private readonly metaDb?: Kysely<unknown>,
    @inject(v2MetaDbTokens.config)
    private readonly metaConfig?: IV2PostgresDbConfig,
    @inject(v2DataDbTokens.config)
    private readonly dataConfig?: IV2PostgresDbConfig,
    @inject(v2VcsPostgresTokens.config)
    private readonly config?: IV2VcsPostgresAdapterConfig
  ) {}

  invalidateEnabledCache(baseId?: string): void {
    if (baseId) {
      this.enabledTrueCache.delete(baseId);
    } else {
      this.enabledTrueCache.clear();
    }
  }

  private isSplitDatabase(): boolean {
    if (this.metaDb && this.metaDb !== (this.dataDb as unknown)) {
      if (this.metaConfig && this.dataConfig) {
        return !(
          this.metaConfig.pg.connectionString === this.dataConfig.pg.connectionString &&
          this.metaConfig.pg.schema === this.dataConfig.pg.schema
        );
      }
      return true;
    }
    return false;
  }

  private getEnabledCacheTtlMs(): number {
    return this.config?.enabledCacheTtlMs ?? DEFAULT_ENABLED_CACHE_TTL_MS;
  }

  private getEnableQuiesceTimeoutMs(): number {
    return this.config?.enableQuiesceTimeoutMs ?? DEFAULT_ENABLE_QUIESCE_TIMEOUT_MS;
  }

  private getEnableQuiescePollMs(): number {
    return this.config?.enableQuiescePollIntervalMs ?? DEFAULT_ENABLE_QUIESCE_POLL_MS;
  }

  private cacheEnabledTrue(baseId: string): void {
    const ttl = this.getEnabledCacheTtlMs();
    if (ttl > 0) {
      this.enabledTrueCache.set(baseId, Date.now() + ttl);
    }
  }

  private markEnabledAfterCommit(ctx: IExecutionContext, baseId: string): void {
    const uowTx = ctx.transactions?.data as IUnitOfWorkTransaction | undefined;
    if (uowTx && typeof uowTx.afterCommit === 'function') {
      uowTx.afterCommit(() => {
        this.cacheEnabledTrue(baseId);
      });
      return;
    }
    this.cacheEnabledTrue(baseId);
  }

  private async resolveWritableDataTx<T>(
    ctx: IExecutionContext,
    work: (
      txCtx: IExecutionContext,
      trx: Transaction<IBaseVcsDatabase>
    ) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    const activeDataTrx = getPostgresTransaction(ctx, 'data') as
      | Transaction<IBaseVcsDatabase>
      | undefined;
    if (activeDataTrx) {
      return work(ctx, activeDataTrx);
    }
    return this.unitOfWork.withTransaction(
      ctx,
      async (txCtx) => {
        const trx = getPostgresTransaction(txCtx, 'data') as
          | Transaction<IBaseVcsDatabase>
          | undefined;
        if (!trx) {
          return err(
            vcsDomainError.invariant({
              code: 'vcs.transaction_required',
              message: 'Missing data UnitOfWork transaction',
            })
          );
        }
        return work(txCtx, trx);
      },
      { scope: 'data' }
    );
  }

  private async waitForEnableBarrier(barrierXid: string): Promise<Result<void, DomainError>> {
    let barrierBig: bigint;
    try {
      barrierBig = BigInt(barrierXid || '0');
    } catch {
      barrierBig = 0n;
    }
    if (barrierBig <= 0n) {
      return ok(undefined);
    }

    const deadline = Date.now() + this.getEnableQuiesceTimeoutMs();
    const pollMs = Math.max(5, this.getEnableQuiescePollMs());

    for (;;) {
      const checkRes = await sql<{ settled: boolean }>`
        SELECT (pg_snapshot_xmin(pg_current_snapshot()) >= (${barrierXid})::xid8) AS settled
      `.execute(this.dataDb);
      if (checkRes.rows[0]?.settled) {
        return ok(undefined);
      }
      if (Date.now() >= deadline) {
        return err(
          vcsDomainError.conflict({
            code: 'vcs.enable_quiesce_timeout',
            message: 'Timed out waiting for pre-enable transactions to settle before cloning.',
            details: { barrierXid },
          })
        );
      }
      await delay(pollMs);
    }
  }

  private async hasHeadTable(db: Kysely<IBaseVcsDatabase>, writing = false): Promise<boolean> {
    // Looking up a missing relation directly would abort the caller's transaction. Assign an
    // XID before a writer can observe tracking as disabled, including during schema migration.
    const schema = this.dataConfig?.pg.schema;
    const relation = schema
      ? sql`format('%I.base_vcs_head', ${schema}::text)`
      : sql`'base_vcs_head'`;
    const result = await sql<{ present: boolean }>`
      SELECT to_regclass(${relation}) IS NOT NULL AS present
      ${writing ? sql`, pg_current_xact_id()` : sql``}
    `.execute(db);
    return result.rows[0].present;
  }

  private get headTable() {
    const schema = this.dataConfig?.pg.schema;
    return schema ? sql.id(schema, 'base_vcs_head') : sql.id('base_vcs_head');
  }

  async getHead(
    ctx: IExecutionContext,
    baseId: BaseId,
    options?: { readonly requireAtomicStorage: true }
  ): Promise<Result<IVcsHeadState, DomainError>> {
    if (options?.requireAtomicStorage && this.isSplitDatabase()) {
      return err(
        vcsDomainError.invariant({
          code: 'batch.cross_database_not_atomic',
          message: 'Base VCS push requires meta and data tables in the same PostgreSQL database',
        })
      );
    }
    try {
      const db = resolvePostgresDbOrTx(this.dataDb, ctx, 'data');
      if (!(await this.hasHeadTable(db))) {
        return ok({ enabled: false, headRevision: 0, minRetainedSeq: 0, minRetainedXid: '0' });
      }
      const row = await sql<{
        enabled: boolean;
        head_revision: string | number;
        modification_fence: string;
        min_retained_seq: string | number;
        min_retained_xid: string;
      }>`
        SELECT enabled, head_revision, min_retained_seq, min_retained_xid::text AS min_retained_xid,
          extract(epoch FROM updated_at)::text AS modification_fence
        FROM ${this.headTable}
        WHERE base_id = ${baseId.toString()}
        LIMIT 1
      `.execute(db);

      const head = row.rows[0];
      if (!head) {
        return ok({
          enabled: false,
          headRevision: 0,
          minRetainedSeq: 0,
          minRetainedXid: '0',
        });
      }

      return ok({
        enabled: Boolean(head.enabled),
        headRevision: toNumber(head.head_revision),
        modificationFence: head.modification_fence,
        minRetainedSeq: toNumber(head.min_retained_seq),
        minRetainedXid: String(head.min_retained_xid ?? '0'),
      });
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.head_query_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  async isEnabled(
    ctx: IExecutionContext,
    baseId: BaseId,
    options?: { readonly includePendingEnable: true }
  ): Promise<Result<boolean, DomainError>> {
    const baseKey = baseId.toString();
    const cachedExpiresAt = this.enabledTrueCache.get(baseKey);
    if (cachedExpiresAt !== undefined) {
      if (Date.now() < cachedExpiresAt) {
        return ok(true);
      }
      this.enabledTrueCache.delete(baseKey);
    }

    try {
      const activeTrx = getPostgresTransaction(ctx, 'data') as
        | Transaction<IBaseVcsDatabase>
        | undefined;
      const db = activeTrx ?? this.dataDb;
      if (!(await this.hasHeadTable(db, Boolean(activeTrx)))) {
        return ok(false);
      }
      const rowRes = await sql<{ enabled: boolean; enrolling: boolean }>`
        SELECT enabled, enabled_barrier_xid > '0'::xid8 AS enrolling
        FROM ${this.headTable} WHERE base_id = ${baseKey} LIMIT 1
      `.execute(db);
      const enabled = Boolean(rowRes.rows[0]?.enabled);
      if (enabled) {
        this.markEnabledAfterCommit(ctx, baseKey);
      }
      return ok(enabled || Boolean(options?.includePendingEnable && rowRes.rows[0]?.enrolling));
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.enabled_check_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  private async publishEnabledHead(
    ctx: IExecutionContext,
    baseId: BaseId,
    barrierXid: string,
    capture: VcsCheckpointCapture
  ): Promise<Result<IVcsEnableResult, DomainError>> {
    const baseKey = baseId.toString();
    return this.unitOfWork.withTransaction(
      ctx,
      async (txCtx) => {
        const trx = getPostgresTransaction(txCtx, 'data') as
          | Transaction<IBaseVcsDatabase>
          | undefined;
        if (!trx) {
          return err(
            vcsDomainError.invariant({
              code: 'vcs.transaction_required',
              message: 'Missing data UnitOfWork transaction',
            })
          );
        }

        // Only the first enabler publishes revision zero. A concurrent enabler either
        // sees the published head or retries on PostgreSQL's serialization failure.
        const head = await trx
          .selectFrom('base_vcs_head')
          .select(['enabled', 'head_revision'])
          .where('base_id', '=', baseKey)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const revision = toNumber(head.head_revision);
        if (head.enabled) return ok({ enabledAtRevision: revision });

        if (revision === 0) {
          const checkpoint = await captureCheckpoint(trx, txCtx, baseId, revision, capture);
          if (checkpoint.isErr()) return err(checkpoint.error);
        }
        await trx
          .updateTable('base_vcs_head')
          .set({
            enabled: true,
            enabled_barrier_xid: sql`${barrierXid}::xid8`,
            updated_at: nextModificationFence,
          })
          .where('base_id', '=', baseKey)
          .executeTakeFirstOrThrow();
        return ok({ enabledAtRevision: revision });
      },
      { scope: 'data', isolationLevel: 'repeatable read' }
    );
  }

  async enable(
    ctx: IExecutionContext,
    baseId: BaseId,
    capture: VcsCheckpointCapture
  ): Promise<Result<IVcsEnableResult, DomainError>> {
    if (this.isSplitDatabase()) {
      return err(
        vcsDomainError.invariant({
          code: 'batch.cross_database_not_atomic',
          message: 'Base VCS cannot be enabled across split Meta/Data physical databases',
        })
      );
    }

    if (getPostgresTransaction(ctx, 'data')) {
      return err(
        vcsDomainError.invariant({
          code: 'vcs.enable_requires_autocommit',
          message:
            'enable() must enroll writers in autocommit mode before waiting for pre-enable transactions',
        })
      );
    }

    const baseKey = baseId.toString();
    try {
      // Enroll writers before taking the snapshot. A positive barrier on a disabled
      // head means change tracking has started, but pushes cannot advance the head yet.
      // The marker survives timeouts and is resumed by the next enable request.
      await sql`
        INSERT INTO ${this.headTable} AS h (base_id, enabled, enabled_barrier_xid)
        VALUES (${baseKey}, false, pg_current_xact_id())
        ON CONFLICT (base_id) DO UPDATE SET enabled_barrier_xid = EXCLUDED.enabled_barrier_xid
        WHERE NOT h.enabled AND h.enabled_barrier_xid = '0'::xid8
      `.execute(this.dataDb);
      const {
        rows: [head],
      } = await sql<{
        enabled: boolean;
        revision: string;
        barrier: string;
      }>`
        SELECT enabled, head_revision::text AS revision,
          CASE WHEN enabled THEN enabled_barrier_xid ELSE pg_snapshot_xmax(pg_current_snapshot()) END::text AS barrier
        FROM ${this.headTable} WHERE base_id = ${baseKey}
      `.execute(this.dataDb);

      const barrierRes = await this.waitForEnableBarrier(head.barrier);
      if (barrierRes.isErr()) {
        return err(barrierRes.error);
      }

      const result = head.enabled
        ? ok({ enabledAtRevision: toNumber(head.revision) })
        : await this.publishEnabledHead(ctx, baseId, head.barrier, capture);
      if (result.isOk()) this.cacheEnabledTrue(baseKey);
      return result;
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.enable_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  private readHistory<T>(
    ctx: IExecutionContext,
    read: (db: Kysely<IBaseVcsDatabase>) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    // The UoW installs the configured schema's search path for checkpoint SQL.
    return this.resolveWritableDataTx(ctx, async (_txCtx, trx) => {
      try {
        return await read(trx);
      } catch (error) {
        return err(
          vcsDomainError.infrastructure({
            code: 'vcs.checkpoint_read_failed',
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          })
        );
      }
    });
  }

  async readHistoricalSnapshot(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    return this.readHistory(ctx, (db) => readSnapshot(db, baseId.toString(), revision));
  }

  async readHistoricalSelection(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number,
    selectRecords?: SelectHistoricalCheckpointRecords
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    return this.readHistory(ctx, (db) =>
      readHistoricalSelection(db, baseId.toString(), revision, selectRecords)
    );
  }

  async readHistoricalTableIds(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number
  ): Promise<Result<readonly string[], DomainError>> {
    return this.readHistory(ctx, (db) => readCheckpointTableIds(db, baseId.toString(), revision));
  }

  async compareHistoricalRevisions(
    ctx: IExecutionContext,
    baseId: BaseId,
    from: number,
    to: number
  ): Promise<Result<IVcsRevisionComparison, DomainError>> {
    return this.readHistory(ctx, (db) => compareRevisions(db, baseId.toString(), from, to));
  }

  async appendChanges(
    ctx: IExecutionContext,
    baseId: BaseId,
    changes: readonly IVcsChangeRowInput[],
    options?: { readonly originPushId?: string; readonly bumpHeadRevision?: boolean }
  ): Promise<Result<void, DomainError>> {
    if (changes.length === 0) {
      return ok(undefined);
    }

    if (this.isSplitDatabase() && getPostgresTransaction(ctx, 'meta')) {
      return err(
        vcsDomainError.invariant({
          code: 'batch.cross_database_not_atomic',
          message:
            'Cannot write base VCS change log atomically alongside a meta transaction in split DB mode',
        })
      );
    }

    const trx = getPostgresTransaction(ctx, 'data') as Transaction<IBaseVcsDatabase> | undefined;
    if (!trx) {
      if (ctx.batchTransaction) {
        return this.unitOfWork.withTransaction(
          ctx,
          async (innerCtx) => {
            const innerTrx = getPostgresTransaction(innerCtx, 'data') as
              | Transaction<IBaseVcsDatabase>
              | undefined;
            if (!innerTrx) {
              return err(
                vcsDomainError.invariant({
                  code: 'vcs.transaction_required',
                  message: 'appendChanges requires an active data UnitOfWork transaction',
                })
              );
            }
            return this.insertChangeRows(innerTrx, baseId.toString(), changes, options);
          },
          { scope: 'data' }
        );
      }

      if (getPostgresTransaction(ctx, 'meta')) {
        return err(
          vcsDomainError.invariant({
            code: 'batch.cross_database_not_atomic',
            message:
              'Cannot write base VCS change log atomically from a meta-only transaction in split DB mode',
          })
        );
      }

      return err(
        vcsDomainError.invariant({
          code: 'vcs.transaction_required',
          message: 'appendChanges requires an active data UnitOfWork transaction',
        })
      );
    }

    return this.insertChangeRows(trx, baseId.toString(), changes, options);
  }

  private async insertChangeRows(
    trx: Transaction<IBaseVcsDatabase>,
    baseId: string,
    changes: readonly IVcsChangeRowInput[],
    options?: { readonly originPushId?: string; readonly bumpHeadRevision?: boolean }
  ): Promise<Result<void, DomainError>> {
    const storePayloads = this.config?.storeChangePayloads === true;
    try {
      // FOR UPDATE alone does not invalidate an older SERIALIZABLE snapshot.
      // Publish a new head tuple in the same transaction as the business write.
      await sql`UPDATE ${this.headTable} SET updated_at = ${nextModificationFence}
        WHERE base_id = ${baseId} AND (enabled OR enabled_barrier_xid > '0'::xid8)`.execute(trx);
      for (let i = 0; i < changes.length; i += CHANGE_INSERT_CHUNK_SIZE) {
        const batch = changes.slice(i, i + CHANGE_INSERT_CHUNK_SIZE);
        await trx
          .insertInto('base_vcs_change')
          .values(
            batch.map((item) => ({
              base_id: baseId,
              revision: null,
              origin_push_id: options?.originPushId ?? null,
              table_id: item.tableId,
              entity_type: item.entityType,
              entity_id: item.entityId,
              field_id: item.fieldId ?? null,
              op_kind: item.opKind,
              before_value:
                storePayloads && item.beforeValue !== undefined
                  ? JSON.stringify(item.beforeValue)
                  : null,
              after_value:
                storePayloads && item.afterValue !== undefined
                  ? JSON.stringify(item.afterValue)
                  : null,
              actor_id: item.actorId ?? null,
            }))
          )
          .execute();
      }
      return ok(undefined);
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.change_log_write_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  async capturePullCursor(
    ctx: IExecutionContext,
    baseId: BaseId,
    options?: { readonly tableIds?: readonly string[] }
  ): Promise<Result<IVcsPullCursor, DomainError>> {
    const baseKey = baseId.toString();
    const scopeTag = computeVcsTableScopeTag(options?.tableIds);
    const tableFilterSql = buildTableFilterSql(options?.tableIds);

    try {
      if (!getPostgresTransaction(ctx, 'data')) {
        const barrierRow = await sql<{ barrier_xid: string }>`
          SELECT enabled_barrier_xid::text AS barrier_xid
          FROM base_vcs_head
          WHERE base_id = ${baseKey}
          LIMIT 1
        `.execute(this.dataDb);
        const barrierRes = await this.waitForEnableBarrier(
          String(barrierRow.rows[0]?.barrier_xid ?? '0')
        );
        if (barrierRes.isErr()) {
          return err(barrierRes.error);
        }
      }

      const db = resolvePostgresDbOrTx(this.dataDb, ctx, 'data');
      const res = await sql<{
        snapshot_text: string;
        xmin_text: string;
        max_seq: string;
      }>`
        WITH snap AS (SELECT pg_current_snapshot() AS s)
        SELECT
          s::text AS snapshot_text,
          pg_snapshot_xmin(s)::text AS xmin_text,
          COALESCE((SELECT MAX(seq) FROM base_vcs_change WHERE base_id = ${baseKey} ${tableFilterSql}), 0)::text AS max_seq
        FROM snap
      `.execute(db);

      const row = res.rows[0];
      const snapshotText = String(row?.snapshot_text ?? '0:0:');
      const xminText = String(row?.xmin_text ?? '0');
      return ok({
        v: 2,
        scopeTag,
        maxSeq: toNumber(row?.max_seq),
        xmin: xminText,
        snapshot: snapshotText,
      });
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.cursor_capture_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  private async queryChangesPage(params: {
    readonly ctx: IExecutionContext;
    readonly baseKey: string;
    readonly cursor: IVcsPullCursor;
    readonly scopeTag: string;
    readonly safeLimit: number;
    readonly headRevision: number;
    readonly tableIds?: readonly string[];
  }): Promise<Result<IVcsChangePage, DomainError>> {
    const { ctx, baseKey, cursor, scopeTag, safeLimit, headRevision, tableIds } = params;
    const db = resolvePostgresDbOrTx(this.dataDb, ctx, 'data');
    const tableFilterSql = buildTableFilterSql(tableIds, 'table_id');
    const cTableFilterSql = buildTableFilterSql(tableIds, 'c.table_id');
    const pageTarget = cursor.page?.targetSnapshot;
    const afterSeq = cursor.page?.afterSeq ?? 0;
    const payloadSelectSql =
      this.config?.storeChangePayloads === true
        ? sql`before_value, after_value,`
        : sql`NULL::jsonb AS before_value, NULL::jsonb AS after_value,`;
    const pageVisibilitySql = pageTarget
      ? sql`AND seq > ${afterSeq} AND pg_visible_in_snapshot(tx_id, (${pageTarget})::pg_snapshot)`
      : sql`AND pg_visible_in_snapshot(tx_id, snap.s)`;
    const dbMaxSeqFilterSql = pageTarget
      ? sql`AND pg_visible_in_snapshot(c.tx_id, (${pageTarget})::pg_snapshot)`
      : sql``;

    const queryRes = await sql<{
      rows_json: Array<{
        seq: string | number;
        tx_id: string;
        revision: string | number | null;
        origin_push_id: string | null;
        table_id: string;
        entity_type: VcsEntityType;
        entity_id: string;
        field_id: string | null;
        op_kind: VcsChangeOpKind;
        before_value: unknown;
        after_value: unknown;
        actor_id: string | null;
        created_at: unknown;
      }>;
      target_snapshot: string;
      target_xmin: string;
      db_max_seq: string;
    }>`
      WITH snap AS (SELECT pg_current_snapshot() AS s),
      matched AS (
        SELECT
          seq,
          tx_id::text AS tx_id,
          revision,
          origin_push_id,
          table_id,
          entity_type,
          entity_id,
          field_id,
          op_kind,
          ${payloadSelectSql}
          actor_id,
          created_at
        FROM base_vcs_change, snap
        WHERE base_id = ${baseKey}
          ${tableFilterSql}
          AND tx_id >= (${cursor.xmin})::xid8
          AND NOT pg_visible_in_snapshot(tx_id, (${cursor.snapshot})::pg_snapshot)
          ${pageVisibilitySql}
        ORDER BY seq ASC
        LIMIT ${safeLimit + 1}
      ),
      meta AS (
        SELECT
          ${pageTarget ? sql`${pageTarget}::text` : sql`s::text`} AS target_snapshot,
          ${
            pageTarget
              ? sql`pg_snapshot_xmin((${pageTarget})::pg_snapshot)::text`
              : sql`pg_snapshot_xmin(s)::text`
          } AS target_xmin,
          COALESCE(
            (SELECT MAX(c.seq) FROM base_vcs_change c WHERE c.base_id = ${baseKey} ${cTableFilterSql} ${dbMaxSeqFilterSql}),
            0
          )::text AS db_max_seq
        FROM snap
      )
      SELECT
        (SELECT COALESCE(json_agg(row_to_json(matched) ORDER BY matched.seq ASC), '[]'::json) FROM matched) AS rows_json,
        meta.target_snapshot,
        meta.target_xmin,
        meta.db_max_seq
      FROM meta
    `.execute(db);

    const resultRow = queryRes.rows[0];
    const rawRows = Array.isArray(resultRow?.rows_json) ? resultRow.rows_json : [];
    const hasMore = rawRows.length > safeLimit;
    const trimmedRows = hasMore ? rawRows.slice(0, safeLimit) : rawRows;
    const changes = trimmedRows.map((row) => toStoredChange(baseKey, row));
    const maxMatchedSeq = changes.reduce((acc, item) => Math.max(acc, item.seq), 0);
    const targetSnapshot = String(resultRow?.target_snapshot ?? cursor.snapshot);
    const targetXmin = String(resultRow?.target_xmin ?? cursor.xmin);
    const dbMaxSeq = toNumber(resultRow?.db_max_seq);

    const nextCursor: IVcsPullCursor = hasMore
      ? {
          v: 2,
          scopeTag,
          maxSeq: cursor.maxSeq,
          xmin: cursor.xmin,
          snapshot: cursor.snapshot,
          page: {
            targetSnapshot,
            afterSeq: maxMatchedSeq,
          },
        }
      : {
          v: 2,
          scopeTag,
          maxSeq: Math.max(cursor.maxSeq, dbMaxSeq, maxMatchedSeq),
          xmin: targetXmin,
          snapshot: targetSnapshot,
        };

    return ok({
      cursor: nextCursor,
      encodedCursor: encodeVcsPullCursor(nextCursor),
      headRevision,
      originPushIds: collectOriginPushIds(changes),
      requiresFullSync: false,
      hasMore,
      changes,
    });
  }

  async listChangesSince(
    ctx: IExecutionContext,
    baseId: BaseId,
    cursor: IVcsPullCursor,
    limit: number,
    options?: { readonly tableIds?: readonly string[] }
  ): Promise<Result<IVcsChangePage, DomainError>> {
    const headRes = await this.getHead(ctx, baseId);
    if (headRes.isErr()) {
      return err(headRes.error);
    }
    const headState = headRes.value;
    const scopeTag = computeVcsTableScopeTag(options?.tableIds);

    const requiresFullSyncReason =
      cursor.scopeTag !== scopeTag ||
      !isValidPgSnapshotText(cursor.snapshot) ||
      isCursorBeforeRetention(cursor, headState.minRetainedSeq, headState.minRetainedXid);
    if (requiresFullSyncReason) {
      const freshCursorRes = await this.capturePullCursor(ctx, baseId, options);
      if (freshCursorRes.isErr()) {
        return err(freshCursorRes.error);
      }
      return ok({
        cursor: freshCursorRes.value,
        encodedCursor: encodeVcsPullCursor(freshCursorRes.value),
        headRevision: headState.headRevision,
        originPushIds: [],
        requiresFullSync: true,
        hasMore: false,
        changes: [],
      });
    }

    const baseKey = baseId.toString();
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 10_000));
    try {
      return await this.queryChangesPage({
        ctx,
        baseKey,
        cursor,
        scopeTag,
        safeLimit,
        headRevision: headState.headRevision,
        tableIds: options?.tableIds,
      });
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.changes_query_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  private async lockPhysicalTableRowsIfExists(
    dataTrx: Transaction<IBaseVcsDatabase>,
    target: IVcsPushPhysicalTableLockTarget,
    wait: boolean
  ): Promise<Result<void, DomainError>> {
    if (target.recordIds !== undefined && target.recordIds.length === 0) {
      return ok(undefined);
    }

    const reg = await sql<{ exists: boolean }>`
      SELECT (to_regclass(${toPgRegclassIdentifier(target.dbTableName)}) IS NOT NULL) AS exists
    `.execute(dataTrx);
    if (!reg.rows[0]?.exists) {
      return ok(undefined);
    }

    if (target.newViewOrderColumnCount !== undefined) {
      const relation = sql.table(target.dbTableName);
      const maxRows = Math.floor(
        MAX_ATOMIC_VIEW_ORDER_BACKFILL_CELLS / target.newViewOrderColumnCount
      );
      try {
        // Fence concurrent writes before checking the budget. Normal SELECTs can
        // run during admission, including when the target exceeds the limit.
        await sql`LOCK TABLE ${relation} IN SHARE ROW EXCLUSIVE MODE NOWAIT`.execute(dataTrx);
        const { rows } = await sql<{ too_large: boolean }>`
          SELECT EXISTS (SELECT 1 FROM ${relation} OFFSET ${maxRows}) AS too_large
        `.execute(dataTrx);
        if (rows[0]?.too_large) {
          return err(
            vcsDomainError.validation({
              code: 'vcs.new_view_order_backfill_too_large',
              message:
                'Create the view without record order changes, then push those changes separately.',
              details: { maxRows, viewCount: target.newViewOrderColumnCount },
            })
          );
        }
        // An eligible push may retry behind a reader, but must never queue
        // ACCESS EXCLUSIVE and thereby block readers which arrive later.
        await sql`LOCK TABLE ${relation} IN ACCESS EXCLUSIVE MODE NOWAIT`.execute(dataTrx);
        return ok(undefined);
      } catch (error) {
        return err(lockError(error, true));
      }
    }

    const waitClause = wait ? sql`` : sql`NOWAIT`;
    const keyCol = target.keyColumn ?? '__id';
    if (target.recordIds !== undefined) {
      try {
        await sql`LOCK TABLE ${sql.table(target.dbTableName)} IN ROW EXCLUSIVE MODE NOWAIT`.execute(
          dataTrx
        );
      } catch (error) {
        return err(lockError(error, true));
      }
      const sortedIds = Array.from(new Set<string>(target.recordIds)).sort((a, b) =>
        a.localeCompare(b)
      );
      try {
        await sql`
          SELECT 1 FROM ${sql.table(target.dbTableName)}
          WHERE ${sql.ref(keyCol)} IN (${sql.join(sortedIds)})
          ORDER BY ${sql.ref(keyCol)} ASC
          FOR UPDATE ${waitClause}
        `.execute(dataTrx);
        return ok(undefined);
      } catch (error) {
        return err(lockError(error, !wait));
      }
    }

    // Whole-table targets fence concurrent inserts without scanning all rows.
    try {
      await sql`
        LOCK TABLE ${sql.table(target.dbTableName)} IN SHARE ROW EXCLUSIVE MODE ${waitClause}
      `.execute(dataTrx);
      return ok(undefined);
    } catch (error) {
      return err(lockError(error, !wait));
    }
  }

  private async lockMetaTargets(
    metaExecutor: Transaction<unknown>,
    baseKey: string,
    targets: IVcsPushMetadataLockTargets
  ): Promise<void> {
    const schema = this.metaConfig?.pg.schema;
    const metadata = (name: string) => (schema ? sql.id(schema, name) : sql.id(name));
    const tables = metadata('table_meta');
    const fields = metadata('field');
    const views = metadata('view');
    // A row-locking SELECT's NOWAIT does not apply to the underlying relation lock.
    await sql`LOCK TABLE ${tables}, ${fields}, ${views} IN ROW EXCLUSIVE MODE NOWAIT`.execute(
      metaExecutor
    );
    const explicitTableIds = new Set(targets.tableIds);
    const tableFilterSql = explicitTableIds.size
      ? sql`OR id IN (${sql.join([...explicitTableIds])})`
      : sql``;
    const lockedTableRows = await sql<{ id: string; deleted: boolean }>`
      SELECT id, deleted_time IS NOT NULL AS deleted FROM ${tables}
      WHERE base_id = ${baseKey} AND (deleted_time IS NULL ${tableFilterSql})
      ORDER BY id ASC
      FOR UPDATE NOWAIT
    `.execute(metaExecutor);

    const lockedTableIds = lockedTableRows.rows.map((row) => row.id);
    if (!lockedTableIds.length) return;
    const lockedTables = sql.join(lockedTableIds);
    const retainedTables = lockedTableRows.rows.filter((row) => row.deleted).map((row) => row.id);
    const retained = retainedTables.length
      ? sql`OR table_id IN (${sql.join(retainedTables)})`
      : sql``;
    const explicitFields = targets.fieldIds.length
      ? sql`OR id IN (${sql.join([...new Set(targets.fieldIds)])})`
      : sql``;
    await sql`
      SELECT id FROM ${fields}
      WHERE table_id IN (${lockedTables}) AND (deleted_time IS NULL ${retained} ${explicitFields})
      ORDER BY id ASC
      FOR UPDATE NOWAIT
    `.execute(metaExecutor);

    const explicitViews = targets.viewIds.length
      ? sql`OR id IN (${sql.join([...new Set(targets.viewIds)])})`
      : sql``;
    await sql`
      SELECT id FROM ${views}
      WHERE table_id IN (${lockedTables}) AND (deleted_time IS NULL ${retained} ${explicitViews})
      ORDER BY id ASC
      FOR UPDATE NOWAIT
    `.execute(metaExecutor);
  }

  async lockPushMetadata(
    ctx: IExecutionContext,
    baseId: BaseId,
    targets: IVcsPushMetadataLockTargets
  ): Promise<Result<IVcsHeadState, DomainError>> {
    if (this.isSplitDatabase()) {
      return err(
        vcsDomainError.invariant({
          code: 'batch.cross_database_not_atomic',
          message: 'Base VCS push requires meta and data tables in the same PostgreSQL database',
        })
      );
    }

    const dataTrx = getPostgresTransaction(ctx, 'data') as
      | Transaction<IBaseVcsDatabase>
      | undefined;
    if (!dataTrx) {
      return err(
        vcsDomainError.invariant({
          code: 'vcs.transaction_required',
          message: 'lockPushMetadata requires an active data UnitOfWork transaction',
        })
      );
    }

    const baseKey = baseId.toString();
    try {
      if (!(await this.hasHeadTable(dataTrx))) {
        return err(notEnabled(baseKey));
      }
      const metaExecutor =
        (getPostgresTransaction(ctx, 'meta') as Transaction<unknown> | undefined) ??
        (dataTrx as unknown as Transaction<unknown>);
      // Direct writes lock records first, touch table_meta, then publish their VCS fence.
      // A multi-command transaction can already hold the head while writing another table.
      // A push follows the usual order and never queues on this potentially reversed edge.
      await this.lockMetaTargets(metaExecutor, baseKey, targets);
      await sql`LOCK TABLE ${this.headTable} IN ROW EXCLUSIVE MODE NOWAIT`.execute(dataTrx);
      const lockedHead = await sql<{
        enabled: boolean;
        head_revision: string | number;
        modification_fence: string;
        min_retained_seq: string | number;
        min_retained_xid: string;
      }>`
        SELECT enabled, head_revision, min_retained_seq, min_retained_xid::text AS min_retained_xid,
          extract(epoch FROM updated_at)::text AS modification_fence
        FROM ${this.headTable}
        WHERE base_id = ${baseKey}
        FOR UPDATE NOWAIT
      `.execute(dataTrx);

      const head = lockedHead.rows[0];
      if (!head || !head.enabled) {
        return err(notEnabled(baseKey));
      }

      this.markEnabledAfterCommit(ctx, baseKey);

      return ok({
        enabled: true,
        headRevision: toNumber(head.head_revision),
        modificationFence: head.modification_fence,
        minRetainedSeq: toNumber(head.min_retained_seq),
        minRetainedXid: String(head.min_retained_xid ?? '0'),
      });
    } catch (error) {
      return err(lockError(error, true));
    }
  }

  async lockPushPhysicalTargets(
    ctx: IExecutionContext,
    _baseId: BaseId,
    physicalTargets: readonly IVcsPushPhysicalTableLockTarget[],
    options?: { readonly waitForFirstTarget: boolean }
  ): Promise<Result<void, DomainError>> {
    const dataTrx = getPostgresTransaction(ctx, 'data') as
      | Transaction<IBaseVcsDatabase>
      | undefined;
    if (!dataTrx) {
      return err(
        vcsDomainError.invariant({
          code: 'vcs.transaction_required',
          message: 'lockPushPhysicalTargets requires an active data UnitOfWork transaction',
        })
      );
    }

    try {
      const sorted = [...physicalTargets].sort((a, b) =>
        a.dbTableName.localeCompare(b.dbTableName)
      );
      for (const [index, target] of sorted.entries()) {
        // Only the first single lock in a new transaction may queue. A link-key predicate
        // can lock many rows even when it has just one ID.
        const wait =
          options?.waitForFirstTarget === true &&
          index === 0 &&
          (target.recordIds === undefined ||
            (target.recordIds.length === 1 && target.keyColumn === undefined));
        const locked = await this.lockPhysicalTableRowsIfExists(dataTrx, target, wait);
        if (locked.isErr()) return locked;
      }
      return ok(undefined);
    } catch (error) {
      return err(lockError(error, false));
    }
  }

  async findCommitByOriginPushId(
    ctx: IExecutionContext,
    baseId: BaseId,
    originPushId: string
  ): Promise<Result<IVcsCommit | null, DomainError>> {
    try {
      const db = resolvePostgresDbOrTx(this.dataDb, ctx, 'data');
      const res = await db
        .selectFrom('base_vcs_commit')
        .selectAll()
        .where('base_id', '=', baseId.toString())
        .where('origin_push_id', '=', originPushId)
        .limit(1)
        .executeTakeFirst();

      if (!res) {
        return ok(null);
      }
      return ok(toCommitRecord(res));
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.commit_lookup_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  private async maybeCompactAfterCommit(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number
  ): Promise<Result<void, DomainError>> {
    const interval = this.config?.compactionIntervalCommits ?? DEFAULT_COMPACTION_INTERVAL_COMMITS;
    if (interval <= 0 || revision <= 0 || revision % interval !== 0) {
      return ok(undefined);
    }
    const compactRes = await this.compactChanges(ctx, baseId);
    if (compactRes.isErr()) {
      return err(compactRes.error);
    }
    return ok(undefined);
  }

  async appendCommit(
    ctx: IExecutionContext,
    baseId: BaseId,
    commit: IVcsCommitInput,
    capture: VcsCheckpointCapture
  ): Promise<Result<IVcsCommit, DomainError>> {
    const trx = getPostgresTransaction(ctx, 'data') as Transaction<IBaseVcsDatabase> | undefined;
    if (!trx) {
      return err(
        vcsDomainError.invariant({
          code: 'vcs.transaction_required',
          message: 'appendCommit requires an active data UnitOfWork transaction',
        })
      );
    }

    const baseKey = baseId.toString();
    const commitId = commit.commitId ?? `vcsc_${randomUUID().replace(/-/g, '')}`;

    try {
      const updatedHead = await trx
        .updateTable('base_vcs_head')
        .set({
          head_revision: sql`base_vcs_head.head_revision + 1`,
          updated_at: nextModificationFence,
        })
        .where('base_id', '=', baseKey)
        .where('enabled', '=', true)
        .where('head_revision', '=', commit.expectedHeadRevision)
        .returning(['head_revision'])
        .executeTakeFirst();

      if (!updatedHead) {
        const latestHead = await trx
          .selectFrom('base_vcs_head')
          .select(['head_revision'])
          .where('base_id', '=', baseKey)
          .executeTakeFirst();
        return err(
          vcsDomainError.conflict({
            code: 'vcs.cas_conflict',
            message: `Head revision moved from ${commit.expectedHeadRevision} to ${toNumber(latestHead?.head_revision)}`,
            details: {
              expectedHeadRevision: commit.expectedHeadRevision,
              actualHeadRevision: toNumber(latestHead?.head_revision),
            },
          })
        );
      }

      const newRevision = toNumber(updatedHead.head_revision);
      const checkpoint = await captureCheckpoint(trx, ctx, baseId, newRevision, capture);
      if (checkpoint.isErr()) return err(checkpoint.error);

      const tagged = await sql<{ seq: string | number }>`
        UPDATE base_vcs_change
        SET revision = ${newRevision}, origin_push_id = ${commit.originPushId}
        WHERE base_id = ${baseKey}
          AND tx_id = pg_current_xact_id()
        RETURNING seq
      `.execute(trx);

      const seqUpto = tagged.rows.reduce((acc, row) => Math.max(acc, toNumber(row.seq)), 0);
      const resolvedSeqUpto =
        seqUpto > 0
          ? seqUpto
          : toNumber(
              (
                await sql<{ max_seq: string | number }>`
                  SELECT COALESCE(MAX(seq), 0) AS max_seq
                  FROM base_vcs_change
                  WHERE base_id = ${baseKey}
                `.execute(trx)
              ).rows[0]?.max_seq
            );

      const parents = commit.parents?.length ? [...commit.parents] : [commit.expectedHeadRevision];
      const inserted = await trx
        .insertInto('base_vcs_commit')
        .values({
          commit_id: commitId,
          base_id: baseKey,
          revision: newRevision,
          parent_revision: commit.expectedHeadRevision,
          parents: sql`ARRAY[${sql.join(parents.map((p) => sql`${p}::bigint`))}]::bigint[]`,
          seq_upto: resolvedSeqUpto,
          origin_push_id: commit.originPushId,
          actor_id: commit.actorId,
          message: commit.message ?? null,
          summary_json: sql`${JSON.stringify(commit.summary)}::jsonb`,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const compactRes = await this.maybeCompactAfterCommit(ctx, baseId, newRevision);
      if (compactRes.isErr()) {
        return err(compactRes.error);
      }

      return ok(toCommitRecord(inserted));
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.commit_write_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  private async resolveCompactionCutoffSeq(
    trx: Transaction<IBaseVcsDatabase>,
    baseKey: string,
    maxRows: number,
    maxAgeMs: number
  ): Promise<number> {
    const countRes = await sql<{ count: string }>`
      SELECT COUNT(*)::text AS count
      FROM base_vcs_change
      WHERE base_id = ${baseKey}
    `.execute(trx);
    const totalRows = toNumber(countRes.rows[0]?.count);

    let minKeepSeq = 0;
    if (totalRows > maxRows) {
      const offsetRes = await sql<{ seq: string }>`
        SELECT seq::text AS seq
        FROM base_vcs_change
        WHERE base_id = ${baseKey}
        ORDER BY seq DESC
        LIMIT 1 OFFSET ${Math.max(0, maxRows - 1)}
      `.execute(trx);
      minKeepSeq = Math.max(minKeepSeq, toNumber(offsetRes.rows[0]?.seq));
    }

    const cutoffIso = new Date(Date.now() - Math.max(0, maxAgeMs)).toISOString();
    const ageKeepRes = await sql<{ seq: string | null }>`
      SELECT MIN(seq)::text AS seq
      FROM base_vcs_change
      WHERE base_id = ${baseKey}
        AND created_at >= ${cutoffIso}::timestamptz
    `.execute(trx);
    if (ageKeepRes.rows[0]?.seq) {
      minKeepSeq = Math.max(minKeepSeq, toNumber(ageKeepRes.rows[0].seq));
    }

    if (minKeepSeq === 0 && maxAgeMs === 0) {
      const newest = await sql<{ seq: string | null }>`
        SELECT MAX(seq)::text AS seq
        FROM base_vcs_change
        WHERE base_id = ${baseKey}
      `.execute(trx);
      minKeepSeq = toNumber(newest.rows[0]?.seq);
    }

    return minKeepSeq;
  }

  async compactChanges(
    ctx: IExecutionContext,
    baseId: BaseId,
    options?: ICompactChangesOptions
  ): Promise<Result<ICompactChangesResult, DomainError>> {
    const maxAgeMs = options?.maxAgeMs ?? DEFAULT_RETENTION_MAX_AGE_MS;
    const maxRows = options?.maxRows ?? DEFAULT_RETENTION_MAX_ROWS;
    const baseKey = baseId.toString();

    try {
      return await this.resolveWritableDataTx(ctx, async (txCtx, trx) => {
        const minKeepSeq = await this.resolveCompactionCutoffSeq(trx, baseKey, maxRows, maxAgeMs);
        if (minKeepSeq <= 1) {
          const headRes = await this.getHead(txCtx, baseId);
          return headRes.map((h) => ({
            deletedCount: 0,
            minRetainedSeq: h.minRetainedSeq,
            minRetainedXid: h.minRetainedXid,
          }));
        }

        // Commit-time and standalone compaction take the head before changing stream rows.
        await sql`SELECT 1 FROM ${this.headTable} WHERE base_id = ${baseKey} FOR UPDATE`.execute(
          trx
        );
        const deleted = await sql<{ seq: string; tx_id: string }>`
          DELETE FROM base_vcs_change
          WHERE base_id = ${baseKey}
            AND seq < ${minKeepSeq}
            AND tx_id < pg_snapshot_xmin(pg_current_snapshot())
          RETURNING seq::text AS seq, tx_id::text AS tx_id
        `.execute(trx);

        let maxDeletedSeq = 0;
        let maxDeletedXid = 0n;
        for (const row of deleted.rows) {
          const seqNum = toNumber(row.seq);
          if (seqNum > maxDeletedSeq) maxDeletedSeq = seqNum;
          const xidBig = BigInt(row.tx_id);
          if (xidBig > maxDeletedXid) maxDeletedXid = xidBig;
        }

        if (deleted.rows.length > 0) {
          await sql`
            UPDATE ${this.headTable}
            SET
              min_retained_seq = GREATEST(min_retained_seq, ${maxDeletedSeq}),
              min_retained_xid = GREATEST(min_retained_xid, (${maxDeletedXid.toString()})::xid8),
              updated_at = ${nextModificationFence}
            WHERE base_id = ${baseKey}
          `.execute(trx);
        }

        const headRes = await this.getHead(txCtx, baseId);
        return headRes.map((h) => ({
          deletedCount: deleted.rows.length,
          minRetainedSeq: h.minRetainedSeq,
          minRetainedXid: h.minRetainedXid,
        }));
      });
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.compact_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }
}
