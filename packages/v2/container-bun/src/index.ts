import { createHash } from 'crypto';
import {
  PostgresUnitOfWork,
  registerV2PostgresDb,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import type { IV2PostgresStateAdapterConfig } from '@teable/v2-adapter-repository-postgres';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  AsyncMemoryEventBus,
  MemoryCommandBus,
  MemoryQueryBus,
  NoopLogger,
  NoopTracer,
  registerV2CoreServices,
  v2CoreTokens,
  type ICommandBusMiddleware,
  type IHasher,
  type ILogger,
  type IQueryBusMiddleware,
  type ITracer,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

/**
 * Bun crypto-based hasher implementation.
 * Bun supports Node.js crypto module.
 */
class BunCryptoHasher implements IHasher {
  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}

type IEnvRecord = Record<string, string | undefined>;

export interface IV2BunPgContainerOptions {
  connectionString?: string;
  ensureSchema?: boolean;
  seed?: Partial<IV2PostgresStateAdapterConfig['seed']>;
  maxFreeRowLimit?: number;
  logger?: ILogger;
  tracer?: ITracer;
  commandBusMiddlewares?: ReadonlyArray<ICommandBusMiddleware>;
  queryBusMiddlewares?: ReadonlyArray<IQueryBusMiddleware>;
  env?: IEnvRecord;
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

const resolveBunEnv = (): IEnvRecord | undefined => {
  const bun = (globalThis as Record<string, unknown>)['Bun'] as { env?: IEnvRecord } | undefined;
  return bun?.env;
};

const resolveProcessEnv = (): IEnvRecord | undefined => {
  const processEnv = (globalThis as Record<string, unknown>)['process'] as
    | { env?: IEnvRecord }
    | undefined;
  return processEnv?.env;
};

const resolveEnv = (options: IV2BunPgContainerOptions): IEnvRecord => {
  return options.env ?? resolveBunEnv() ?? resolveProcessEnv() ?? {};
};

export const registerV2BunPgDependencies = async (
  c: DependencyContainer = container,
  options: IV2BunPgContainerOptions
): Promise<DependencyContainer> => {
  const env = resolveEnv(options);
  const connectionString = options.connectionString ?? env.PRISMA_DATABASE_URL ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Missing pg connectionString (options.connectionString or PRISMA_DATABASE_URL)'
    );
  }

  await registerV2PostgresDb(c, { pg: { connectionString } });
  const db = c.resolve(v2PostgresDbTokens.db) as IV2PostgresStateAdapterConfig['db'];

  const maxFreeRowLimit = resolveMaxFreeRowLimit(options.maxFreeRowLimit, env);

  await registerV2PostgresStateAdapter(c, {
    db,
    ensureSchema: options.ensureSchema,
    seed: options.seed as IV2PostgresStateAdapterConfig['seed'],
    ...(maxFreeRowLimit ? { maxFreeRowLimit } : {}),
  });

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

  // Register hasher
  if (!c.isRegistered(v2CoreTokens.hasher)) {
    c.register(v2CoreTokens.hasher, BunCryptoHasher, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  // Register core services (uses defaults unless already registered)
  registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

  return c;
};

const resolveMaxFreeRowLimit = (value: number | undefined, env: IEnvRecord): number | undefined => {
  if (typeof value === 'number' && value > 0) return value;
  const envValue = env.MAX_FREE_ROW_LIMIT;
  if (!envValue) return undefined;
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const createV2BunPgContainer = async (
  options: IV2BunPgContainerOptions = {}
): Promise<DependencyContainer> => {
  const c = container.createChildContainer();
  await registerV2BunPgDependencies(c, options);
  return c;
};
