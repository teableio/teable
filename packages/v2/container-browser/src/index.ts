import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import {
  PostgresUnitOfWork,
  registerV2PostgresPgliteDb,
  v2DataDbTokens,
  type IV2PostgresPgliteOptions,
} from '@teable/v2-adapter-db-postgres-pglite';
import type { IV2PostgresStateAdapterConfig } from '@teable/v2-adapter-repository-postgres';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  registerV2TableRepositoryPostgresAdapter,
  v2RecordRepositoryPostgresTokens,
  FormulaSourceBudgetCommandBusMiddleware,
  type ComputedUpdateWorker,
  type IV2TableRepositoryPostgresConfig,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  AsyncMemoryEventBus,
  compileDurableSubscriptionCatalog,
  DomainWriteTransaction,
  FieldCreated,
  FieldUpdated,
  MemoryCommandBus,
  MemoryQueryBus,
  NoopHasher,
  NoopLogger,
  NoopProjectionMessageJournal,
  NoopRealtimeEngine,
  NoopTableRepository,
  NoopTableRecordQueryRepository,
  NoopTableRecordRepository,
  NoopTableSchemaRepository,
  NoopTracer,
  NoopUnitOfWork,
  ProjectionMessageCodecRegistry,
  RecordCreated,
  RecordReordered,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  RecordUpdated,
  recordProjectionCodecs,
  registerV2CoreServices,
  SameTxProjectionDispatcher,
  StaticTableDataSafetyLimitPlugin,
  TableCreated,
  TableDataSafetyLimitCommandBusMiddleware,
  TargetedLegacyEventDispatcher,
  v2CoreTokens,
  type ICommandBusMiddleware,
  type ILogger,
  type IQueryBusMiddleware,
  type TableDataSafetyLimitConfig,
  type ITracer,
  type DomainError,
  type IImportEventSpoolFactory,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

const defaultPgliteDataDir = 'memory://';

export interface IV2BrowserPgliteContainerOptions {
  connectionString?: string;
  /**
   * Options forwarded to `PGlite.create`. Needed when the default on-disk
   * asset lookup is unavailable, e.g. inside a single-file binary.
   */
  pglite?: IV2PostgresPgliteOptions;
  ensureSchema?: boolean;
  seed?: Partial<IV2PostgresStateAdapterConfig['seed']>;
  tableMaxRowLimit?: number;
  tableDataSafetyLimits?: TableDataSafetyLimitConfig;
  formulaCompileBudget?: IV2TableRepositoryPostgresConfig['formulaCompileBudget'];
  computedUpdate?: IV2TableRepositoryPostgresConfig['computedUpdate'];
  /** @deprecated Use `tableMaxRowLimit`. */
  maxFreeRowLimit?: number;
  logger?: ILogger;
  tracer?: ITracer;
  commandBusMiddlewares?: ReadonlyArray<ICommandBusMiddleware>;
  queryBusMiddlewares?: ReadonlyArray<IQueryBusMiddleware>;
  importEventSpoolFactory?: IImportEventSpoolFactory;
}

const resolvePgliteDataDir = (options: IV2BrowserPgliteContainerOptions): string => {
  return options.connectionString ?? defaultPgliteDataDir;
};

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

export const registerV2BrowserPgliteDependencies = async (
  c: DependencyContainer = container,
  options: IV2BrowserPgliteContainerOptions = {}
): Promise<DependencyContainer> => {
  const connectionString = resolvePgliteDataDir(options);
  const ensureSchema = options.ensureSchema ?? true;

  await registerV2PostgresPgliteDb(c, {
    pg: { connectionString },
    pglite: options.pglite,
  });

  const dataDb = c.resolve(v2DataDbTokens.db) as IV2PostgresStateAdapterConfig['db'];

  await registerV2PostgresStateAdapter(c, {
    db: dataDb,
    ensureSchema,
    seed: options.seed as IV2PostgresStateAdapterConfig['seed'],
    ...((options.tableMaxRowLimit ??
    options.maxFreeRowLimit ??
    options.tableDataSafetyLimits?.tableSchema?.maxRowsPerTable)
      ? {
          tableMaxRowLimit:
            options.tableMaxRowLimit ??
            options.maxFreeRowLimit ??
            options.tableDataSafetyLimits?.tableSchema?.maxRowsPerTable,
        }
      : {}),
  });

  registerV2TableRepositoryPostgresAdapter(c, {
    db: dataDb,
    tableDataSafetyLimits: options.tableDataSafetyLimits,
    formulaCompileBudget: options.formulaCompileBudget,
    computedUpdate: options.computedUpdate,
  });

  c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });

  const logger = options.logger ?? new NoopLogger();
  c.registerInstance(v2CoreTokens.logger, logger);

  c.registerInstance(v2CoreTokens.tableDataSafetyLimits, options.tableDataSafetyLimits ?? {});
  const commandBus = new MemoryCommandBus(c, [
    new FormulaSourceBudgetCommandBusMiddleware(options.formulaCompileBudget),
    ...(options.tableDataSafetyLimits
      ? [
          new TableDataSafetyLimitCommandBusMiddleware(
            new StaticTableDataSafetyLimitPlugin(options.tableDataSafetyLimits)
          ),
        ]
      : []),
    ...(options.commandBusMiddlewares ?? []),
  ]);
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

  const catalogResult = compileDurableSubscriptionCatalog([
    RecordCreated,
    RecordsBatchCreated,
    RecordUpdated,
    RecordsBatchUpdated,
    RecordsDeleted,
    RecordReordered,
    TableCreated,
    FieldCreated,
    FieldUpdated,
  ]);
  if (catalogResult.isErr()) {
    throw new Error(catalogResult.error.message);
  }
  const codecResult = ProjectionMessageCodecRegistry.create(recordProjectionCodecs);
  if (codecResult.isErr()) {
    throw new Error(codecResult.error.message);
  }
  c.registerInstance(v2CoreTokens.durableSubscriptionCatalog, catalogResult.value);
  // PGlite has no durable delivery worker; keep projections SameTx/in-memory
  // instead of accumulating unconsumed domain_event_outbox rows. Register the
  // exact journal instance passed to DomainWriteTransaction.
  const projectionJournal = new NoopProjectionMessageJournal();
  c.registerInstance(v2CoreTokens.projectionMessageJournal, projectionJournal);
  c.registerInstance(
    v2CoreTokens.domainWriteTransaction,
    new DomainWriteTransaction(
      c.resolve(v2CoreTokens.unitOfWork),
      codecResult.value,
      catalogResult.value,
      projectionJournal,
      new TargetedLegacyEventDispatcher(c, logger),
      new SameTxProjectionDispatcher(c),
      logger,
      undefined,
      c.resolve(v2CoreTokens.eventBus),
      options.importEventSpoolFactory
    )
  );

  if (options.tracer) {
    c.registerInstance(v2CoreTokens.tracer, options.tracer);
  } else {
    c.register(v2CoreTokens.tracer, NoopTracer, {
      lifecycle: Lifecycle.Singleton,
    });
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

  // Register hasher (browser-compatible implementation)
  if (!c.isRegistered(v2CoreTokens.hasher)) {
    c.register(v2CoreTokens.hasher, NoopHasher, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  // Register core services (uses defaults unless already registered)
  registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

  return c;
};

export const registerV2BrowserNoopDependencies = (
  c: DependencyContainer = container
): DependencyContainer => {
  c.register(v2CoreTokens.tableRepository, NoopTableRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tableRecordQueryRepository, NoopTableRecordQueryRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tableRecordRepository, NoopTableRecordRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tableSchemaRepository, NoopTableSchemaRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  const logger = new NoopLogger();
  c.registerInstance(v2CoreTokens.logger, logger);
  c.registerInstance(v2CoreTokens.tableDataSafetyLimits, {});
  const commandBus = new MemoryCommandBus(c);
  c.registerInstance(v2CoreTokens.commandBus, commandBus);
  c.registerInstance(v2CoreTokens.internalCommandBus, commandBus);
  c.registerInstance(v2CoreTokens.queryBus, new MemoryQueryBus(c));
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
  c.register(v2CoreTokens.unitOfWork, NoopUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tracer, NoopTracer, {
    lifecycle: Lifecycle.Singleton,
  });
  if (!c.isRegistered(v2CoreTokens.realtimeEngine)) {
    c.register(v2CoreTokens.realtimeEngine, NoopRealtimeEngine, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  // Register hasher (browser-compatible implementation)
  if (!c.isRegistered(v2CoreTokens.hasher)) {
    c.register(v2CoreTokens.hasher, NoopHasher, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  // Register core services (uses defaults unless already registered)
  registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

  return c;
};

export const createV2BrowserContainer = async (
  options: IV2BrowserPgliteContainerOptions = {}
): Promise<DependencyContainer> => {
  const c = container.createChildContainer();
  await registerV2BrowserPgliteDependencies(c, options);
  return c;
};

export const createV2BrowserNoopContainer = (): DependencyContainer => {
  const c = container.createChildContainer();
  return registerV2BrowserNoopDependencies(c);
};

/**
 * Options for {@link flushV2BrowserComputed}.
 */
export interface IV2BrowserComputedDrainOptions {
  /** Worker identity used for lease bookkeeping and logs. */
  workerId?: string;
  /** Tasks processed per batch. */
  limit?: number;
  /** Safety cap on batches; exceeds throw instead of spinning forever. */
  maxBatches?: number;
}

/**
 * Runs the computed-update worker until the outbox has no more claimable work.
 *
 * The browser container does not start a background worker: cross-record
 * rollups/links converge only when the host drains the queue. This facade is the
 * supported seam — callers never need to know the DI tokens behind it.
 *
 * @returns number of processed tasks across all batches.
 */
export const flushV2BrowserComputed = async (
  c: DependencyContainer,
  options: IV2BrowserComputedDrainOptions = {}
): Promise<number> => {
  const worker = c.resolve<ComputedUpdateWorker>(
    v2RecordRepositoryPostgresTokens.computedUpdateWorker
  );
  const workerId = options.workerId ?? 'browser-computed-drain';
  const limit = options.limit ?? 100;
  const maxBatches = options.maxBatches ?? 100;
  let processed = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await worker.runOnce({ workerId, limit });
    if (result.isErr()) {
      const error: DomainError = result.error;
      throw new Error(error.message);
    }
    processed += result.value;
    if (result.value === 0) {
      return processed;
    }
  }
  throw new Error(`Computed drain exceeded ${maxBatches} batches`);
};
