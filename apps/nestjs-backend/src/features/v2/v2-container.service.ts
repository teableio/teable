import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, ModuleRef, Reflector } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { COMPUTE_ACTIVITY_CHANGED, getActionTriggerChannel } from '@teable/core';
import type { IPgPoolLease } from '@teable/db-main-prisma';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ShareDbBackendPresencePublisher,
  ShareDbPubSubPublisher,
  registerV2ShareDbRealtime,
  v2ShareDbTokens,
} from '@teable/v2-adapter-realtime-sharedb';
import {
  DomainEventOutboxWorker,
  IComputedOutboxWakeupPublisher,
  IDomainEventWakeupPublisher,
  noopComputedOutboxWakeupPublisher,
  noopDomainEventWakeupPublisher,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';
import { KeyvUndoRedoStore } from '@teable/v2-adapter-undo-redo-keyv';
import {
  createV2NodePgContainer,
  disposeV2NodePgContainer,
  type IV2NodePgContainerOptions,
} from '@teable/v2-container-node';
import type {
  AttachmentValueDecoratorService,
  AsyncMemoryEventBus,
  IAttachmentLookupService,
  IComputedOutboxAdmin,
  IExecutionContext,
  IDurableProjectionHandler,
  ProjectionMessageJson,
} from '@teable/v2-core';
import {
  ActorId,
  getDurableProjectionRegistrations,
  ProjectionMessageCodecRegistry,
  ViewDeleted,
  v2CoreTokens,
  viewDeletedProjectionCodec,
} from '@teable/v2-core';
import type { DependencyContainer, InjectionToken } from '@teable/v2-di';
import { registerV2ImportServices } from '@teable/v2-import';
import {
  executablePhase1RemediationKindValues,
  startTableQueryOpsAnalyzerIfEnabled,
  startTableQueryOpsManualSearchTaskWorker,
  startTableQueryOpsTaskWorkerIfEnabled,
  TableQueryOpsExecutionUnavailableError,
  type ExecutablePhase1RemediationKind,
  type TableQueryOpsRunnerHandle,
} from '@teable/v2-table-query-ops';
import { createSsrfSafeFetch, setSafeFetch } from '@teable/v2-utils';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { CacheService } from '../../cache/cache.service';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import {
  resolveByodbDataDbPoolSettings,
  resolveByodbSchemaCoordinationSettings,
} from '../../global/byodb-data-db-pool-budget';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import type {
  IComputedOutboxMaintenanceTarget,
  IDataDbRoutingSnapshot,
} from '../../global/data-db-client-manager.service';
import {
  DataDbRuntimeCacheService,
  V2_CONTAINER_CACHE_NAMESPACE,
} from '../../global/data-db-runtime-cache.service';
import { classifyDataDbRuntimeError } from '../../global/data-db-runtime-error';
import { classifyDatabaseError } from '../../observability/database-health/database-error-classification';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { ATTACHMENT_PUBLIC_LINK_HOOK } from './attachment-public-link.hook';
import type { IAttachmentPublicLinkHook } from './attachment-public-link.hook';
import { ComputedOutboxClaimConcurrencyService } from './computed-outbox-trigger/computed-outbox-claim-concurrency.service';
import {
  createComputedWriterHandle,
  type ComputedWriterHandle,
} from './computed-outbox-trigger/computed-writer-handle';
import {
  COMPUTED_OUTBOX_ADMIN,
  COMPUTED_OUTBOX_WAKEUP_PUBLISHER,
} from './computed-outbox-trigger/constants';
import { DOMAIN_EVENT_OUTBOX_WAKEUP_PUBLISHER } from './domain-event-outbox-trigger/constants';
import { TableQueryObservationRuntimeService } from './table-query-observation-runtime.service';
import { TableQuerySearchMetricsService } from './table-query-search-observability';
import { resolveTableQuerySearchVectorRuntimeMode } from './table-query-search-vector-runtime.service';
import {
  publishActorColumnsMetadata,
  registerActorColumnsEnableHandler,
} from './v2-actor-columns-registration';
import { V2AttachmentUrlSignerService } from './v2-attachment-url-signer.service';
import { CommandBusTracingMiddleware } from './v2-command-bus-tracing.middleware';
import { resolveBoolean, resolvePositiveInteger } from './v2-config-parsers';
import { PinoLoggerAdapter } from './v2-logger.adapter';
import {
  V2_PROJECTION_REGISTRAR_METADATA,
  isV2ProjectionRegistrar,
  type IV2ProjectionRegistrar,
} from './v2-projection-registrar';
import { QueryBusTracingMiddleware } from './v2-query-bus-tracing.middleware';
import { V2QueryCancellationMiddleware } from './v2-query-cancellation.middleware';
import { V2RecordChangedValueDecoratorService } from './v2-record-changed-value-decorator.service';
import { OpenTelemetryTracer } from './v2-tracer.adapter';
import { NestVcsAccessPolicy } from './vcs/nest-vcs-access-policy.service';

const TABLE_QUERY_MAINTENANCE_CACHE_NAMESPACE = 'v2:table-query-maintenance';

const resolveNonNegativeInteger = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const resolveTableQueryOpsWorkerId = (configured: unknown): string => {
  const hostname = process.env.HOSTNAME?.trim();
  const instanceId = hostname && hostname.length > 0 ? hostname : String(process.pid);
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return `${configured.trim()}:${instanceId}`;
  }
  return `nestjs-${instanceId}`;
};

const isTableQueryOpsConnectionUnavailable = (error: unknown): boolean => {
  // Routing/migration and container acquisition preserve raw pg errors; domain or
  // driver wrappers can retain them as causes. Classifiers inspect one error only.
  const seen = new Set<unknown>();
  let candidate = error;
  let unavailable = false;
  while (candidate && typeof candidate === 'object' && !seen.has(candidate)) {
    seen.add(candidate);
    const errorRecord = candidate as { message?: unknown; cause?: unknown; code?: unknown };
    const runtime = classifyDataDbRuntimeError(candidate);
    const classification = classifyDatabaseError(candidate, {
      // The runtime taxonomy groups statement cancellation with connection timeouts.
      // Let the database classifier distinguish them before admitting a deferral.
      dataDbClassification: runtime?.code === 'data_db.timeout' ? null : runtime,
    });
    const code = classification.pgCode ?? classification.driverCode;
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : '';
    if (
      errorRecord.code === 'TABLE_QUERY_OPS_STATEMENT_TIMEOUT' ||
      (code === '55000' &&
        /^database "[^"]+" is not currently accepting connections$/.test(message))
    ) {
      unavailable = true;
    } else if (
      classification.errorClass === 'connection_failed' ||
      classification.errorClass === 'connection_lost' ||
      classification.errorClass === 'connection_timeout' ||
      classification.errorClass === 'pool_exhausted'
    ) {
      unavailable = true;
    } else if (
      code === '55000' ||
      (classification.errorClass !== 'other' && classification.errorClass !== 'unclassified')
    ) {
      // A known permanent failure or statement cancellation must not be hidden by a cause.
      return false;
    }
    candidate = errorRecord.cause;
  }
  return unavailable;
};

// Default is shadow: decisions and reasons are logged for the admin page without
// executing any DDL until V2_TABLE_QUERY_OPS_AUTO_ACCEPT=auto is set explicitly.
export const resolveTableQueryAutoAcceptMode = (value: unknown): 'off' | 'shadow' | 'auto' => {
  if (typeof value !== 'string') return 'shadow';
  const normalized = value.trim().toLowerCase();
  return normalized === 'auto' || normalized === 'off' ? normalized : 'shadow';
};

const buildComputedUpdateOptions = (
  computedUpdateMode: string | undefined,
  wakeupPublisher: NonNullable<IV2NodePgContainerOptions['computedUpdate']>['wakeupPublisher'],
  outboxConfig?: NonNullable<IV2NodePgContainerOptions['computedUpdate']>['outboxConfig'],
  runtimeConfig?: NonNullable<IV2NodePgContainerOptions['computedUpdate']>['runtimeConfig']
): IV2NodePgContainerOptions['computedUpdate'] => {
  const shared = {
    wakeupPublisher,
    ...(outboxConfig && Object.keys(outboxConfig).length > 0 ? { outboxConfig } : {}),
    ...(runtimeConfig && Object.keys(runtimeConfig).length > 0 ? { runtimeConfig } : {}),
  };
  if (computedUpdateMode === 'sync') {
    return {
      mode: 'sync',
      fieldBackfillConfig: { mode: 'sync' },
      ...shared,
    };
  }
  return shared;
};

const executablePhase1RemediationKinds = [
  ...executablePhase1RemediationKindValues,
] as const satisfies ReadonlyArray<ExecutablePhase1RemediationKind>;

export const tableQueryOpsSearchMaintenanceEnv = 'V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED';

/**
 * Search access path work a table write or an idle-path reclaim enqueues. Executing only these
 * keeps a configured search document from going stale when the advisor stack stays off.
 */
const searchAccessPathMaintenanceKinds = [
  'create_search_access_path',
  'rebuild_search_access_path',
  'drop_search_access_path',
] as const satisfies ReadonlyArray<ExecutablePhase1RemediationKind>;

const defaultAllowedRemediationKinds = (input: {
  readonly allowIndexExecution: boolean;
  readonly searchVectorRuntimeEnabled: boolean;
}): ReadonlyArray<ExecutablePhase1RemediationKind> => {
  if (input.allowIndexExecution) return executablePhase1RemediationKinds;
  if (input.searchVectorRuntimeEnabled) {
    // Schema-change maintenance and reclaim share the search runtime worker.
    return [
      'rebuild_search_access_path',
      'rebuild_search_vector',
      'drop_search_access_path',
      'manual_investigation',
    ];
  }
  return ['manual_investigation'];
};

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

/** The public link hook a registrar put in the container, if any. */
const resolvePublicLinkHook = (
  container: DependencyContainer
): IAttachmentPublicLinkHook | undefined =>
  container.isRegistered(ATTACHMENT_PUBLIC_LINK_HOOK)
    ? container.resolve<IAttachmentPublicLinkHook>(ATTACHMENT_PUBLIC_LINK_HOOK)
    : undefined;

@Injectable()
export class V2ContainerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(V2ContainerService.name);
  private readonly byodbPoolSettings = resolveByodbDataDbPoolSettings();
  private readonly tableQueryOpsRunnerHandles = new WeakMap<
    DependencyContainer,
    ReadonlyArray<TableQueryOpsRunnerHandle>
  >();
  private tableQueryOpsMaintenanceOverridesWarned = false;
  private readonly poolLeases = new WeakMap<DependencyContainer, ReadonlyArray<IPgPoolLease>>();
  private readonly computedWriters = new WeakMap<DependencyContainer, ComputedWriterHandle>();
  private readonly claimConcurrencyUnregisters = new WeakMap<DependencyContainer, () => void>();
  private readonly containerRouteSignatures = new WeakMap<DependencyContainer, string>();
  private readonly containersPendingTableQueryOpsRunners = new WeakSet<DependencyContainer>();
  private readonly eventRuntimes = new Map<
    DependencyContainer,
    { commands: CommandBusTracingMiddleware; events: AsyncMemoryEventBus }
  >();
  private eventDrainPromise?: Promise<boolean>;

  constructor(
    private readonly configService: ConfigService,
    private readonly pinoLogger: PinoLogger,
    @Inject(ShareDbService)
    private readonly shareDbService: ShareDbService,
    private readonly cacheService: CacheService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly reflector: Reflector,
    private readonly discoveryService: DiscoveryService,
    private readonly moduleRef: ModuleRef,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly runtimeCache: DataDbRuntimeCacheService,
    private readonly pgPoolRegistry: PgPoolRegistry,
    private readonly tableQueryObservationRuntime: TableQueryObservationRuntimeService,
    private readonly cls: ClsService<IClsStore>,
    @Optional()
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly computedOutboxWakeupPublisher: IComputedOutboxWakeupPublisher = noopComputedOutboxWakeupPublisher,
    @Optional()
    @Inject(DOMAIN_EVENT_OUTBOX_WAKEUP_PUBLISHER)
    private readonly domainEventWakeupPublisher: IDomainEventWakeupPublisher = noopDomainEventWakeupPublisher,
    @Optional()
    private readonly claimConcurrency?: ComputedOutboxClaimConcurrencyService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.getContainer();
  }

  async getContainer(): Promise<DependencyContainer> {
    return await this.getContainerForDataDb('meta-fallback', this.getMetaConnectionString());
  }

  /** Metadata-only preview acquisition also stays non-migrating after cache eviction. */
  async getPreviewContainer(): Promise<DependencyContainer> {
    const connectionString = this.getMetaConnectionString();
    return this.runtimeCache.getOrCreate(
      V2_CONTAINER_CACHE_NAMESPACE,
      'meta-fallback',
      async () => {
        const created = await this.createContainer(connectionString, undefined, {
          previewReadOnly: true,
        });
        this.containerRouteSignatures.set(created, this.containerRouteSignature(connectionString));
        return created;
      },
      (created) => this.destroyContainer(created)
    );
  }

  async getContainerForSpace(spaceId: string): Promise<DependencyContainer> {
    const dataDb = await this.dataDbClientManager.getDataDatabaseForSpace(spaceId);
    return await this.getContainerForDataDb(
      dataDb.cacheKey,
      dataDb.connectionUrl ?? dataDb.url,
      dataDb.internalSchema
    );
  }

  async getContainerForRoutingSnapshot(
    snapshot: IDataDbRoutingSnapshot
  ): Promise<DependencyContainer> {
    const dataDb = await this.dataDbClientManager.getDataDatabaseFromRoutingSnapshot(snapshot);
    return this.getContainerForDataDb(
      dataDb.cacheKey,
      dataDb.connectionUrl ?? dataDb.url,
      dataDb.internalSchema
    );
  }

  getComputedWriter(container: DependencyContainer) {
    const writer = this.computedWriters.get(container);
    if (!writer) throw new Error('Computed writer has no active data pool');
    return writer;
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

  /**
   * Resolves only a metadata-proven current route. A cold route may initialize the same cached
   * container used by normal requests, but initialization is explicitly non-migrating and does
   * not start background workers. A later normal acquisition promotes that container's workers.
   */
  async getPreviewContainerForTable(tableId: string): Promise<DependencyContainer | null> {
    const dataDb = await this.dataDbClientManager.getDataDatabaseForTablePreviewReadOnly(tableId);
    if (!dataDb) return null;
    const dataConnectionString = dataDb.connectionUrl ?? dataDb.url;
    const signature = this.containerRouteSignature(dataConnectionString, dataDb.internalSchema);
    const cached = await this.runtimeCache.get<DependencyContainer>(
      V2_CONTAINER_CACHE_NAMESPACE,
      dataDb.cacheKey
    );
    if (cached) {
      return this.containerRouteSignatures.get(cached) === signature ? cached : null;
    }

    const container = await this.runtimeCache.getOrCreate(
      V2_CONTAINER_CACHE_NAMESPACE,
      dataDb.cacheKey,
      async () => {
        const created = await this.createContainer(dataConnectionString, dataDb.internalSchema, {
          previewReadOnly: true,
        });
        this.containerRouteSignatures.set(created, signature);
        return created;
      },
      (created) => this.destroyContainer(created)
    );
    return this.containerRouteSignatures.get(container) === signature ? container : null;
  }

  isTableQuerySearchVectorRuntimeEnabled(): boolean {
    return (
      resolveTableQuerySearchVectorRuntimeMode(
        this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME') ??
          this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME')
      ) === 'auto'
    );
  }

  isSearchAccessPathManualExecutionEnabled(): boolean {
    // Management always registers the dedicated manual runner, independently of
    // automatic analysis, policy acceptance, and the general task worker switch.
    return resolveBoolean(this.configService.get('V2_TABLE_QUERY_OPS_ENABLED'), false);
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

  private resolveComputedOutboxAdmin(): IComputedOutboxAdmin | undefined {
    try {
      return this.moduleRef.get<IComputedOutboxAdmin>(COMPUTED_OUTBOX_ADMIN, { strict: false });
    } catch {
      return undefined;
    }
  }

  private async getContainerForDataDb(
    cacheKey: string,
    dataConnectionString: string,
    dataSchema?: string
  ): Promise<DependencyContainer> {
    const container = await this.runtimeCache.getOrCreate(
      V2_CONTAINER_CACHE_NAMESPACE,
      cacheKey,
      async () => {
        const created = await this.createContainer(dataConnectionString, dataSchema);
        this.containerRouteSignatures.set(
          created,
          this.containerRouteSignature(dataConnectionString, dataSchema)
        );
        return created;
      },
      (created) => this.destroyContainer(created)
    );
    if (this.containersPendingTableQueryOpsRunners.has(container)) {
      this.startTableQueryOpsRunners(container);
      this.containersPendingTableQueryOpsRunners.delete(container);
    }
    return container;
  }

  private containerRouteSignature(dataConnectionString: string, dataSchema?: string): string {
    return `${dataConnectionString}\u0000${dataSchema ?? ''}`;
  }

  private getMetaConnectionString(): string {
    return (
      this.configService.get<string>('PRISMA_META_DATABASE_URL') ??
      this.configService.get<string>('PRISMA_DATABASE_URL') ??
      this.configService.getOrThrow<string>('DATABASE_URL')
    );
  }

  private acquireDataPoolLease(
    dataConnectionString: string,
    metaConnectionString: string,
    metaPoolLease: IPgPoolLease,
    dataSchema?: string
  ): IPgPoolLease {
    if (dataConnectionString === metaConnectionString && !dataSchema) {
      return metaPoolLease;
    }
    return this.pgPoolRegistry.acquire(dataConnectionString, {
      ...(dataSchema ? this.byodbPoolSettings : undefined),
    });
  }

  /**
   * A coordination pool is created per cached data-database container and uses
   * the **meta** connection string, so the process-wide coordination connections
   * are `containers × maxConnections` against the meta server — not against the
   * BYODB customer database.
   *
   * BYODB containers use the larger coordination default and a short acquire
   * timeout (`resolveByodbSchemaCoordinationSettings`), because their lease can
   * span a customer data-pool wait; the meta-server budget must still fit
   * `pods × warm containers × maxConnections`. Shared-database containers keep
   * the adapter defaults unless the deployment sets the knobs explicitly.
   */
  private resolveSchemaCoordinationOptions(
    isByodb: boolean
  ): { connectionTimeoutMillis?: number; maxConnections?: number } | undefined {
    const maxConnections = resolvePositiveInteger(
      this.configService.get('V2_SCHEMA_COORDINATION_MAX_CONNECTIONS')
    );
    const connectionTimeoutMillis = resolveNonNegativeInteger(
      this.configService.get('V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS')
    );
    if (isByodb) {
      const settings = resolveByodbSchemaCoordinationSettings({
        ...process.env,
        ...(maxConnections !== undefined
          ? { V2_SCHEMA_COORDINATION_MAX_CONNECTIONS: String(maxConnections) }
          : {}),
        ...(connectionTimeoutMillis !== undefined
          ? { V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS: String(connectionTimeoutMillis) }
          : {}),
      });
      return {
        maxConnections: settings.maxConnections,
        connectionTimeoutMillis: settings.connectionTimeoutMillis,
      };
    }
    if (maxConnections === undefined && connectionTimeoutMillis === undefined) {
      return undefined;
    }
    return {
      ...(maxConnections !== undefined ? { maxConnections } : {}),
      ...(connectionTimeoutMillis !== undefined ? { connectionTimeoutMillis } : {}),
    };
  }

  private resolveComputedOutboxAdminOption(): {
    computedOutboxAdmin?: IComputedOutboxAdmin;
  } {
    const computedOutboxAdmin = this.resolveComputedOutboxAdmin();
    return computedOutboxAdmin ? { computedOutboxAdmin } : {};
  }

  private resolveTableRowLimitOption(): {
    tableMaxRowLimit?: number;
    maxFreeRowLimit?: number;
  } {
    const tableMaxRowLimit = resolvePositiveInteger(
      this.configService.get('TABLE_LIMIT_RECORDS_PER_TABLE_MAX')
    );
    if (tableMaxRowLimit) return { tableMaxRowLimit };
    const legacyMaxFreeRowLimit = resolvePositiveInteger(
      this.configService.get('MAX_FREE_ROW_LIMIT')
    );
    if (legacyMaxFreeRowLimit) return { maxFreeRowLimit: legacyMaxFreeRowLimit };
    return {};
  }

  private bindNestVcsAccessPolicy(container: DependencyContainer): void {
    try {
      this.moduleRef?.get(NestVcsAccessPolicy, { strict: false })?.registerOnContainer(container);
    } catch {
      // Optional in isolated container unit tests without Nest V2Module.
    }
  }

  private resolveContainerComputedUpdateOptions() {
    const computedUpdateMode = process.env.V2_COMPUTED_UPDATE_MODE;
    const taskStatementTimeoutMs = resolveNonNegativeInteger(
      this.configService.get('V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS')
    );
    const inlineStatementTimeoutMs = resolveNonNegativeInteger(
      this.configService.get('V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS')
    );
    const fieldBackfillBatchSize = resolvePositiveInteger(
      this.configService.get('V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE')
    );
    const continuationRelayClaimEnabled = resolveBoolean(
      this.configService.get('V2_COMPUTED_OUTBOX_CONTINUATION_RELAY_CLAIM_ENABLED'),
      true
    );
    const lockStarvationEscalationAgeMs = resolveNonNegativeInteger(
      this.configService.get('V2_COMPUTED_OUTBOX_LOCK_STARVATION_ESCALATION_AGE_MS')
    );
    const lockStarvationEscalationWaitMs = resolveNonNegativeInteger(
      this.configService.get('V2_COMPUTED_OUTBOX_LOCK_STARVATION_ESCALATION_WAIT_MS')
    );
    const claimDefaults = this.claimConcurrency?.processDefault;
    return buildComputedUpdateOptions(
      computedUpdateMode,
      this.computedOutboxWakeupPublisher,
      {
        ...(taskStatementTimeoutMs !== undefined ? { taskStatementTimeoutMs } : {}),
        ...(fieldBackfillBatchSize !== undefined ? { fieldBackfillBatchSize } : {}),
        ...(lockStarvationEscalationAgeMs !== undefined ? { lockStarvationEscalationAgeMs } : {}),
        ...(lockStarvationEscalationWaitMs !== undefined ? { lockStarvationEscalationWaitMs } : {}),
        continuationRelayClaimEnabled,
        ...(claimDefaults
          ? {
              maxConcurrentProcessingPerBase: claimDefaults.perBase,
              maxConcurrentProcessingPerSeedTable: claimDefaults.perSeedTable,
            }
          : {}),
      },
      inlineStatementTimeoutMs !== undefined ? { inlineStatementTimeoutMs } : undefined
    );
  }

  private async createContainer(
    dataConnectionString: string,
    dataSchema?: string,
    options: { previewReadOnly?: boolean; maintenance?: boolean } = {}
  ): Promise<DependencyContainer> {
    const metaConnectionString = this.getMetaConnectionString();
    const metaPoolLease = options.maintenance
      ? undefined
      : this.pgPoolRegistry.acquire(metaConnectionString);
    const dataPoolLease = metaPoolLease
      ? this.acquireDataPoolLease(
          dataConnectionString,
          metaConnectionString,
          metaPoolLease,
          dataSchema
        )
      : undefined;
    const poolLeases = metaPoolLease
      ? dataPoolLease && dataPoolLease !== metaPoolLease
        ? [metaPoolLease, dataPoolLease]
        : [metaPoolLease]
      : [];
    let createdContainer: DependencyContainer | undefined;

    try {
      const logger = new PinoLoggerAdapter(this.pinoLogger);
      const tracer = new OpenTelemetryTracer();
      const tableQueryObservability = new TableQuerySearchMetricsService();
      const commands = new CommandBusTracingMiddleware();
      const commandBusMiddlewares = [commands];
      const queryBusMiddlewares = [
        new QueryBusTracingMiddleware(),
        new V2QueryCancellationMiddleware(this.cls),
      ];
      const tableQueryOps = await this.resolveContainerTableQueryOpsOptions(options);
      const computedUpdate = this.resolveContainerComputedUpdateOptions();

      this.logger.log('Initializing V2 container');
      const schemaCoordination = this.resolveSchemaCoordinationOptions(Boolean(dataSchema));
      const maintenanceDeadlineMs =
        resolvePositiveInteger(
          this.configService.get('V2_TABLE_QUERY_OPS_MAINTENANCE_STATEMENT_DEADLINE_MS')
        ) ?? 6 * 60 * 60 * 1000;
      const container = await createV2NodePgContainer({
        metaConnectionString,
        dataConnectionString,
        dataSchema,
        ...(options.previewReadOnly ? { ensureSchema: false } : {}),
        metaDbDependencies: options.maintenance
          ? { maintenanceStatementDeadlineMs: maintenanceDeadlineMs }
          : { pool: metaPoolLease!.pool },
        dataDbDependencies: options.maintenance
          ? { maintenanceStatementDeadlineMs: maintenanceDeadlineMs }
          : { pool: dataPoolLease!.pool },
        logger,
        tracer,
        tableQueryObservability,
        commandBusMiddlewares,
        queryBusMiddlewares,
        computedUpdate,
        tableQueryOps,
        domainEventWakeupPublisher: this.domainEventWakeupPublisher,
        // The postgres adapter writes record_trash markers inside the v2 delete
        // transaction, so the delete-undo purge guard is sound here.
        undoRedoRestorePurgeGuard: true,
        ...this.resolveComputedOutboxAdminOption(),
        schemaCoordination: options.maintenance ? false : schemaCoordination,
        ...this.resolveTableRowLimitOption(),
      });
      createdContainer = container;
      if (!options.previewReadOnly) {
        registerActorColumnsEnableHandler(
          container,
          dataConnectionString,
          dataSchema,
          (_context, target) => publishActorColumnsMetadata(this.shareDbService, this.cls, target)
        );
      }

      registerV2ShareDbRealtime(container, {
        publisher: new ShareDbPubSubPublisher(this.shareDbService.pubsub),
        presence: new ShareDbBackendPresencePublisher(this.shareDbService),
        computeActivitySignal: {
          resolveChannel: getActionTriggerChannel,
          actionKey: COMPUTE_ACTIVITY_CHANGED,
        },
      });
      const attachmentLookupService = container.resolve<IAttachmentLookupService>(
        v2CoreTokens.attachmentLookupService
      );
      container.registerInstance(
        v2CoreTokens.attachmentUrlSignerService,
        new V2AttachmentUrlSignerService(
          this.attachmentsStorageService,
          attachmentLookupService,
          this.cacheService,
          () => resolvePublicLinkHook(container)
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
      const importFetch = createSsrfSafeFetch();
      // Legacy ImportCsv/Papaparse paths still resolve the process registry.
      setSafeFetch(importFetch);
      registerV2ImportServices(container, { fetch: importFetch });
      this.bindNestVcsAccessPolicy(container);
      if (tableQueryOps && !options.maintenance) {
        this.registerTableQueryOpsRunners(container, options.previewReadOnly);
      }

      for (const registrar of this.discoverProjectionRegistrars()) {
        registrar.registerProjections(container);
      }
      const metadataHandlers = new Map<string, IDurableProjectionHandler<ProjectionMessageJson>>();
      for (const registration of getDurableProjectionRegistrations()) {
        if (registration.event !== ViewDeleted) continue;
        metadataHandlers.set(
          registration.id,
          container.resolve(
            registration.handler as InjectionToken<IDurableProjectionHandler<ProjectionMessageJson>>
          )
        );
      }
      const metadataCodecs = ProjectionMessageCodecRegistry.create([viewDeletedProjectionCodec]);
      if (metadataCodecs.isErr()) throw new Error(metadataCodecs.error.message);
      container.registerInstance(
        v2RecordRepositoryPostgresTokens.metadataDomainEventOutboxWorker,
        new DomainEventOutboxWorker(
          container.resolve(v2MetaDbTokens.db),
          metadataHandlers,
          metadataCodecs.value,
          logger,
          undefined,
          undefined,
          {
            transactionScope: 'meta',
            destinationInboxExists: async ({ eventId, consumerId, message }) => {
              if (
                !message ||
                typeof message !== 'object' ||
                !('tableId' in message) ||
                typeof message.tableId !== 'string'
              ) {
                throw new Error('Metadata delivery is missing its destination table identity');
              }
              const destination = await this.dataDbClientManager.dataPrismaForTable(
                message.tableId
              );
              const receipts = await destination.$queryRawUnsafe<{ exists: boolean }[]>(
                'SELECT true AS exists FROM domain_event_inbox WHERE consumer_id = $1 AND event_id = $2 LIMIT 1',
                consumerId,
                eventId
              );
              return receipts.length > 0;
            },
          }
        )
      );

      // Only primary-storage containers follow the runtime claim-cap override;
      // BYODB pools are sized against the env defaults at deploy time.
      if (this.claimConcurrency && metaPoolLease && dataPoolLease === metaPoolLease) {
        const outboxConfig = container.resolve<ComputedUpdateOutboxConfig>(
          v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig
        );
        this.claimConcurrencyUnregisters.set(
          container,
          this.claimConcurrency.registerOutboxConfig(outboxConfig)
        );
      }

      this.poolLeases.set(container, poolLeases);
      if (dataPoolLease) {
        this.computedWriters.set(
          container,
          createComputedWriterHandle(dataPoolLease.pool, dataConnectionString)
        );
      }
      this.eventRuntimes.set(container, {
        commands,
        events: container.resolve<AsyncMemoryEventBus>(v2CoreTokens.eventBus),
      });
      this.logger.log('V2 container initialized');
      return container;
    } catch (error) {
      if (createdContainer) {
        try {
          await disposeV2NodePgContainer(createdContainer);
        } catch (cleanupError) {
          this.logger.error(
            'Failed to dispose partially initialized V2 PostgreSQL container',
            cleanupError instanceof Error ? cleanupError.stack : String(cleanupError)
          );
        }
      }
      await Promise.all(poolLeases.map((lease) => lease.release()));
      throw error;
    }
  }

  /**
   * Table query ops options for a new container. Preview initialization stays non-migrating: it
   * never initializes the observation runtime and disables schema work.
   */
  private async resolveContainerTableQueryOpsOptions(options: {
    previewReadOnly?: boolean;
  }): Promise<IV2NodePgContainerOptions['tableQueryOps']> {
    const resolved = this.resolveTableQueryOpsOptions();
    if (!resolved) return undefined;
    const { options: config, searchMaintenanceOnly } = resolved;
    if (searchMaintenanceOnly) {
      // Search access path maintenance owns no observation pipeline: no runtime connection,
      // no per-query observation shaping, no analyzer.
      return {
        ...config,
        ensureSchema: options.previewReadOnly ? false : config.ensureSchema,
        ensureObservationSchema: false,
        observationDisabled: true,
        skipRecordQueryObservation: true,
      };
    }
    const observationRuntime = options.previewReadOnly
      ? undefined
      : await this.tableQueryObservationRuntime.get();
    return {
      ...config,
      ensureSchema: options.previewReadOnly ? false : config.ensureSchema,
      ensureObservationSchema: false,
      observationPublisher: this.tableQueryObservationRuntime,
      observationReader: this.tableQueryObservationRuntime,
      observationSink: this.tableQueryObservationRuntime,
      ...(observationRuntime
        ? { observationDb: observationRuntime.db }
        : { observationDisabled: true }),
    };
  }

  /** Preview containers park their runners until a normal request promotes the container. */
  private registerTableQueryOpsRunners(
    container: DependencyContainer,
    previewReadOnly: boolean | undefined
  ): void {
    if (previewReadOnly) {
      this.containersPendingTableQueryOpsRunners.add(container);
      return;
    }
    this.startTableQueryOpsRunners(container);
  }

  private warnIgnoredTableQueryOpsOverrides(searchMaintenanceOnly: boolean): void {
    if (!searchMaintenanceOnly || this.tableQueryOpsMaintenanceOverridesWarned) return;
    const ignored = [
      'V2_TABLE_QUERY_OPS_AUTO_ACCEPT',
      'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED',
      'V2_TABLE_QUERY_OPS_ALLOW_MANUAL_INDEX_EXECUTION',
      'V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS',
    ].filter((key) => this.configService.get(key));
    if (ignored.length === 0) return;
    this.tableQueryOpsMaintenanceOverridesWarned = true;
    this.logger.warn(
      `${tableQueryOpsSearchMaintenanceEnv} runs search access path maintenance only; ` +
        `${ignored.join(', ')} are ignored until V2_TABLE_QUERY_OPS_ENABLED is enabled`
    );
  }

  private resolveTableQueryOpsOptions():
    | {
        readonly options: NonNullable<IV2NodePgContainerOptions['tableQueryOps']>;
        readonly searchMaintenanceOnly: boolean;
      }
    | undefined {
    const opsEnabled = resolveBoolean(this.configService.get('V2_TABLE_QUERY_OPS_ENABLED'), false);
    if (opsEnabled) {
      return { searchMaintenanceOnly: false, options: this.resolveFullTableQueryOpsOptions() };
    }
    if (!resolveBoolean(this.configService.get(tableQueryOpsSearchMaintenanceEnv), false)) {
      return undefined;
    }
    // Without the full feature the deployment only executes search access path maintenance
    // tasks, so observation, analyzer, auto-accept and index execution stay off.
    this.warnIgnoredTableQueryOpsOverrides(true);
    return {
      searchMaintenanceOnly: true,
      options: this.resolveSearchMaintenanceOnlyOptions(),
    };
  }

  private resolveSearchMaintenanceOnlyOptions(): NonNullable<
    IV2NodePgContainerOptions['tableQueryOps']
  > {
    const workerId = resolveTableQueryOpsWorkerId(
      this.configService.get('V2_TABLE_QUERY_OPS_WORKER_ID')
    );
    const taskWorkerIntervalMs = resolvePositiveInteger(
      this.configService.get('V2_TABLE_QUERY_OPS_TASK_WORKER_INTERVAL_MS')
    );
    return {
      searchMaintenance: this.resolveSearchMaintenanceOptions(),
      ensureSchema: resolveBoolean(
        this.configService.get('V2_TABLE_QUERY_OPS_ENSURE_SCHEMA'),
        true
      ),
      decisionPolicyConfig: { autoAcceptMode: 'off' },
      analyzerConfig: {
        enabled: false,
        workerId: `${workerId}:analyzer`,
        intervalMs: 5 * 60 * 1000,
      },
      taskWorkerConfig: {
        enabled: true,
        scope: 'search_maintenance',
        workerId: `${workerId}:task-worker`,
        allowManualIndexExecution: false,
        allowPolicyIndexExecution: false,
        allowedKinds: searchAccessPathMaintenanceKinds,
        ...(taskWorkerIntervalMs ? { intervalMs: taskWorkerIntervalMs } : {}),
      },
    };
  }

  private resolveSearchMaintenanceOptions() {
    return {
      isConnectionUnavailable: isTableQueryOpsConnectionUnavailable,
      windowUtc: this.configService.get<string>('V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_WINDOW_UTC'),
      knownSmallRowCap:
        resolvePositiveInteger(
          this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_SMALL_ROW_CAP')
        ) ?? 5000,
      allowUnknownOrLargeRewrite: resolveBoolean(
        this.configService.get(
          'V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ALLOW_UNKNOWN_OR_LARGE_REWRITE'
        ),
        false
      ),
    };
  }

  private resolveFullTableQueryOpsOptions(): NonNullable<
    IV2NodePgContainerOptions['tableQueryOps']
  > {
    const workerId = resolveTableQueryOpsWorkerId(
      this.configService.get('V2_TABLE_QUERY_OPS_WORKER_ID')
    );
    const allowManualIndexExecution = resolveBoolean(
      this.configService.get('V2_TABLE_QUERY_OPS_ALLOW_MANUAL_INDEX_EXECUTION')
    );
    const autoAcceptMode = resolveTableQueryAutoAcceptMode(
      this.configService.get('V2_TABLE_QUERY_OPS_AUTO_ACCEPT')
    );
    const policyAutoExecutionEnabled = autoAcceptMode === 'auto';
    const allowIndexExecution = allowManualIndexExecution || policyAutoExecutionEnabled;
    const searchVectorRuntimeEnabled =
      resolveTableQuerySearchVectorRuntimeMode(
        this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME') ??
          this.configService.get('V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME')
      ) === 'auto';
    const allowedKinds =
      parseAllowedRemediationKinds(
        this.configService.get('V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS')
      ) ?? defaultAllowedRemediationKinds({ allowIndexExecution, searchVectorRuntimeEnabled });
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
      searchMaintenance: this.resolveSearchMaintenanceOptions(),
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
      decisionPolicyConfig: {
        autoAcceptMode,
      },
      analyzerConfig: {
        enabled: resolveBoolean(
          this.configService.get('V2_TABLE_QUERY_OPS_ANALYZER_ENABLED'),
          false
        ),
        workerId: `${workerId}:analyzer`,
        intervalMs: analyzerIntervalMs ?? 5 * 60 * 1000,
        ...(analyzerLookbackMs ? { lookbackMs: analyzerLookbackMs } : {}),
        ...(analyzerBatchSize ? { batchSize: analyzerBatchSize } : {}),
      },
      taskWorkerConfig: {
        enabled: resolveBoolean(
          this.configService.get('V2_TABLE_QUERY_OPS_TASK_WORKER_ENABLED'),
          searchVectorRuntimeEnabled || policyAutoExecutionEnabled
        ),
        workerId: `${workerId}:task-worker`,
        allowManualIndexExecution,
        allowPolicyIndexExecution: policyAutoExecutionEnabled,
        allowedKinds,
        ...(taskWorkerIntervalMs ? { intervalMs: taskWorkerIntervalMs } : {}),
      },
    };
  }

  private startTableQueryOpsRunners(container: DependencyContainer): void {
    const context = this.createTableQueryOpsContext(container);
    if (!context) return;
    const resolveExecution = async (tableId: string) => {
      try {
        const route = await this.dataDbClientManager.getDataDatabaseForTable(tableId);
        const target = await this.runtimeCache.getOrCreate(
          TABLE_QUERY_MAINTENANCE_CACHE_NAMESPACE,
          route.cacheKey,
          () =>
            this.createContainer(route.connectionUrl ?? route.url, route.internalSchema, {
              previewReadOnly: true,
              maintenance: true,
            }),
          (created) => this.destroyContainer(created)
        );
        const targetContext = this.createTableQueryOpsContext(target);
        if (!targetContext) throw new Error('Unable to initialize table query task context');
        return { container: target, context: targetContext };
      } catch (error) {
        if (isTableQueryOpsConnectionUnavailable(error)) {
          throw new TableQueryOpsExecutionUnavailableError(error);
        }
        throw error;
      }
    };

    const handles = [
      startTableQueryOpsAnalyzerIfEnabled(container, context, resolveExecution),
      startTableQueryOpsTaskWorkerIfEnabled(container, context, resolveExecution),
      startTableQueryOpsManualSearchTaskWorker(container, context, resolveExecution),
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

  /** Called by the actual application root before imported modules destroy dependencies. */
  drainEvents(producers: ReadonlyArray<Promise<void>> = []): Promise<boolean> {
    return (this.eventDrainPromise ??= this.drainEventRuntimes(producers));
  }
  private async drainEventRuntimes(producers: ReadonlyArray<Promise<void>>): Promise<boolean> {
    const timeoutMs =
      resolvePositiveInteger(this.configService.get('V2_EVENT_BUS_SHUTDOWN_TIMEOUT_MS')) ?? 30_000;
    let expired = false;
    let pendingProducers = producers.length;
    let resolveTimeout!: () => void;
    const timeout = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    const timer = setTimeout(() => {
      expired = true;
      this.pinoLogger.error(
        { timeoutMs, ...pending(), context: V2ContainerService.name },
        'V2 event bus shutdown drain timed out'
      );
      resolveTimeout();
    }, timeoutMs);
    const pending = () => {
      let pendingEvents = 0;
      let pendingBackgroundTasks = 0;
      let pendingCommands = 0;
      for (const runtime of this.eventRuntimes.values()) {
        pendingEvents += runtime.events.pendingCount();
        pendingBackgroundTasks += runtime.events.pendingBackgroundTaskCount();
        pendingCommands += runtime.commands.pendingCount();
      }
      return { pendingEvents, pendingBackgroundTasks, pendingCommands, pendingProducers };
    };
    const drain = async (): Promise<boolean> => {
      await Promise.all(
        producers.map(async (producer) => {
          try {
            await producer;
          } catch (error) {
            this.logger.error('V2 shutdown producer stop failed', error);
          } finally {
            pendingProducers -= 1;
          }
        })
      );
      while (!expired) {
        const runtimes = [...this.eventRuntimes.entries()];
        await Promise.all(runtimes.map(([, runtime]) => runtime.commands.settled()));
        if (expired) return false;
        await Promise.all(
          runtimes.map(async ([container]) => {
            if (
              container.isRegistered(v2RecordRepositoryPostgresTokens.computedActivityProjector)
            ) {
              await container
                .resolve<{ flushAllPendingActivity(): Promise<void> }>(
                  v2RecordRepositoryPostgresTokens.computedActivityProjector
                )
                .flushAllPendingActivity();
            }
          })
        );
        if (expired) return false;
        await Promise.all(runtimes.map(([, runtime]) => runtime.events.settled()));
        const work = pending();
        if (
          work.pendingEvents === 0 &&
          work.pendingBackgroundTasks === 0 &&
          work.pendingCommands === 0 &&
          runtimes.length === this.eventRuntimes.size
        ) {
          return true;
        }
      }
      return false;
    };
    try {
      return await Promise.race([
        drain().catch((error) => {
          expired = true;
          this.pinoLogger.error(
            { ...pending(), err: error, context: V2ContainerService.name },
            'V2 event bus shutdown drain failed'
          );
          return false;
        }),
        timeout.then(() => false),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.drainEvents();
    await this.runtimeCache.deleteByNamespace(V2_CONTAINER_CACHE_NAMESPACE);
    await this.runtimeCache.deleteByNamespace(TABLE_QUERY_MAINTENANCE_CACHE_NAMESPACE);
    await this.tableQueryObservationRuntime.dispose();
  }

  private async destroyContainer(container: DependencyContainer): Promise<void> {
    this.eventRuntimes.delete(container);
    this.stopTableQueryOpsRunners(container);
    // Stop the async activity flusher before destroying the pools — a pending
    // debounce/retry timer firing afterwards would retry against the dead pool.
    try {
      container
        .resolve<{
          disposeAsyncFlusher(): void;
        }>(v2RecordRepositoryPostgresTokens.computedActivityProjector)
        .disposeAsyncFlusher();
    } catch {
      // Container without the record adapter registered — nothing to stop.
    }
    try {
      container
        .resolve<{
          dispose(): void;
        }>(v2ShareDbTokens.presence)
        .dispose();
    } catch {
      // Container without the ShareDB realtime adapter — nothing to release.
    }
    this.claimConcurrencyUnregisters.get(container)?.();
    this.claimConcurrencyUnregisters.delete(container);
    const poolLeases = this.poolLeases.get(container) ?? [];
    this.poolLeases.delete(container);
    try {
      // Owns coordination plus every unique meta/data Kysely handle.
      await disposeV2NodePgContainer(container);
    } catch (error) {
      this.logger.error(
        'Failed to dispose the V2 PostgreSQL container',
        error instanceof Error ? error.stack : String(error)
      );
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
