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
