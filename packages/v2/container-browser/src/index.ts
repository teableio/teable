import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import {
  PostgresUnitOfWork,
  registerV2PostgresPgliteDb,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pglite';
import type { IV2PostgresStateAdapterConfig } from '@teable/v2-adapter-repository-postgres';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import { registerV2TableRepositoryPostgresAdapter } from '@teable/v2-adapter-table-repository-postgres';
import {
  AsyncMemoryEventBus,
  MemoryCommandBus,
  MemoryQueryBus,
  NoopHasher,
  NoopLogger,
  NoopRealtimeEngine,
  NoopTableRepository,
  NoopTableRecordQueryRepository,
  NoopTableRecordRepository,
  NoopTableSchemaRepository,
  NoopTracer,
  NoopUnitOfWork,
  registerV2CoreServices,
  v2CoreTokens,
  type ICommandBusMiddleware,
  type ILogger,
  type IQueryBusMiddleware,
  type ITracer,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

const defaultPgliteDataDir = 'memory://';

export interface IV2BrowserPgliteContainerOptions {
  connectionString?: string;
  ensureSchema?: boolean;
  seed?: Partial<IV2PostgresStateAdapterConfig['seed']>;
  maxFreeRowLimit?: number;
  logger?: ILogger;
  tracer?: ITracer;
  commandBusMiddlewares?: ReadonlyArray<ICommandBusMiddleware>;
  queryBusMiddlewares?: ReadonlyArray<IQueryBusMiddleware>;
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
  });

  const db = c.resolve(v2PostgresDbTokens.db) as IV2PostgresStateAdapterConfig['db'];

  await registerV2PostgresStateAdapter(c, {
    db,
    ensureSchema,
    seed: options.seed as IV2PostgresStateAdapterConfig['seed'],
    ...(options.maxFreeRowLimit ? { maxFreeRowLimit: options.maxFreeRowLimit } : {}),
  });

  registerV2TableRepositoryPostgresAdapter(c, { db });

  c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });

  const logger = options.logger ?? new NoopLogger();
  c.registerInstance(v2CoreTokens.logger, logger);

  c.registerInstance(
    v2CoreTokens.commandBus,
    new MemoryCommandBus(c, options.commandBusMiddlewares)
  );
  c.registerInstance(v2CoreTokens.queryBus, new MemoryQueryBus(c, options.queryBusMiddlewares));
  c.registerInstance(
    v2CoreTokens.eventBus,
    new AsyncMemoryEventBus(c, {
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
  c.registerInstance(v2CoreTokens.commandBus, new MemoryCommandBus(c));
  c.registerInstance(v2CoreTokens.queryBus, new MemoryQueryBus(c));
  c.registerInstance(
    v2CoreTokens.eventBus,
    new AsyncMemoryEventBus(c, {
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
