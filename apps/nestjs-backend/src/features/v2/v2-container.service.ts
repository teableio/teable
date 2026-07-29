import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import type { IPgPoolLease } from '@teable/db-main-prisma';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ShareDbPubSubPublisher,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import {
  IComputedOutboxWakeupPublisher,
  noopComputedOutboxWakeupPublisher,
} from '@teable/v2-adapter-table-repository-postgres';
import { KeyvUndoRedoStore } from '@teable/v2-adapter-undo-redo-keyv';
import { createV2NodePgContainer, type IV2NodePgContainerOptions } from '@teable/v2-container-node';
import type {
  AttachmentValueDecoratorService,
  IAttachmentLookupService,
  IComputedActivityReader,
  IExecutionContext,
} from '@teable/v2-core';
import {
  ActorId,
  mapFieldComputeActivityToRealtime,
  mapTableComputeActivityToRealtime,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { registerV2ImportServices } from '@teable/v2-import';
import {
  startTableQueryOpsAnalyzerIfEnabled,
  startTableQueryOpsTaskWorkerIfEnabled,
  type ExecutablePhase1RemediationKind,
  type TableQueryOpsRunnerHandle,
} from '@teable/v2-table-query-ops';
import { createSsrfSafeFetch, setSafeFetch } from '@teable/v2-utils';
import { PinoLogger } from 'nestjs-pino';
import { CacheService } from '../../cache/cache.service';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import type { IComputedOutboxMaintenanceTarget } from '../../global/data-db-client-manager.service';
import {
  DataDbRuntimeCacheService,
  V2_CONTAINER_CACHE_NAMESPACE,
} from '../../global/data-db-runtime-cache.service';
import { ShareDbService } from '../../share-db/share-db.service';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './computed-outbox-trigger/constants';
import { TableQuerySearchMetricsService } from './table-query-search-observability';
import { resolveTableQuerySearchVectorRuntimeMode } from './table-query-search-vector-runtime.service';
import { V2AttachmentUrlSignerService } from './v2-attachment-url-signer.service';
import { CommandBusTracingMiddleware } from './v2-command-bus-tracing.middleware';
import { PinoLoggerAdapter } from './v2-logger.adapter';
import {
  V2_PROJECTION_REGISTRAR_METADATA,
  isV2ProjectionRegistrar,
  type IV2ProjectionRegistrar,
} from './v2-projection-registrar';
import { QueryBusTracingMiddleware } from './v2-query-bus-tracing.middleware';
import { V2RecordChangedValueDecoratorService } from './v2-record-changed-value-decorator.service';
import { OpenTelemetryTracer } from './v2-tracer.adapter';

const resolvePositiveInteger = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const resolveBoolean = (value: unknown, defaultValue = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const executablePhase1RemediationKinds = [
  'create_search_index',
  'create_search_vector',
  'rebuild_search_vector',
  'create_filter_index',
  'create_sort_index',
  'repair_index',
  'manual_investigation',
] as const satisfies ReadonlyArray<ExecutablePhase1RemediationKind>;

const parseAllowedRemediationKinds = (
  value: unknown
): ReadonlyArray<ExecutablePhase1RemediationKind> | undefined => {
  if (typeof value !== 'string') return undefined;
  const allowed = new Set<ExecutablePhase1RemediationKind>(executablePhase1RemediationKinds);
  const parsed = value
    .split(',')
    .map((kind) => kind.trim())
    .filter((kind): kind is ExecutablePhase1RemediationKind =>
      allowed.has(kind as ExecutablePhase1RemediationKind)
    );
  return parsed.length > 0 ? parsed : undefined;
};

@Injectable()
export class V2ContainerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(V2ContainerService.name);
  private readonly tableQueryOpsRunnerHandles = new WeakMap<
    DependencyContainer,
    ReadonlyArray<TableQueryOpsRunnerHandle>
  >();
  private readonly poolLeases = new WeakMap<DependencyContainer, ReadonlyArray<IPgPoolLease>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly pinoLogger: PinoLogger,
    private readonly shareDbService: ShareDbService,
    private readonly cacheService: CacheService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly reflector: Reflector,
    private readonly discoveryService: DiscoveryService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly runtimeCache: DataDbRuntimeCacheService,
    private readonly pgPoolRegistry: PgPoolRegistry,
    @Optional()
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly computedOutboxWakeupPublisher: IComputedOutboxWakeupPublisher = noopComputedOutboxWakeupPublisher
  ) {
    this.shareDbService.setComputedActivitySnapshotLoader(async (tableId) => {
      const container = await this.getContainerForTable(tableId);
      const reader = container.resolve<IComputedActivityReader>(
        v2CoreTokens.computedActivityReader
      );
      const result = await reader.getByTableId(undefined, tableId);
      if (result.isErr()) throw result.error;

      const documents: Record<string, { version: number; data: unknown }> = {};
      if (result.value.table) {
        documents.table = {
          version: result.value.table.generation,
          data: mapTableComputeActivityToRealtime(result.value.table),
        };
      }
      for (const field of result.value.fields) {
        documents[field.fieldId] = {
          version: field.generation,
          data: mapFieldComputeActivityToRealtime(field),
        };
      }
      return documents;
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.getContainer();
  }

  async getContainer(): Promise<DependencyContainer> {
    return await this.getContainerForDataDb('meta-fallback', this.getMetaConnectionString());
  }

  async getContainerForSpace(spaceId: string): Promise<DependencyContainer> {
    const dataDb = await this.dataDbClientManager.getDataDatabaseForSpace(spaceId);
    return await this.getContainerForDataDb(
      dataDb.cacheKey,
      dataDb.connectionUrl ?? dataDb.url,
      dataDb.internalSchema
    );
  }

  async getContainerForBase(baseId: string): Promise<DependencyContainer> {
    const dataDb = await this.dataDbClientManager.getDataDatabaseForBase(baseId);
    return await this.getContainerForDataDb(
      dataDb.cacheKey,
      dataDb.connectionUrl ?? dataDb.url,
      dataDb.internalSchema
    );
  }

  async getContainerForTable(tableId: string): Promise<DependencyContainer> {
    const dataDb = await this.dataDbClientManager.getDataDatabaseForTable(tableId);
    return await this.getContainerForDataDb(
      dataDb.cacheKey,
      dataDb.connectionUrl ?? dataDb.url,
      dataDb.internalSchema
    );
  }

  isTableQuerySearchVectorRuntimeEnabled(): boolean {
    return (
      resolveTableQuerySearchVectorRuntimeMode(
        this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME') ??
          this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME')
      ) === 'auto'
    );
  }

  async getContainerForMaintenanceTarget(
    target: IComputedOutboxMaintenanceTarget
  ): Promise<DependencyContainer> {
    return this.getContainerForDataDb(
      target.cacheKey,
      target.connectionUrl ?? target.url,
      target.internalSchema
    );
  }

  private async getContainerForDataDb(
    cacheKey: string,
    dataConnectionString: string,
    dataSchema?: string
  ): Promise<DependencyContainer> {
    return await this.runtimeCache.getOrCreate(
      V2_CONTAINER_CACHE_NAMESPACE,
      cacheKey,
      () => this.createContainer(dataConnectionString, dataSchema),
      (container) => this.destroyContainer(container)
    );
  }

  private getMetaConnectionString(): string {
    return (
      this.configService.get<string>('PRISMA_META_DATABASE_URL') ??
      this.configService.get<string>('PRISMA_DATABASE_URL') ??
      this.configService.getOrThrow<string>('DATABASE_URL')
    );
  }

  private async createContainer(
    dataConnectionString: string,
    dataSchema?: string
  ): Promise<DependencyContainer> {
    const metaConnectionString = this.getMetaConnectionString();
    const metaPoolLease = this.pgPoolRegistry.acquire(metaConnectionString);
    const dataPoolLease =
      dataConnectionString === metaConnectionString && !dataSchema
        ? metaPoolLease
        : this.pgPoolRegistry.acquire(dataConnectionString, {
            ...(dataSchema ? { max: Number(process.env.BYODB_DATA_DB_POOL_MAX ?? 5) } : undefined),
          });
    const poolLeases =
      dataPoolLease === metaPoolLease ? [metaPoolLease] : [metaPoolLease, dataPoolLease];

    try {
      const logger = new PinoLoggerAdapter(this.pinoLogger);
      const tracer = new OpenTelemetryTracer();
      const tableQueryObservability = new TableQuerySearchMetricsService();
      const commandBusMiddlewares = [new CommandBusTracingMiddleware()];
      const queryBusMiddlewares = [new QueryBusTracingMiddleware()];
      const computedUpdateMode = process.env.V2_COMPUTED_UPDATE_MODE;
      const tableQueryOps = this.resolveTableQueryOpsOptions();
      const tableMaxRowLimit = resolvePositiveInteger(
        this.configService.get('TABLE_LIMIT_RECORDS_PER_TABLE_MAX')
      );
      const legacyMaxFreeRowLimit = resolvePositiveInteger(
        this.configService.get('MAX_FREE_ROW_LIMIT')
      );
      const computedUpdate: IV2NodePgContainerOptions['computedUpdate'] =
        computedUpdateMode === 'sync'
          ? {
              mode: 'sync',
              fieldBackfillConfig: { mode: 'sync' },
              wakeupPublisher: this.computedOutboxWakeupPublisher,
            }
          : {
              wakeupPublisher: this.computedOutboxWakeupPublisher,
            };

      this.logger.log('Initializing V2 container');

      const container = await createV2NodePgContainer({
        metaConnectionString,
        dataConnectionString,
        dataSchema,
        metaDbDependencies: { pool: metaPoolLease.pool },
        dataDbDependencies: { pool: dataPoolLease.pool },
        logger,
        tracer,
        tableQueryObservability,
        commandBusMiddlewares,
        queryBusMiddlewares,
        computedUpdate,
        tableQueryOps,
        ...(tableMaxRowLimit
          ? { tableMaxRowLimit }
          : legacyMaxFreeRowLimit
            ? { maxFreeRowLimit: legacyMaxFreeRowLimit }
            : {}),
      });

      setSafeFetch(createSsrfSafeFetch());

      registerV2ShareDbRealtime(container, {
        publisher: new ShareDbPubSubPublisher(this.shareDbService.pubsub),
      });
      const attachmentLookupService = container.resolve<IAttachmentLookupService>(
        v2CoreTokens.attachmentLookupService
      );
      container.registerInstance(
        v2CoreTokens.attachmentUrlSignerService,
        new V2AttachmentUrlSignerService(
          this.attachmentsStorageService,
          attachmentLookupService,
          this.cacheService
        )
      );
      const attachmentValueDecoratorService = container.resolve<AttachmentValueDecoratorService>(
        v2CoreTokens.attachmentValueDecoratorService
      );
      container.registerInstance(
        v2CoreTokens.recordChangedValueDecoratorService,
        new V2RecordChangedValueDecoratorService(attachmentValueDecoratorService)
      );
      container.registerInstance(
        v2CoreTokens.undoRedoStore,
        new KeyvUndoRedoStore(this.cacheService.getKeyv(), {
          keyPrefix: 'v2:undo-redo',
          ttlMs: this.thresholdConfig.undoExpirationTime * 1000,
          maxEntries: this.thresholdConfig.maxUndoStackSize,
        })
      );
      registerV2ImportServices(container);
      if (tableQueryOps) {
        this.startTableQueryOpsRunners(container);
      }

      for (const registrar of this.discoverProjectionRegistrars()) {
        registrar.registerProjections(container);
      }

      this.poolLeases.set(container, poolLeases);
      this.logger.log('V2 container initialized');
      return container;
    } catch (error) {
      await Promise.all(poolLeases.map((lease) => lease.release()));
      throw error;
    }
  }

  private resolveTableQueryOpsOptions(): IV2NodePgContainerOptions['tableQueryOps'] | undefined {
    const previewDefaultEnabled = Boolean(this.configService.get('PREVIEW_TAG'));
    if (
      !resolveBoolean(this.configService.get('V2_TABLE_QUERY_OPS_ENABLED'), previewDefaultEnabled)
    ) {
      return undefined;
    }

    const workerId =
      this.configService.get<string>('V2_TABLE_QUERY_OPS_WORKER_ID') ?? `nestjs-${process.pid}`;
    const allowManualIndexExecution = resolveBoolean(
      this.configService.get('V2_TABLE_QUERY_OPS_ALLOW_MANUAL_INDEX_EXECUTION')
    );
    const searchVectorRuntimeEnabled =
      resolveTableQuerySearchVectorRuntimeMode(
        this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME') ??
          this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME')
      ) === 'auto';
    const configuredAllowedKinds =
      parseAllowedRemediationKinds(
        this.configService.get('V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS')
      ) ??
      (allowManualIndexExecution
        ? executablePhase1RemediationKinds
        : searchVectorRuntimeEnabled
          ? ([
              'rebuild_search_vector',
              'manual_investigation',
            ] satisfies ReadonlyArray<ExecutablePhase1RemediationKind>)
          : (['manual_investigation'] satisfies ReadonlyArray<ExecutablePhase1RemediationKind>));
    const allowedKinds = configuredAllowedKinds;
    const analyzerIntervalMs = resolvePositiveInteger(
      this.configService.get('V2_TABLE_QUERY_OPS_ANALYZER_INTERVAL_MS')
    );
    const analyzerLookbackMs = resolvePositiveInteger(
      this.configService.get('V2_TABLE_QUERY_OPS_ANALYZER_LOOKBACK_MS')
    );
    const analyzerBatchSize = resolvePositiveInteger(
      this.configService.get('V2_TABLE_QUERY_OPS_ANALYZER_BATCH_SIZE')
    );
    const taskWorkerIntervalMs = resolvePositiveInteger(
      this.configService.get('V2_TABLE_QUERY_OPS_TASK_WORKER_INTERVAL_MS')
    );
    const sqlSampleMaxLength = resolvePositiveInteger(
      this.configService.get('V2_TABLE_QUERY_OPS_SQL_SAMPLE_MAX_LENGTH')
    );
    const maxDiagnosticsPerObservation = resolvePositiveInteger(
      this.configService.get('V2_TABLE_QUERY_OPS_SQL_DIAGNOSTICS_MAX_PER_OBSERVATION')
    );

    return {
      ensureSchema: resolveBoolean(
        this.configService.get('V2_TABLE_QUERY_OPS_ENSURE_SCHEMA'),
        true
      ),
      sqlDiagnosticsConfig: {
        captureSqlSample: resolveBoolean(
          this.configService.get('V2_TABLE_QUERY_OPS_CAPTURE_SQL_SAMPLE')
        ),
        ...(sqlSampleMaxLength ? { maxSampleLength: sqlSampleMaxLength } : {}),
        ...(maxDiagnosticsPerObservation ? { maxDiagnosticsPerObservation } : {}),
      },
      analyzerConfig: {
        enabled: resolveBoolean(this.configService.get('V2_TABLE_QUERY_OPS_ANALYZER_ENABLED')),
        workerId: `${workerId}:analyzer`,
        ...(analyzerIntervalMs ? { intervalMs: analyzerIntervalMs } : {}),
        ...(analyzerLookbackMs ? { lookbackMs: analyzerLookbackMs } : {}),
        ...(analyzerBatchSize ? { batchSize: analyzerBatchSize } : {}),
      },
      taskWorkerConfig: {
        enabled: resolveBoolean(
          this.configService.get('V2_TABLE_QUERY_OPS_TASK_WORKER_ENABLED'),
          searchVectorRuntimeEnabled
        ),
        workerId: `${workerId}:task-worker`,
        allowManualIndexExecution,
        allowedKinds,
        ...(taskWorkerIntervalMs ? { intervalMs: taskWorkerIntervalMs } : {}),
      },
    };
  }

  private startTableQueryOpsRunners(container: DependencyContainer): void {
    const context = this.createTableQueryOpsContext(container);
    if (!context) return;

    const handles = [
      startTableQueryOpsAnalyzerIfEnabled(container, context),
      startTableQueryOpsTaskWorkerIfEnabled(container, context),
    ].filter((handle): handle is TableQueryOpsRunnerHandle => Boolean(handle));

    if (handles.length === 0) {
      this.logger.log('V2 Table Query Ops registered');
      return;
    }

    this.tableQueryOpsRunnerHandles.set(container, handles);
    this.logger.log(`V2 Table Query Ops started ${handles.length} runner(s)`);
  }

  private createTableQueryOpsContext(
    container: DependencyContainer
  ): IExecutionContext | undefined {
    const actorId = ActorId.create('system');
    if (actorId.isErr()) {
      this.logger.warn(`Failed to create V2 Table Query Ops actor: ${actorId.error.message}`);
      return undefined;
    }

    return {
      actorId: actorId.value,
      tracer: container.resolve(v2CoreTokens.tracer),
      requestId: 'v2-table-query-ops:nest',
      $t: (key) => key,
    };
  }

  private discoverProjectionRegistrars(): IV2ProjectionRegistrar[] {
    const seen = new Set<IV2ProjectionRegistrar>();
    const registrars: IV2ProjectionRegistrar[] = [];

    for (const wrapper of this.discoveryService.getProviders()) {
      const registrar = this.getProjectionRegistrar(wrapper);
      if (!registrar || seen.has(registrar)) {
        continue;
      }

      seen.add(registrar);
      registrars.push(registrar);
    }

    return registrars;
  }

  private getProjectionRegistrar(wrapper: InstanceWrapper): IV2ProjectionRegistrar | null {
    const target =
      !wrapper.metatype || wrapper.inject ? wrapper.instance?.constructor : wrapper.metatype;
    if (!target || !this.reflector.get(V2_PROJECTION_REGISTRAR_METADATA, target)) {
      return null;
    }

    const name = target.name || wrapper.name || String(wrapper.token);
    if (!wrapper.isDependencyTreeStatic()) {
      throw new Error(`V2 projection registrar "${name}" must be statically scoped`);
    }

    if (!isV2ProjectionRegistrar(wrapper.instance)) {
      throw new Error(`V2 projection registrar "${name}" is not instantiated during bootstrap`);
    }

    return wrapper.instance;
  }

  async onModuleDestroy(): Promise<void> {
    await this.runtimeCache.deleteByNamespace(V2_CONTAINER_CACHE_NAMESPACE);
  }

  private async destroyContainer(container: DependencyContainer): Promise<void> {
    this.stopTableQueryOpsRunners(container);
    const poolLeases = this.poolLeases.get(container) ?? [];
    this.poolLeases.delete(container);
    const closers = Array.from(
      new Set([
        container.resolve<{ destroy(): Promise<void> }>(v2MetaDbTokens.db),
        container.resolve<{ destroy(): Promise<void> }>(v2DataDbTokens.db),
      ])
    );
    try {
      await Promise.all(closers.map((db) => db.destroy()));
    } finally {
      await Promise.all(poolLeases.map((lease) => lease.release()));
    }
  }

  private stopTableQueryOpsRunners(container: DependencyContainer): void {
    const handles = this.tableQueryOpsRunnerHandles.get(container);
    if (!handles) return;

    for (const handle of handles) {
      handle.stop();
    }
    this.tableQueryOpsRunnerHandles.delete(container);
  }
}
