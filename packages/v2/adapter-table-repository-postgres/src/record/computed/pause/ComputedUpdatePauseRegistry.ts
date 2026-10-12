import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  generatePrefixedId,
  type DomainError,
  type IExecutionContext,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  sql,
  type Expression,
  type ExpressionBuilder,
  type ExpressionWrapper,
  type Kysely,
  type SqlBool,
} from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type {
  AdmitComputedWriteParams,
  ComputedUpdatePauseScope,
  ComputedUpdatePauseScopeType,
  ExtendComputedUpdatePauseLeaseParams,
  IComputedUpdatePauseRegistry,
  ListComputedUpdatePauseScopesParams,
  PauseComputedUpdateScopeParams,
  ReleaseComputedUpdatePauseLeaseParams,
  ResumeComputedUpdateScopeParams,
} from './IComputedUpdatePauseRegistry';
import {
  COMPUTED_UPDATE_PAUSE_SCOPE_TABLE,
  computedPausedWriteBlockedError,
  computedUpdatePauseScopeTypes,
  DEFAULT_COMPUTED_PAUSE_BACKLOG_WATERMARK,
  DEFAULT_COMPUTED_PAUSE_WRITE_POLICY,
  parseComputedUpdatePauseWritePolicy,
} from './IComputedUpdatePauseRegistry';

type DynamicDB = Record<string, Record<string, unknown>>;

const PAUSE_SCOPE_ID_PREFIX = 'cup';
const PAUSE_SCOPE_ID_BODY_LENGTH = 16;
const COMPUTED_UPDATE_OUTBOX_TABLE = 'computed_update_outbox';
const OUTBOX_PENDING_STATUS = 'pending';
export const DEFAULT_COMPUTED_UPDATE_PAUSE_DURATION_MS = 30 * 60 * 1000;
export const MAX_COMPUTED_UPDATE_PAUSE_DURATION_MS = 2 * 60 * 60 * 1000;

const createPauseScopeId = (): string =>
  generatePrefixedId(PAUSE_SCOPE_ID_PREFIX, PAUSE_SCOPE_ID_BODY_LENGTH);

type PauseScopeRow = {
  id: string;
  scope_type: ComputedUpdatePauseScopeType;
  scope_id: string;
  paused_at: Date;
  paused_by: string | null;
  resume_at: Date | null;
  reason: string | null;
  write_policy: string | null;
  updated_at: Date;
  updated_by: string | null;
};

type PauseScopeRef = Pick<PauseScopeRow, 'scope_type' | 'scope_id'>;

type ScopeMetadata = {
  scopeType: ComputedUpdatePauseScopeType;
  scopeId: string;
  scopeName: string | null;
  baseId: string | null;
  baseName: string | null;
  spaceId: string | null;
  spaceName: string | null;
};

const isActivePauseScope = (row: PauseScopeRow, now: Date): boolean =>
  row.resume_at == null || row.resume_at.getTime() > now.getTime();

const validateScopeType = (scopeType: string): scopeType is ComputedUpdatePauseScopeType =>
  computedUpdatePauseScopeTypes.includes(scopeType as ComputedUpdatePauseScopeType);

const readDatabaseNow = async (db: Kysely<DynamicDB>): Promise<Date> => {
  const result = await sql<{ now: Date | string }>`select current_timestamp as "now"`.execute(db);
  return new Date(result.rows[0]!.now);
};

@injectable()
export class ComputedUpdatePauseRegistry implements IComputedUpdatePauseRegistry {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly metaDb: Kysely<V1TeableDatabase> = db
  ) {}

  async pauseScope(
    params: PauseComputedUpdateScopeParams,
    context?: IExecutionContext
  ): Promise<Result<ComputedUpdatePauseScope, DomainError>> {
    if (!validateScopeType(params.scopeType)) {
      return err(
        domainError.validation({
          message: 'Invalid computed pause scope type',
          details: {
            scopeType: params.scopeType,
          },
        })
      );
    }

    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const metadataDb = this.resolveMetadataDb(context);
    const metadata = await this.resolveScopeMetadata(metadataDb, params.scopeType, params.scopeId);
    if (metadata.isErr()) return err(metadata.error);

    const now = await readDatabaseNow(db);
    const resumeAt =
      params.resumeAt ?? new Date(now.getTime() + DEFAULT_COMPUTED_UPDATE_PAUSE_DURATION_MS);
    if (Number.isNaN(resumeAt.getTime()) || resumeAt.getTime() <= now.getTime()) {
      return err(
        domainError.validation({
          message: 'Computed pause resumeAt must be in the future',
          details: { resumeAt },
        })
      );
    }
    if (resumeAt.getTime() - now.getTime() > MAX_COMPUTED_UPDATE_PAUSE_DURATION_MS) {
      return err(
        domainError.validation({
          message: 'Computed pause duration cannot exceed 2 hours',
          details: {
            resumeAt,
            maximumDurationMs: MAX_COMPUTED_UPDATE_PAUSE_DURATION_MS,
          },
        })
      );
    }
    // The lease id is a fencing token: taking over a scope rotates it so that a stale holder's
    // releaseLease() no longer matches and cannot release the pause that superseded it.
    const leaseId = createPauseScopeId();
    const writePolicy =
      params.writePolicy === undefined
        ? DEFAULT_COMPUTED_PAUSE_WRITE_POLICY
        : parseComputedUpdatePauseWritePolicy(params.writePolicy);
    if (
      params.writePolicy !== undefined &&
      params.writePolicy !== 'allow_bounded' &&
      params.writePolicy !== 'block'
    ) {
      return err(
        domainError.validation({
          message: 'Invalid computed pause writePolicy',
          details: { writePolicy: params.writePolicy },
        })
      );
    }
    await db
      .insertInto(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .values({
        id: leaseId,
        scope_type: params.scopeType,
        scope_id: params.scopeId,
        paused_at: now,
        paused_by: params.actor ?? null,
        resume_at: resumeAt,
        reason: params.reason ?? null,
        write_policy: writePolicy,
        updated_at: now,
        updated_by: params.actor ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['scope_type', 'scope_id']).doUpdateSet({
          id: leaseId,
          paused_at: now,
          paused_by: params.actor ?? null,
          resume_at: resumeAt,
          reason: params.reason ?? null,
          write_policy: writePolicy,
          updated_at: now,
          updated_by: params.actor ?? null,
        })
      )
      .execute();

    const paused = await this.getScopeByKey(db, metadataDb, params.scopeType, params.scopeId, now);
    if (paused.isErr()) return err(paused.error);
    if (!paused.value) {
      return err(
        domainError.unexpected({
          message: 'Failed to load computed pause scope after upsert',
          details: {
            scopeType: params.scopeType,
            scopeId: params.scopeId,
          },
        })
      );
    }

    // Move the scope's due backlog out of the hot claim scan. Claim and
    // redrive both key on next_run_at <= now before the pause predicate, so a
    // deferred row costs no per-poll rescan; when the lease expires the row is
    // due again and drains without operator action. Rows enqueued during the
    // pause stay claim-filtered by the pause predicate as before.
    const deferredCount = await this.updateScopeTaskSchedule(
      db,
      metadataDb,
      params.scopeType,
      params.scopeId,
      { deferUntil: resumeAt, now }
    );

    this.logger.info('computed:pause_scope:paused', {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      resumeAt,
      actor: params.actor ?? null,
      deferredTaskCount: deferredCount,
    });

    return ok(paused.value);
  }

  async resumeScope(
    params: ResumeComputedUpdateScopeParams,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>> {
    if (!validateScopeType(params.scopeType)) {
      return err(
        domainError.validation({
          message: 'Invalid computed pause scope type',
          details: {
            scopeType: params.scopeType,
          },
        })
      );
    }

    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const resumedAt = await readDatabaseNow(db);
    const resumed = await db
      .updateTable(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .set({
        resume_at: resumedAt,
        updated_at: resumedAt,
        updated_by: params.actor ?? null,
      })
      .where('scope_type', '=', params.scopeType)
      .where('scope_id', '=', params.scopeId)
      .where((eb) =>
        eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', sql`current_timestamp`)])
      )
      .returning('id')
      .executeTakeFirst();

    if (resumed) {
      // Pull the pause-deferred backlog back to due so the next claim round
      // drains it instead of waiting out the original lease.
      const restoredCount = await this.updateScopeTaskSchedule(
        db,
        this.resolveMetadataDb(context),
        params.scopeType,
        params.scopeId,
        { restoreAt: resumedAt }
      );
      this.logger.info('computed:pause_scope:resumed', {
        scopeType: params.scopeType,
        scopeId: params.scopeId,
        actor: params.actor ?? null,
        releaseReason: params.releaseReason ?? null,
        restoredTaskCount: restoredCount,
      });
    }

    return ok(Boolean(resumed));
  }

  async releaseLease(
    params: ReleaseComputedUpdatePauseLeaseParams,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const resumedAt = await readDatabaseNow(db);
    const released = await db
      .updateTable(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .set({
        resume_at: resumedAt,
        updated_at: resumedAt,
        updated_by: params.actor ?? null,
      })
      .where('id', '=', params.leaseId)
      .where((eb) =>
        eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', sql`current_timestamp`)])
      )
      .returning(['id', 'scope_type', 'scope_id'])
      .executeTakeFirst();

    if (released) {
      const restoredCount = await this.updateScopeTaskSchedule(
        db,
        this.resolveMetadataDb(context),
        released.scope_type as ComputedUpdatePauseScopeType,
        String(released.scope_id),
        { restoreAt: resumedAt }
      );
      this.logger.info('computed:pause_scope:lease_released', {
        leaseId: params.leaseId,
        scopeType: released.scope_type,
        scopeId: released.scope_id,
        actor: params.actor ?? null,
        releaseReason: params.releaseReason ?? null,
        restoredTaskCount: restoredCount,
      });
    }

    return ok(Boolean(released));
  }

  async extendLease(
    params: ExtendComputedUpdatePauseLeaseParams,
    context?: IExecutionContext
  ): Promise<Result<ComputedUpdatePauseScope | null, DomainError>> {
    if (
      !Number.isFinite(params.durationMs) ||
      params.durationMs <= 0 ||
      params.durationMs > MAX_COMPUTED_UPDATE_PAUSE_DURATION_MS
    ) {
      return err(
        domainError.validation({
          message: 'Computed pause extension duration must be between 1 ms and 2 hours',
          details: {
            durationMs: params.durationMs,
            maximumDurationMs: MAX_COMPUTED_UPDATE_PAUSE_DURATION_MS,
          },
        })
      );
    }

    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const metadataDb = this.resolveMetadataDb(context);
    const now = await readDatabaseNow(db);
    const requestedResumeAt = new Date(now.getTime() + params.durationMs);
    const extended = (await db
      .updateTable(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .set({
        resume_at: sql<Date>`greatest(${sql.ref('resume_at')}, ${requestedResumeAt})`,
        updated_at: now,
        updated_by: params.actor ?? null,
      })
      .where('id', '=', params.leaseId)
      .where('resume_at', 'is not', null)
      .where('resume_at', '>', sql`current_timestamp`)
      .returningAll()
      .executeTakeFirst()) as PauseScopeRow | undefined;

    if (!extended) return ok(null);

    const metadata = await this.resolveScopeMetadataBatch(metadataDb, [extended]);
    if (metadata.isErr()) return err(metadata.error);

    const resumeAt = new Date(extended.resume_at!);
    const deferredCount = await this.updateScopeTaskSchedule(
      db,
      metadataDb,
      extended.scope_type,
      extended.scope_id,
      { deferUntil: resumeAt, now }
    );
    this.logger.info('computed:pause_scope:extended', {
      leaseId: params.leaseId,
      scopeType: extended.scope_type,
      scopeId: extended.scope_id,
      resumeAt,
      actor: params.actor ?? null,
      deferredTaskCount: deferredCount,
    });

    return ok(this.toPauseScope(extended, metadata.value, now));
  }

  /**
   * Reschedule pending outbox tasks belonging to a scope.
   *
   * Defer (pause): push due rows to the lease's resumeAt so the claim probe,
   * the claim scan, and the redrive sweep — all keyed on next_run_at <= now —
   * skip them without re-evaluating the pause predicate every poll. Expiry of
   * the lease makes them due again on its own.
   *
   * Restore (early resume/release): pull future-dated rows back to due so the
   * backlog drains on the next claim round instead of waiting out the lease.
   */
  private async updateScopeTaskSchedule(
    db: Kysely<DynamicDB>,
    metadataDb: Kysely<DynamicDB>,
    scopeType: ComputedUpdatePauseScopeType,
    scopeId: string,
    mode: { deferUntil: Date; now: Date } | { restoreAt: Date }
  ): Promise<number> {
    const scopeCondition = await this.buildScopeTaskCondition(metadataDb, scopeType, scopeId);
    if (!scopeCondition) return 0;

    const isDefer = 'deferUntil' in mode;
    const scheduleAt = isDefer ? mode.deferUntil : mode.restoreAt;
    let query = db
      .updateTable(COMPUTED_UPDATE_OUTBOX_TABLE)
      .set({
        next_run_at: scheduleAt,
        updated_at: isDefer ? mode.now : scheduleAt,
      })
      .where('status', '=', OUTBOX_PENDING_STATUS)
      .where(scopeCondition);
    query = isDefer
      ? query.where('next_run_at', '<', scheduleAt)
      : query.where('next_run_at', '>', scheduleAt);

    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  /**
   * Task-matching condition mirroring the claim pause predicate: base scope
   * matches by base id, table scope by seed or affected tables, space scope by
   * the space's bases resolved through the metadata database.
   */
  private async buildScopeTaskCondition(
    metadataDb: Kysely<DynamicDB>,
    scopeType: ComputedUpdatePauseScopeType,
    scopeId: string
  ): Promise<
    | ((
        eb: ExpressionBuilder<DynamicDB, keyof DynamicDB>
      ) => Expression<boolean> | ExpressionWrapper<DynamicDB, keyof DynamicDB, SqlBool>)
    | null
  > {
    if (scopeType === 'base') {
      return (eb) => eb('base_id', '=', scopeId);
    }
    if (scopeType === 'space') {
      const bases = (await metadataDb
        .selectFrom('base')
        .select('id')
        .where('space_id', '=', scopeId)
        .execute()) as Array<{ id: string }>;
      const baseIds = bases.map((row) => String(row.id));
      if (!baseIds.length) return null;
      return (eb) => eb('base_id', 'in', baseIds);
    }
    return (eb) =>
      eb.or([
        eb('seed_table_id', '=', scopeId),
        sql<boolean>`${scopeId} = any(coalesce(${sql.ref('affected_table_ids')}, ARRAY[]::text[]))`,
      ]);
  }

  async listScopes(
    params?: ListComputedUpdatePauseScopesParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<ComputedUpdatePauseScope>, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const metadataDb = this.resolveMetadataDb(context);
    const now = await readDatabaseNow(db);
    let query = db.selectFrom(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE).selectAll();
    const activeOnly = params?.activeOnly ?? true;

    if (params?.scopeTypes?.length) {
      query = query.where('scope_type', 'in', [...params.scopeTypes]);
    }

    if (activeOnly) {
      query = query.where((eb) =>
        eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', sql`current_timestamp`)])
      );
    }

    const rows = (await query.orderBy('scope_type', 'asc').orderBy('scope_id', 'asc').execute()) as
      | PauseScopeRow[]
      | [];

    const metadata = await this.resolveScopeMetadataBatch(metadataDb, rows);
    if (metadata.isErr()) return err(metadata.error);

    const mapped = rows.map((row) => this.toPauseScope(row, metadata.value, now));

    return ok(mapped);
  }

  async admitComputedWrite(
    params: AdmitComputedWriteParams,
    _context?: IExecutionContext
  ): Promise<Result<void, DomainError>> {
    // Committed pause leases and backlog auto-release must not join the caller
    // transaction. An already-aborted user tx would hide the original error
    // (schema-op repair then classifies as transaction_rollback), and a rollback
    // would undo the watermark auto-release.
    try {
      const db = this.db as unknown as Kysely<DynamicDB>;
      const metadataDb = this.metaDb as unknown as Kysely<DynamicDB>;
      const space = (await metadataDb
        .selectFrom('base')
        .select('space_id')
        .where('id', '=', params.baseId)
        .executeTakeFirst()) as { space_id: string | null } | undefined;
      const spaceId = space?.space_id ?? null;

      const rows = (await db
        .selectFrom(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
        .selectAll()
        .where((eb) =>
          eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', sql`current_timestamp`)])
        )
        .where((eb) => {
          const matches = [
            eb.and([eb('scope_type', '=', 'table'), eb('scope_id', '=', params.tableId)]),
            eb.and([eb('scope_type', '=', 'base'), eb('scope_id', '=', params.baseId)]),
          ];
          if (spaceId) {
            matches.push(eb.and([eb('scope_type', '=', 'space'), eb('scope_id', '=', spaceId)]));
          }
          return eb.or(matches);
        })
        .execute()) as PauseScopeRow[];

      if (rows.length === 0) return ok(undefined);

      const blocked = rows.find(
        (row) => parseComputedUpdatePauseWritePolicy(row.write_policy) === 'block'
      );
      if (blocked) {
        return err(
          computedPausedWriteBlockedError({
            leaseId: blocked.id,
            scopeType: blocked.scope_type,
            scopeId: blocked.scope_id,
            reason: blocked.reason,
            retryAt: blocked.resume_at ? new Date(blocked.resume_at).toISOString() : null,
          })
        );
      }

      const watermark = params.backlogWatermark ?? DEFAULT_COMPUTED_PAUSE_BACKLOG_WATERMARK;
      for (const row of rows) {
        const pending = await this.countPendingTasks(db, metadataDb, row.scope_type, row.scope_id);
        if (pending < watermark) continue;

        const released = await this.releaseLease({
          leaseId: row.id,
          actor: 'computed-pause-backlog-budget',
          releaseReason: 'backlog_budget',
        });
        if (released.isErr()) return err(released.error);
        this.logger.warn('computed:pause_scope:auto_released_backlog_budget', {
          leaseId: row.id,
          scopeType: row.scope_type,
          scopeId: row.scope_id,
          pending,
          watermark,
        });
      }

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.unexpected({
          message: `Computed pause write admission failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private async countPendingTasks(
    db: Kysely<DynamicDB>,
    metadataDb: Kysely<DynamicDB>,
    scopeType: ComputedUpdatePauseScopeType,
    scopeId: string
  ): Promise<number> {
    const scopeCondition = await this.buildScopeTaskCondition(metadataDb, scopeType, scopeId);
    if (!scopeCondition) return 0;
    const row = (await db
      .selectFrom(COMPUTED_UPDATE_OUTBOX_TABLE)
      .select(sql<number>`count(*)`.as('count'))
      .where('status', '=', OUTBOX_PENDING_STATUS)
      .where(scopeCondition)
      .executeTakeFirst()) as { count: number | string } | undefined;
    return Number(row?.count ?? 0);
  }

  private async getScopeByKey(
    db: Kysely<DynamicDB>,
    metadataDb: Kysely<DynamicDB>,
    scopeType: ComputedUpdatePauseScopeType,
    scopeId: string,
    now: Date
  ): Promise<Result<ComputedUpdatePauseScope | null, DomainError>> {
    const row = (await db
      .selectFrom(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .selectAll()
      .where('scope_type', '=', scopeType)
      .where('scope_id', '=', scopeId)
      .executeTakeFirst()) as PauseScopeRow | undefined;

    if (!row) return ok(null);
    const metadata = await this.resolveScopeMetadataBatch(metadataDb, [row]);
    if (metadata.isErr()) return err(metadata.error);

    return ok(this.toPauseScope(row, metadata.value, now));
  }

  private resolveMetadataDb(context?: IExecutionContext): Kysely<DynamicDB> {
    const scope = this.db === this.metaDb ? 'data' : 'meta';
    return resolvePostgresDbOrTx(this.metaDb, context, scope) as unknown as Kysely<DynamicDB>;
  }

  private async resolveScopeMetadata(
    db: Kysely<DynamicDB>,
    scopeType: ComputedUpdatePauseScopeType,
    scopeId: string
  ): Promise<Result<ScopeMetadata, DomainError>> {
    const metadata = await this.resolveScopeMetadataBatch(db, [
      { scope_type: scopeType, scope_id: scopeId },
    ]);
    if (metadata.isErr()) return err(metadata.error);

    const resolved = metadata.value.get(`${scopeType}:${scopeId}`);
    if (!resolved) {
      return err(
        domainError.notFound({
          message: 'Computed pause scope target not found',
          details: {
            scopeType,
            scopeId,
          },
        })
      );
    }
    return ok(resolved);
  }

  private async resolveScopeMetadataBatch(
    db: Kysely<DynamicDB>,
    rows: ReadonlyArray<PauseScopeRef>
  ): Promise<Result<Map<string, ScopeMetadata>, DomainError>> {
    const metadata = new Map<string, ScopeMetadata>();
    const spaceIds = [
      ...new Set(rows.filter((row) => row.scope_type === 'space').map((row) => row.scope_id)),
    ];
    const baseIds = [
      ...new Set(rows.filter((row) => row.scope_type === 'base').map((row) => row.scope_id)),
    ];
    const tableIds = [
      ...new Set(rows.filter((row) => row.scope_type === 'table').map((row) => row.scope_id)),
    ];

    if (spaceIds.length) {
      const spaces = await db
        .selectFrom('space')
        .select(['id', 'name'])
        .where('id', 'in', spaceIds)
        .execute();

      for (const row of spaces as Array<{ id: string; name: string | null }>) {
        metadata.set(`space:${row.id}`, {
          scopeType: 'space',
          scopeId: row.id,
          scopeName: row.name ?? row.id,
          baseId: null,
          baseName: null,
          spaceId: row.id,
          spaceName: row.name ?? row.id,
        });
      }
    }

    if (baseIds.length) {
      const bases = await db
        .selectFrom('base as b')
        .leftJoin('space as s', 's.id', 'b.space_id')
        .select(['b.id as id', 'b.name as baseName', 's.id as spaceId', 's.name as spaceName'])
        .where('b.id', 'in', baseIds)
        .execute();

      for (const row of bases as Array<{
        id: string;
        baseName: string | null;
        spaceId: string | null;
        spaceName: string | null;
      }>) {
        metadata.set(`base:${row.id}`, {
          scopeType: 'base',
          scopeId: row.id,
          scopeName: row.baseName ?? row.id,
          baseId: row.id,
          baseName: row.baseName ?? row.id,
          spaceId: row.spaceId,
          spaceName: row.spaceName ?? row.spaceId,
        });
      }
    }

    if (tableIds.length) {
      const tables = await db
        .selectFrom('table_meta as tm')
        .leftJoin('base as b', 'b.id', 'tm.base_id')
        .leftJoin('space as s', 's.id', 'b.space_id')
        .select([
          'tm.id as id',
          'tm.name as tableName',
          'b.id as baseId',
          'b.name as baseName',
          's.id as spaceId',
          's.name as spaceName',
        ])
        .where('tm.id', 'in', tableIds)
        .where('tm.deleted_time', 'is', null)
        .execute();

      for (const row of tables as Array<{
        id: string;
        tableName: string | null;
        baseId: string | null;
        baseName: string | null;
        spaceId: string | null;
        spaceName: string | null;
      }>) {
        metadata.set(`table:${row.id}`, {
          scopeType: 'table',
          scopeId: row.id,
          scopeName: row.tableName ?? row.id,
          baseId: row.baseId,
          baseName: row.baseName ?? row.baseId,
          spaceId: row.spaceId,
          spaceName: row.spaceName ?? row.spaceId,
        });
      }
    }

    return ok(metadata);
  }

  private toPauseScope(
    row: PauseScopeRow,
    metadataMap: ReadonlyMap<string, ScopeMetadata>,
    now: Date
  ): ComputedUpdatePauseScope {
    const metadata = metadataMap.get(`${row.scope_type}:${row.scope_id}`);
    return {
      id: row.id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      scopeName: metadata?.scopeName ?? null,
      baseId: metadata?.baseId ?? null,
      baseName: metadata?.baseName ?? null,
      spaceId: metadata?.spaceId ?? null,
      spaceName: metadata?.spaceName ?? null,
      pausedAt: row.paused_at,
      pausedBy: row.paused_by,
      resumeAt: row.resume_at,
      reason: row.reason,
      writePolicy: parseComputedUpdatePauseWritePolicy(row.write_policy),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      active: isActivePauseScope(row, now),
    };
  }
}

export const buildComputedTaskNotPausedCondition = (
  eb: ExpressionBuilder<DynamicDB, keyof DynamicDB>,
  alias: string,
  now: Date,
  options: { includeSpaceScope?: boolean } = {}
) => {
  const includeSpaceScope = options.includeSpaceScope ?? true;
  const pauseScopes = eb
    .selectFrom(`${COMPUTED_UPDATE_PAUSE_SCOPE_TABLE} as cps`)
    .select(sql<number>`1`.as('one'));

  const activeScopeCondition = sql<boolean>`
    (cps."resume_at" is null or cps."resume_at" > ${now})
    and (
      (cps."scope_type" = 'base' and cps."scope_id" = ${sql.ref(`${alias}.base_id`)})
      or (
        cps."scope_type" = 'table'
        and (
          cps."scope_id" = ${sql.ref(`${alias}.seed_table_id`)}
          or cps."scope_id" = any(coalesce(${sql.ref(`${alias}.affected_table_ids`)}, ARRAY[]::text[]))
        )
      )
      ${
        includeSpaceScope
          ? sql`or (cps."scope_type" = 'space' and cps."scope_id" = cb."space_id")`
          : sql``
      }
    )
  `;

  const activeScopes = includeSpaceScope
    ? pauseScopes
        .leftJoin('base as cb', (join) => join.onRef('cb.id', '=', `${alias}.base_id`))
        .where(activeScopeCondition)
    : pauseScopes.where(activeScopeCondition);

  return eb.not(eb.exists(activeScopes));
};
