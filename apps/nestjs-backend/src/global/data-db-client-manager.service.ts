import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DataPrismaService,
  PrismaClient as DataPrismaClient,
  getMetaDatabaseUrl,
} from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import createKnex, { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { withDataDbInternalSchemaParam } from '../features/space/data-db-internal-schema';
import { DataDbMigrationService } from '../features/space/data-db-migration.service';
import { decryptDataDbUrl } from '../features/space/data-db-url-secret';
import type { IClsStore } from '../types/cls';
import {
  DATA_DB_KNEX_CACHE_NAMESPACE,
  DATA_DB_PRISMA_CACHE_NAMESPACE,
  DataDbRuntimeCacheService,
} from './data-db-runtime-cache.service';
import { DATA_KNEX } from './knex';

export interface IResolvedDataDatabase {
  cacheKey: string;
  url: string;
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
  activeProcessing: number;
  staleProcessing: number;
  dead: number;
  oldestDueAgeMs: number;
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

type IResolvedSpaceDataDbRoute =
  | { isMetaFallback: true }
  | { connectionId: string; internalSchema: string; isMetaFallback: false; url: string };

const COMPUTED_OUTBOX_REDRIVE_LOCK_KEY = 'v2:computed-outbox:global-redrive:v1';
const COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS = 5000;
const COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS = 10_000;

@Injectable()
export class DataDbClientManager {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly metaFallbackDataPrismaService: DataPrismaService,
    @InjectModel(DATA_KNEX) private readonly metaFallbackDataKnex: Knex,
    private readonly runtimeCache: DataDbRuntimeCacheService,
    @Optional()
    private readonly dataDbMigrationService?: DataDbMigrationService,
    @Optional()
    @Inject(ClsService)
    private readonly cls?: ClsService<IClsStore>
  ) {}

  private getMetaRoutingClient(options?: IDataDbRoutingOptions): IMetaRoutingClient {
    return options?.useTransaction ? this.prismaService.txClient() : this.prismaService;
  }

  async getDataDatabaseForSpace(
    spaceId: string,
    options?: IDataDbRoutingOptions
  ): Promise<IResolvedDataDatabase> {
    const resolved = await this.resolveSpaceDataDb(spaceId, options);

    if (resolved.isMetaFallback) {
      return {
        cacheKey: 'meta-fallback',
        url: getMetaDatabaseUrl(),
        isMetaFallback: true,
      };
    }

    return {
      cacheKey: resolved.connectionId,
      connectionId: resolved.connectionId,
      internalSchema: resolved.internalSchema,
      url: withDataDbInternalSchemaParam(resolved.url, resolved.internalSchema),
      isMetaFallback: false,
    };
  }

  async getDataDatabaseUrlForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    return (await this.getDataDatabaseForSpace(spaceId, options)).url;
  }

  async getDataDatabaseForBase(baseId: string, options?: IDataDbRoutingOptions) {
    const base = await this.getMetaRoutingClient(options).base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new Error(`Base ${baseId} not found`);
    }
    return await this.getDataDatabaseForSpace(base.spaceId, options);
  }

  async getDataDatabaseUrlForBase(baseId: string, options?: IDataDbRoutingOptions) {
    return (await this.getDataDatabaseForBase(baseId, options)).url;
  }

  async getDataDatabaseForTable(tableId: string, options?: IDataDbRoutingOptions) {
    const table = await this.getMetaRoutingClient(options).tableMeta.findUnique({
      where: { id: tableId },
      select: { base: { select: { spaceId: true } } },
    });
    if (!table) {
      throw new Error(`Table ${tableId} not found`);
    }
    return await this.getDataDatabaseForSpace(table.base.spaceId, options);
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
        isMetaFallback: true,
        storage: 'default',
      },
      ...connections.map((connection) => ({
        cacheKey: connection.id,
        connectionId: connection.id,
        internalSchema: connection.internalSchema,
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

  async *iterateComputedOutboxWakeupCandidates(
    target: IComputedOutboxMaintenanceTarget,
    processingLeaseMs: number,
    batchSize = 500
  ): AsyncGenerator<ReadonlyArray<IComputedOutboxWakeupCandidate>> {
    const client = createKnex({
      client: 'pg',
      connection: {
        connectionString: target.url,
        connectionTimeoutMillis: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
      },
      acquireConnectionTimeout: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
      pool: { min: 0, max: 1 },
    });
    let afterId: string | undefined;
    const normalizedBatchSize = Math.max(1, Math.trunc(batchSize));

    try {
      while (true) {
        let query = client('computed_update_outbox')
          .select({
            taskId: 'id',
            baseId: 'base_id',
            status: 'status',
            nextRunAt: 'next_run_at',
            lockedAt: 'locked_at',
            attempts: 'attempts',
            updatedAt: 'updated_at',
          })
          .whereIn('status', ['pending', 'processing'])
          .orderBy('id', 'asc')
          .limit(normalizedBatchSize);
        if (afterId) query = query.where('id', '>', afterId);

        const rows = (await query.timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, {
          cancel: true,
        })) as Array<{
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
    const client = createKnex({
      client: 'pg',
      connection: {
        connectionString: target.url,
        connectionTimeoutMillis: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
      },
      acquireConnectionTimeout: COMPUTED_OUTBOX_MAINTENANCE_CONNECT_TIMEOUT_MS,
      pool: { min: 0, max: 1 },
    });
    const baseSpaceMapping = target.baseSpaceMapping ?? [];
    const pauseSpaceJoin =
      target.storage === 'default'
        ? 'left join "base" as cb on cb."id" = o.base_id'
        : `left join jsonb_to_recordset(?::jsonb) as cb(base_id text, space_id text)
            on cb.base_id = o.base_id`;
    const pauseSpaceParams =
      target.storage === 'byodb'
        ? [
            JSON.stringify(
              baseSpaceMapping.map(({ baseId, spaceId }) => ({
                base_id: baseId,
                space_id: spaceId,
              }))
            ),
          ]
        : [];
    try {
      const result = await client
        .raw<{
          rows: Array<Record<string, string | number | null>>;
        }>(
          `with outbox_state as (
            select o.*,
              not exists (
                select 1
                from computed_update_pause_scope as cps
                ${pauseSpaceJoin}
                where (cps.resume_at is null or cps.resume_at > now())
                  and (
                    (cps.scope_type = 'base' and cps.scope_id = o.base_id)
                    or (
                      cps.scope_type = 'table'
                      and (
                        cps.scope_id = o.seed_table_id
                        or cps.scope_id = any(coalesce(o.affected_table_ids, ARRAY[]::text[]))
                      )
                    )
                    or (cps.scope_type = 'space' and cps.scope_id = cb.space_id)
                  )
              ) as actionable
            from computed_update_outbox as o
          )
        select
          count(*) filter (
            where status = 'pending' and next_run_at <= now() and actionable
          ) as due_pending,
          count(*) filter (where status = 'pending' and next_run_at > now()) as scheduled_pending,
          count(*) filter (
            where status = 'processing'
              and locked_at is not null
              and locked_at > now() - (? * interval '1 millisecond')
          ) as active_processing,
          count(*) filter (
            where status = 'processing'
              and actionable
              and (locked_at is null or locked_at <= now() - (? * interval '1 millisecond'))
          ) as stale_processing,
          coalesce(
            extract(epoch from (now() - min(next_run_at) filter (
              where status = 'pending' and next_run_at <= now() and actionable
            ))) * 1000,
            0
          ) as oldest_due_age_ms,
          (select count(*) from computed_update_dead_letter) as dead
        from outbox_state`,
          [...pauseSpaceParams, processingLeaseMs, processingLeaseMs]
        )
        .timeout(COMPUTED_OUTBOX_MAINTENANCE_QUERY_TIMEOUT_MS, { cancel: true });
      const row = result.rows[0] ?? {};
      return {
        duePending: Number(row.due_pending ?? 0),
        scheduledPending: Number(row.scheduled_pending ?? 0),
        activeProcessing: Number(row.active_processing ?? 0),
        staleProcessing: Number(row.stale_processing ?? 0),
        dead: Number(row.dead ?? 0),
        oldestDueAgeMs: Number(row.oldest_due_age_ms ?? 0),
      };
    } finally {
      await client.destroy();
    }
  }

  async getDataDatabaseUrlForTable(tableId: string, options?: IDataDbRoutingOptions) {
    return (await this.getDataDatabaseForTable(tableId, options)).url;
  }

  async dataKnexForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    const resolved = await this.resolveSpaceDataDb(spaceId, options);

    if (resolved.isMetaFallback) {
      return this.metaFallbackDataKnex;
    }

    return await this.runtimeCache.getOrCreate(
      DATA_DB_KNEX_CACHE_NAMESPACE,
      resolved.connectionId,
      () =>
        createKnex({
          client: 'pg',
          connection: resolved.url,
          searchPath: [resolved.internalSchema],
          pool: {
            min: 0,
            max: Number(process.env.BYODB_DATA_DB_POOL_MAX ?? 5),
          },
        }),
      (client) => client.destroy()
    );
  }

  async dataPrismaForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    const resolved = await this.resolveSpaceDataDb(spaceId, options);

    if (resolved.isMetaFallback) {
      return this.metaFallbackDataPrismaService;
    }

    return await this.runtimeCache.getOrCreate(
      DATA_DB_PRISMA_CACHE_NAMESPACE,
      resolved.connectionId,
      () =>
        new DataPrismaClient({
          datasources: {
            db: {
              url: withDataDbInternalSchemaParam(resolved.url, resolved.internalSchema),
            },
          },
        }),
      (client) => client.$disconnect()
    );
  }

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

    const binding = await this.getMetaRoutingClient(options).spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });

    if (!binding || binding.mode === 'default') {
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
      throw new Error(`Data database binding for space ${spaceId} is not ready`);
    }

    if (!migratableStates.includes(connection.status)) {
      throw new Error(`Data database binding for space ${spaceId} is not ready`);
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
    await Promise.all([
      this.runtimeCache.deleteByNamespace(DATA_DB_KNEX_CACHE_NAMESPACE),
      this.runtimeCache.deleteByNamespace(DATA_DB_PRISMA_CACHE_NAMESPACE),
    ]);
  }
}
