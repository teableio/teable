/* eslint-disable @typescript-eslint/naming-convention */
import { randomUUID } from 'node:crypto';
import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
  v2DataDbTokens,
  v2MetaDbTokens,
  type IV2PostgresDbConfig,
} from '@teable/v2-adapter-db-postgres-shared';
import {
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
  type IVcsHeadState,
  type IVcsPullCursor,
  type IVcsPushMetadataLockTargets,
  type IVcsPushPhysicalTableLockTarget,
} from '@teable/v2-vcs/server';
import { type ColumnType, type Kysely, sql, type Transaction, type RawBuilder } from 'kysely';

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
const DEFAULT_ENABLED_CACHE_TTL_MS = 30_000;
const DEFAULT_ENABLE_QUIESCE_TIMEOUT_MS = 15_000;
const DEFAULT_ENABLE_QUIESCE_POLL_MS = 15;
const DEFAULT_COMPACTION_INTERVAL_COMMITS = 50;
const DEFAULT_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_MAX_ROWS = 100_000;
const DIRECT_WRITE_ORIGIN_SENTINEL = '__direct_write__';

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

  async getHead(
    ctx: IExecutionContext,
    baseId: BaseId
  ): Promise<Result<IVcsHeadState, DomainError>> {
    try {
      const db = resolvePostgresDbOrTx(this.dataDb, ctx, 'data');
      if (!(await this.hasHeadTable(db))) {
        return ok({ enabled: false, headRevision: 0, minRetainedSeq: 0, minRetainedXid: '0' });
      }
      const row = await sql<{
        enabled: boolean;
        head_revision: string | number;
        min_retained_seq: string | number;
        min_retained_xid: string;
      }>`
        SELECT enabled, head_revision, min_retained_seq, min_retained_xid::text AS min_retained_xid
        FROM base_vcs_head
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

  async isEnabled(ctx: IExecutionContext, baseId: BaseId): Promise<Result<boolean, DomainError>> {
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
      const rowRes = await sql<{ enabled: boolean }>`
        SELECT enabled FROM base_vcs_head WHERE base_id = ${baseKey} LIMIT 1
      `.execute(db);
      const enabled = Boolean(rowRes.rows[0]?.enabled);
      if (enabled) {
        this.markEnabledAfterCommit(ctx, baseKey);
      }
      return ok(enabled);
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

  private async upsertEnabledHead(
    ctx: IExecutionContext,
    baseKey: string
  ): Promise<
    Result<
      {
        readonly alreadyEnabled: boolean;
        readonly headRevision: number;
        readonly barrierXid: string;
      },
      DomainError
    >
  > {
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

        const existingRes = await sql<{
          enabled: boolean;
          head_revision: string | number;
          barrier_xid: string;
        }>`
          SELECT enabled, head_revision, enabled_barrier_xid::text AS barrier_xid
          FROM base_vcs_head
          WHERE base_id = ${baseKey}
          FOR UPDATE
        `.execute(trx);
        const existing = existingRes.rows[0];
        if (existing?.enabled) {
          return ok({
            alreadyEnabled: true,
            headRevision: toNumber(existing.head_revision),
            barrierXid: String(existing.barrier_xid ?? '0'),
          });
        }

        const upserted = await trx
          .insertInto('base_vcs_head')
          .values({
            base_id: baseKey,
            enabled: true,
            head_revision: 0,
            enabled_barrier_xid: sql`'0'::xid8`,
          })
          .onConflict((oc) =>
            oc.column('base_id').doUpdateSet({
              enabled: true,
              updated_at: sql`now()`,
            })
          )
          .returning(['head_revision'])
          .executeTakeFirstOrThrow();

        return ok({
          alreadyEnabled: false,
          headRevision: toNumber(upserted.head_revision),
          barrierXid: '0',
        });
      },
      { scope: 'data' }
    );
  }

  async enable(
    ctx: IExecutionContext,
    baseId: BaseId
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
            'enable() must commit its enabled flag before awaiting the MVCC pre-enable quiesce barrier',
        })
      );
    }

    const baseKey = baseId.toString();
    try {
      const upsertRes = await this.upsertEnabledHead(ctx, baseKey);
      if (upsertRes.isErr()) {
        return err(upsertRes.error);
      }

      let { barrierXid } = upsertRes.value;
      if (!upsertRes.value.alreadyEnabled) {
        const snapRes = await sql<{ xmax: string }>`
          SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS xmax
        `.execute(this.dataDb);
        barrierXid = String(snapRes.rows[0]?.xmax ?? '0');
        await sql`
          UPDATE base_vcs_head
          SET
            enabled_barrier_xid = GREATEST(enabled_barrier_xid, (${barrierXid})::xid8),
            updated_at = now()
          WHERE base_id = ${baseKey}
        `.execute(this.dataDb);
      }

      const barrierRes = await this.waitForEnableBarrier(barrierXid);
      if (barrierRes.isErr()) {
        return err(barrierRes.error);
      }

      this.cacheEnabledTrue(baseKey);
      return ok({ enabledAtRevision: upsertRes.value.headRevision });
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
    target: IVcsPushPhysicalTableLockTarget
  ): Promise<void> {
    if (target.recordIds !== undefined && target.recordIds.length === 0) {
      return;
    }

    const reg = await sql<{ exists: boolean }>`
      SELECT (to_regclass(${toPgRegclassIdentifier(target.dbTableName)}) IS NOT NULL) AS exists
    `.execute(dataTrx);
    if (!reg.rows[0]?.exists) {
      return;
    }

    const keyCol = target.keyColumn ?? '__id';
    if (target.recordIds !== undefined) {
      const sortedIds = Array.from(new Set<string>(target.recordIds)).sort((a, b) =>
        a.localeCompare(b)
      );
      await sql`
        SELECT 1 FROM ${sql.table(target.dbTableName)}
        WHERE ${sql.ref(keyCol)} IN (${sql.join(sortedIds)})
        ORDER BY ${sql.ref(keyCol)} ASC
        FOR UPDATE
      `.execute(dataTrx);
      return;
    }

    // Whole-table lock is only used for `tablesDeleted` to block concurrent inserts without scanning all rows.
    await sql`LOCK TABLE ${sql.table(target.dbTableName)} IN SHARE ROW EXCLUSIVE MODE`.execute(
      dataTrx
    );
  }

  private async lockMetaTargets(
    metaExecutor: Transaction<unknown>,
    baseKey: string,
    targets: IVcsPushMetadataLockTargets
  ): Promise<void> {
    const explicitTableIds = Array.from(new Set(targets.tableIds)).sort((a, b) =>
      a.localeCompare(b)
    );
    const tableFilterSql =
      explicitTableIds.length > 0 ? sql`OR id IN (${sql.join(explicitTableIds)})` : sql``;
    const lockedTableRows = await sql<{ id: string }>`
      SELECT id FROM table_meta
      WHERE (base_id = ${baseKey} AND deleted_time IS NULL) ${tableFilterSql}
      ORDER BY id ASC
      FOR UPDATE
    `.execute(metaExecutor);

    const allLockedTableIds = Array.from(
      new Set([...lockedTableRows.rows.map((r) => r.id), ...explicitTableIds])
    ).sort((a, b) => a.localeCompare(b));

    const explicitFieldIds = Array.from(new Set(targets.fieldIds)).sort((a, b) =>
      a.localeCompare(b)
    );
    const fieldClauses: RawBuilder<unknown>[] = [];
    if (allLockedTableIds.length > 0) {
      fieldClauses.push(
        sql`(table_id IN (${sql.join(allLockedTableIds)}) AND deleted_time IS NULL)`
      );
    }
    if (explicitFieldIds.length > 0) {
      fieldClauses.push(sql`id IN (${sql.join(explicitFieldIds)})`);
    }
    if (fieldClauses.length > 0) {
      await sql`
        SELECT id FROM field
        WHERE ${sql.join(fieldClauses, sql` OR `)}
        ORDER BY id ASC
        FOR UPDATE
      `.execute(metaExecutor);
    }

    const explicitViewIds = Array.from(new Set(targets.viewIds)).sort((a, b) => a.localeCompare(b));
    const viewClauses: RawBuilder<unknown>[] = [];
    if (allLockedTableIds.length > 0) {
      viewClauses.push(
        sql`(table_id IN (${sql.join(allLockedTableIds)}) AND deleted_time IS NULL)`
      );
    }
    if (explicitViewIds.length > 0) {
      viewClauses.push(sql`id IN (${sql.join(explicitViewIds)})`);
    }
    if (viewClauses.length > 0) {
      await sql`
        SELECT id FROM view
        WHERE ${sql.join(viewClauses, sql` OR `)}
        ORDER BY id ASC
        FOR UPDATE
      `.execute(metaExecutor);
    }
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
      const lockedHead = await sql<{
        enabled: boolean;
        head_revision: string | number;
        min_retained_seq: string | number;
        min_retained_xid: string;
      }>`
        SELECT enabled, head_revision, min_retained_seq, min_retained_xid::text AS min_retained_xid
        FROM base_vcs_head
        WHERE base_id = ${baseKey}
        FOR UPDATE
      `.execute(dataTrx);

      const head = lockedHead.rows[0];
      if (!head || !head.enabled) {
        return err(
          vcsDomainError.conflict({
            code: 'vcs.not_enabled',
            message: 'Base VCS is not enabled on this base; enable VCS first.',
            details: { baseId: baseKey },
          })
        );
      }

      const metaExecutor =
        (getPostgresTransaction(ctx, 'meta') as Transaction<unknown> | undefined) ??
        (dataTrx as unknown as Transaction<unknown>);
      await this.lockMetaTargets(metaExecutor, baseKey, targets);
      this.markEnabledAfterCommit(ctx, baseKey);

      return ok({
        enabled: true,
        headRevision: toNumber(head.head_revision),
        minRetainedSeq: toNumber(head.min_retained_seq),
        minRetainedXid: String(head.min_retained_xid ?? '0'),
      });
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.lock_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
    }
  }

  async lockPushPhysicalTargets(
    ctx: IExecutionContext,
    _baseId: BaseId,
    physicalTargets: readonly IVcsPushPhysicalTableLockTarget[]
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
      for (const target of sorted) {
        await this.lockPhysicalTableRowsIfExists(dataTrx, target);
      }
      return ok(undefined);
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.lock_failed',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      );
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
    commit: IVcsCommitInput
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
          updated_at: sql`now()`,
        })
        .where('base_id', '=', baseKey)
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
            UPDATE base_vcs_head
            SET
              min_retained_seq = GREATEST(min_retained_seq, ${maxDeletedSeq}),
              min_retained_xid = GREATEST(min_retained_xid, (${maxDeletedXid.toString()})::xid8),
              updated_at = now()
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
