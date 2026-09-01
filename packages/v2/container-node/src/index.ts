import { createHash } from 'crypto';
import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import {
  PostgresUnitOfWork,
  registerV2PostgresDataDb,
  registerV2PostgresMetaDb,
  registerV2PostgresDb,
  v2DataDbTokens,
  v2MetaDbTokens,
  v2PostgresDbTokens,
  type IV2PostgresDbDependencies,
} from '@teable/v2-adapter-db-postgres-pg';
import type { IV2PostgresStateAdapterConfig } from '@teable/v2-adapter-repository-postgres';
import {
  SpaceCreditTableRowLimitPolicy,
  registerV2PostgresStateAdapter,
} from '@teable/v2-adapter-repository-postgres';
import {
  registerV2TableOpsPostgresAdapter,
  type RegisterV2TableOpsPostgresAdapterOptions,
  type TableQueryObservationDatabase,
} from '@teable/v2-adapter-table-query-ops-postgres';
import {
  createTypeValidationStrategy,
  registerV2TableRepositoryPostgresAdapter,
  type IV2TableRepositoryPostgresConfig,
} from '@teable/v2-adapter-table-repository-postgres';
import { registerCommandExplainModule } from '@teable/v2-command-explain';
import {
  AsyncMemoryEventBus,
  MemoryCommandBus,
  MemoryQueryBus,
  NoopLogger,
  NoopRealtimeEngine,
  NoopTracer,
  registerV2CoreServices,
  StaticTableDataSafetyLimitPlugin,
  TableDataSafetyLimitCommandBusMiddleware,
  v2CoreTokens,
  type ICommandBusMiddleware,
  type IComputedOutboxAdmin,
  type IHasher,
  type IQueryBusMiddleware,
  type ILogger,
  type TableDataSafetyLimitConfig,
  type ITracer,
  type ITableQueryObservability,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import { DotTeaParser } from '@teable/v2-dottea';
import {
  decorateV2TableRecordQueryRepositoryWithTableOps,
  registerV2TableOps,
  type RegisterV2TableOpsOptions,
} from '@teable/v2-table-query-ops';

import { resolveTableDataSafetyLimitsFromEnv } from './tableDataSafetyLimits';

/**
 * Node.js crypto-based hasher implementation.
 */
class NodeCryptoHasher implements IHasher {
  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}

export interface IV2NodePgContainerOptions {
  connectionString?: string;
  metaConnectionString?: string;
  dataConnectionString?: string;
  dataSchema?: string;
  metaDbDependencies?: IV2PostgresDbDependencies;
  dataDbDependencies?: IV2PostgresDbDependencies;
  ensureSchema?: boolean;
  seed?: Partial<IV2PostgresStateAdapterConfig['seed']>;
  tableMaxRowLimit?: number;
  tableDataSafetyLimits?: TableDataSafetyLimitConfig;
  /** @deprecated Use `tableMaxRowLimit`. */
  maxFreeRowLimit?: number;
  logger?: ILogger;
  tracer?: ITracer;
  tableQueryObservability?: ITableQueryObservability;
  commandBusMiddlewares?: ReadonlyArray<ICommandBusMiddleware>;
  queryBusMiddlewares?: ReadonlyArray<IQueryBusMiddleware>;
  computedUpdate?: IV2TableRepositoryPostgresConfig['computedUpdate'];
  computedOutboxAdmin?: IComputedOutboxAdmin;
  /**
   * Enable the delete-undo purge guard. Only turn this on when the hosting app
   * writes record_trash markers for v2 deletes (postgres adapter inside the
   * delete transaction); standalone memory containers have no trash sink, and
   * with the guard on every delete-undo would silently restore nothing.
   */
  undoRedoRestorePurgeGuard?: boolean;
  tableQueryOps?: RegisterV2TableOpsOptions &
    Pick<
      RegisterV2TableOpsPostgresAdapterOptions<unknown, unknown, TableQueryObservationDatabase>,
      | 'ensureObservationSchema'
      | 'observationBatch'
      | 'observationBuffer'
      | 'observationDb'
      | 'observationDisabled'
      | 'observationPublisher'
      | 'observationReader'
      | 'observationSink'
      | 'observationWriterId'
    > & {
      ensureSchema?: boolean;
    };
}

const createEventHandlerLogger = (
  logger: ILogger,
  handlerName: string,
  eventName: string
): ILogger => {
  const baseLogger = logger
    .scope('eventHandler', { name: handlerName })
    .scope('event', { name: eventName });
  if (handlerName.endsWith('Projection')) {
    return baseLogger.scope('projection', { name: handlerName });
  }
  return baseLogger;
};

const canShareMetaAndDataDb = (
  metaConnectionString: string,
  dataConnectionString: string,
  dataSchema: string | undefined
) => metaConnectionString === dataConnectionString && !dataSchema;

const registerPostgresDatabases = async (
  c: DependencyContainer,
  options: IV2NodePgContainerOptions
): Promise<{
  readonly metaDb: IV2PostgresStateAdapterConfig['db'];
  readonly dataDb: IV2PostgresStateAdapterConfig['db'];
}> => {
  const metaConnectionString =
    options.metaConnectionString ??
    options.connectionString ??
    process.env.PRISMA_META_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;
  if (!metaConnectionString) {
    throw new Error(
      'Missing pg meta connectionString (options.metaConnectionString or PRISMA_META_DATABASE_URL)'
    );
  }
  const dataConnectionString = options.dataConnectionString ?? metaConnectionString;

  if (canShareMetaAndDataDb(metaConnectionString, dataConnectionString, options.dataSchema)) {
    const metaPool = options.metaDbDependencies?.pool;
    const dataPool = options.dataDbDependencies?.pool;
    if (metaPool && dataPool && metaPool !== dataPool) {
      throw new Error('Shared V2 meta/data database requires the same PostgreSQL pool');
    }
    await registerV2PostgresDb(
      c,
      { pg: { connectionString: metaConnectionString } },
      options.metaDbDependencies ?? options.dataDbDependencies
    );
  } else {
    await registerV2PostgresMetaDb(
      c,
      { pg: { connectionString: metaConnectionString } },
      options.metaDbDependencies
    );
    await registerV2PostgresDataDb(
      c,
      { pg: { connectionString: dataConnectionString, schema: options.dataSchema } },
      options.dataDbDependencies
    );
    const metaDb = c.resolve(v2MetaDbTokens.db);
    c.registerInstance(v2PostgresDbTokens.db, metaDb);
    c.registerInstance(v2PostgresDbTokens.config, {
      pg: { connectionString: metaConnectionString },
    });
  }

  return {
    metaDb: c.resolve(v2MetaDbTokens.db) as IV2PostgresStateAdapterConfig['db'],
    dataDb: c.resolve(v2DataDbTokens.db) as IV2PostgresStateAdapterConfig['db'],
  };
};

const registerTableQueryOpsDependencies = async (
  c: DependencyContainer,
  tableQueryOps: IV2NodePgContainerOptions['tableQueryOps'],
  metaDb: IV2PostgresStateAdapterConfig['db'],
  dataDb: IV2PostgresStateAdapterConfig['db'],
  ensureSchema: boolean | undefined
): Promise<void> => {
  // Always register core table-ops DI. Importing @teable/v2-table-query-ops already
  // puts TableSearchVectorSchemaMaintenanceProjection into the global event registry
  // via @ProjectionHandler; without these registrations every Field* event fails DI.
  registerV2TableOps(c, tableQueryOps);
  if (!tableQueryOps) return;

  await registerV2TableOpsPostgresAdapter(c, {
    metaDb,
    dataDb,
    observationDb: tableQueryOps.observationDb,
    observationDisabled: tableQueryOps.observationDisabled,
    observationPublisher: tableQueryOps.observationPublisher,
    observationReader: tableQueryOps.observationReader,
    observationSink: tableQueryOps.observationSink,
    observationWriterId: tableQueryOps.observationWriterId,
    observationBuffer: tableQueryOps.observationBuffer,
    observationBatch: tableQueryOps.observationBatch,
    ensureObservationSchema: tableQueryOps.ensureObservationSchema,
    ensureSchema: tableQueryOps.ensureSchema ?? ensureSchema,
  });
  decorateV2TableRecordQueryRepositoryWithTableOps(c);
};

export const registerV2NodePgDependencies = async (
  c: DependencyContainer = container,
  options: IV2NodePgContainerOptions
): Promise<DependencyContainer> => {
  const { metaDb, dataDb } = await registerPostgresDatabases(c, options);

  const tableDataSafetyLimits = mergeTableDataSafetyLimits(
    resolveTableDataSafetyLimitsFromEnv(),
    options.tableDataSafetyLimits
  );
  const rowLimitAdapterOptions = createRowLimitAdapterOptions(
    options,
    tableDataSafetyLimits,
    metaDb
  );

  await registerV2PostgresStateAdapter(c, {
    db: metaDb,
    recordCountDb: dataDb,
    ensureSchema: options.ensureSchema,
    seed: options.seed as IV2PostgresStateAdapterConfig['seed'],
    ...rowLimitAdapterOptions,
  });

  const typeValidationStrategy = await createTypeValidationStrategy(dataDb);
  registerV2TableRepositoryPostgresAdapter(c, {
    db: dataDb,
    metaDb,
    computedUpdate: options.computedUpdate,
    typeValidationStrategy,
    tableDataSafetyLimits,
  });

  c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });

  const logger = options.logger ?? new NoopLogger();
  c.registerInstance(v2CoreTokens.logger, logger);

  const commandBusMiddlewares = [
    new TableDataSafetyLimitCommandBusMiddleware(
      new StaticTableDataSafetyLimitPlugin(tableDataSafetyLimits)
    ),
    ...(options.commandBusMiddlewares ?? []),
  ];
  const commandBus = new MemoryCommandBus(c, commandBusMiddlewares);
  c.registerInstance(v2CoreTokens.commandBus, commandBus);
  c.registerInstance(v2CoreTokens.internalCommandBus, commandBus);
  c.registerInstance(v2CoreTokens.queryBus, new MemoryQueryBus(c, options.queryBusMiddlewares));
  c.registerInstance(
    v2CoreTokens.eventBus,
    new AsyncMemoryEventBus(c, {
      recordPublishedEvents: false,
      onError: ({ error, event, handlerName }) => {
        const eventName = event.name.toString();
        const scopedLogger = createEventHandlerLogger(logger, handlerName, eventName);
        scopedLogger.error('Async event handler failed', {
          error,
          event: eventName,
          handler: handlerName,
        });
      },
    })
  );

  if (options.tracer) {
    c.registerInstance(v2CoreTokens.tracer, options.tracer);
  } else {
    c.register(v2CoreTokens.tracer, NoopTracer, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  if (options.tableQueryObservability) {
    c.registerInstance(v2CoreTokens.tableQueryObservability, options.tableQueryObservability);
  }

  if (!c.isRegistered(v2CoreTokens.realtimeEngine)) {
    c.register(v2CoreTokens.realtimeEngine, NoopRealtimeEngine, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  if (!c.isRegistered(v2CoreTokens.csvParser)) {
    c.register(v2CoreTokens.csvParser, PapaparseCsvParser, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  if (!c.isRegistered(v2CoreTokens.dotTeaParser)) {
    c.register(v2CoreTokens.dotTeaParser, DotTeaParser, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  // Register hasher
  if (!c.isRegistered(v2CoreTokens.hasher)) {
    c.register(v2CoreTokens.hasher, NodeCryptoHasher, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  c.registerInstance(v2CoreTokens.tableDataSafetyLimits, tableDataSafetyLimits);

  // The delete-undo purge guard is opt-in: pre-register before the core
  // defaults so registerV2CoreServices keeps the caller's choice.
  c.registerInstance(v2CoreTokens.undoRedoReplayConfig, {
    restorePurgeGuard: Boolean(options.undoRedoRestorePurgeGuard),
  });

  if (options.computedOutboxAdmin) {
    c.registerInstance(v2CoreTokens.computedOutboxAdmin, options.computedOutboxAdmin);
  }

  // Register core services (uses defaults unless already registered)
  registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

  // Register command explain module
  registerCommandExplainModule(c);

  await registerTableQueryOpsDependencies(
    c,
    options.tableQueryOps,
    metaDb,
    dataDb,
    options.ensureSchema
  );

  return c;
};

const resolveTableMaxRowLimit = (value?: number): number | undefined => {
  if (typeof value === 'number' && value > 0) return value;
  return undefined;
};

const createRowLimitAdapterOptions = (
  options: IV2NodePgContainerOptions,
  tableDataSafetyLimits: TableDataSafetyLimitConfig,
  metaDb: IV2PostgresStateAdapterConfig['db']
): Pick<IV2PostgresStateAdapterConfig, 'tableMaxRowLimit' | 'tableRowLimitPolicy'> => {
  const legacyMaxFreeRowLimit =
    options.maxFreeRowLimit ?? parsePositiveInteger(process.env.MAX_FREE_ROW_LIMIT);
  const tableMaxRowLimit = resolveTableMaxRowLimit(
    options.tableMaxRowLimit ??
      legacyMaxFreeRowLimit ??
      tableDataSafetyLimits.tableSchema?.maxRowsPerTable
  );
  if (!tableMaxRowLimit) return {};

  const shouldUseLegacyCreditPolicy =
    !options.tableMaxRowLimit &&
    !tableDataSafetyLimits.tableSchema?.maxRowsPerTable &&
    typeof legacyMaxFreeRowLimit === 'number';

  return {
    tableMaxRowLimit,
    ...(shouldUseLegacyCreditPolicy
      ? { tableRowLimitPolicy: new SpaceCreditTableRowLimitPolicy(metaDb, tableMaxRowLimit) }
      : {}),
  };
};

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const mergeTableDataSafetyLimits = (
  base: TableDataSafetyLimitConfig,
  override?: TableDataSafetyLimitConfig
): TableDataSafetyLimitConfig => ({
  fieldOptions: mergeLimitGroup(base.fieldOptions, override?.fieldOptions),
  recordValues: mergeLimitGroup(base.recordValues, override?.recordValues),
  computed: mergeLimitGroup(base.computed, override?.computed),
  tableSchema: mergeLimitGroup(base.tableSchema, override?.tableSchema),
  viewConfig: mergeLimitGroup(base.viewConfig, override?.viewConfig),
  displayText: mergeLimitGroup(base.displayText, override?.displayText),
});

const mergeLimitGroup = <T extends Record<string, unknown>>(
  base: T | undefined,
  override: Partial<T> | undefined
): T => {
  const definedBase = Object.fromEntries(
    Object.entries(base ?? {}).filter(([, value]) => value !== undefined)
  ) as T;
  const definedOverride = Object.fromEntries(
    Object.entries(override ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
  return { ...definedBase, ...definedOverride };
};

export const createV2NodePgContainer = async (
  options: IV2NodePgContainerOptions = {}
): Promise<DependencyContainer> => {
  const c = container.createChildContainer();
  await registerV2NodePgDependencies(c, options);
  return c;
};
