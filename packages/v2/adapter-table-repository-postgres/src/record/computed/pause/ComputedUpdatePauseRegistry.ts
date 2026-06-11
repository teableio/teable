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
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type {
  ComputedUpdatePauseScope,
  ComputedUpdatePauseScopeType,
  IComputedUpdatePauseRegistry,
  ListComputedUpdatePauseScopesParams,
  PauseComputedUpdateScopeParams,
  ResumeComputedUpdateScopeParams,
} from './IComputedUpdatePauseRegistry';
import {
  COMPUTED_UPDATE_PAUSE_SCOPE_TABLE,
  computedUpdatePauseScopeTypes,
} from './IComputedUpdatePauseRegistry';

type DynamicDB = Record<string, Record<string, unknown>>;

const PAUSE_SCOPE_ID_PREFIX = 'cup';
const PAUSE_SCOPE_ID_BODY_LENGTH = 16;

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

    const now = new Date();
    await db
      .insertInto(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .values({
        id: createPauseScopeId(),
        scope_type: params.scopeType,
        scope_id: params.scopeId,
        paused_at: now,
        paused_by: params.actor ?? null,
        resume_at: params.resumeAt ?? null,
        reason: params.reason ?? null,
        updated_at: now,
        updated_by: params.actor ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['scope_type', 'scope_id']).doUpdateSet({
          paused_at: now,
          paused_by: params.actor ?? null,
          resume_at: params.resumeAt ?? null,
          reason: params.reason ?? null,
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

    this.logger.info('computed:pause_scope:paused', {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      resumeAt: params.resumeAt ?? null,
      actor: params.actor ?? null,
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
    const resumed = await db
      .deleteFrom(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .where('scope_type', '=', params.scopeType)
      .where('scope_id', '=', params.scopeId)
      .returning('id')
      .executeTakeFirst();

    if (resumed) {
      this.logger.info('computed:pause_scope:resumed', {
        scopeType: params.scopeType,
        scopeId: params.scopeId,
      });
    }

    return ok(Boolean(resumed));
  }

  async listScopes(
    params?: ListComputedUpdatePauseScopesParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<ComputedUpdatePauseScope>, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const metadataDb = this.resolveMetadataDb(context);
    const now = new Date();
    let query = db.selectFrom(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE).selectAll();
    const activeOnly = params?.activeOnly ?? true;

    if (params?.scopeTypes?.length) {
      query = query.where('scope_type', 'in', [...params.scopeTypes]);
    }

    if (activeOnly) {
      query = query.where((eb) => eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', now)]));
    }

    const rows = (await query.orderBy('scope_type', 'asc').orderBy('scope_id', 'asc').execute()) as
      | PauseScopeRow[]
      | [];

    const metadata = await this.resolveScopeMetadataBatch(metadataDb, rows);
    if (metadata.isErr()) return err(metadata.error);

    const mapped = rows.map((row) => this.toPauseScope(row, metadata.value, now));

    return ok(mapped);
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
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      active: isActivePauseScope(row, now),
    };
  }
}

export const buildComputedTaskNotPausedCondition = (
  alias: string,
  now: Date,
  options: { includeSpaceScope?: boolean } = {}
) => {
  const includeSpaceScope = options.includeSpaceScope ?? true;

  return sql<boolean>`
  not exists (
    select 1
    from ${sql.table(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)} as cps
    ${
      includeSpaceScope
        ? sql`left join "base" as cb on cb."id" = ${sql.ref(`${alias}.base_id`)}`
        : sql``
    }
    where (cps."resume_at" is null or cps."resume_at" > ${now})
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
  )
`;
};
