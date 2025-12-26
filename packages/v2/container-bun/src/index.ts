import { PostgresUnitOfWork } from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresDdlAdapter } from '@teable/v2-adapter-schema-repository-postgres';
import type { IV2PostgresStateAdapterConfig } from '@teable/v2-adapter-repository-postgres';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  MemoryCommandBus,
  MemoryEventBus,
  MemoryQueryBus,
  NoopLogger,
  NoopTracer,
  FieldCreationSideEffectFlow,
  TableUpdateFlow,
  v2CoreTokens,
  type ICommandBusMiddleware,
  type ILogger,
  type IQueryBusMiddleware,
  type ITracer,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

type IEnvRecord = Record<string, string | undefined>;

export interface IV2BunPgContainerOptions {
  connectionString?: string;
  ensureSchema?: boolean;
  seed?: Partial<IV2PostgresStateAdapterConfig['seed']>;
  logger?: ILogger;
  tracer?: ITracer;
  commandBusMiddlewares?: ReadonlyArray<ICommandBusMiddleware>;
  queryBusMiddlewares?: ReadonlyArray<IQueryBusMiddleware>;
  env?: IEnvRecord;
}

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

  await registerV2PostgresStateAdapter(c, {
    pg: { connectionString },
    ensureSchema: options.ensureSchema,
    seed: options.seed as IV2PostgresStateAdapterConfig['seed'],
  });

  await registerV2PostgresDdlAdapter(c, {
    pg: { connectionString },
  });

  c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tableUpdateFlow, TableUpdateFlow, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.fieldCreationSideEffectFlow, FieldCreationSideEffectFlow, {
    lifecycle: Lifecycle.Singleton,
  });

  c.registerInstance(
    v2CoreTokens.commandBus,
    new MemoryCommandBus(c, options.commandBusMiddlewares)
  );
  c.registerInstance(v2CoreTokens.queryBus, new MemoryQueryBus(c, options.queryBusMiddlewares));
  c.registerInstance(v2CoreTokens.eventBus, new MemoryEventBus(c));

  if (options.logger) {
    c.registerInstance(v2CoreTokens.logger, options.logger);
  } else {
    c.register(v2CoreTokens.logger, NoopLogger, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  if (options.tracer) {
    c.registerInstance(v2CoreTokens.tracer, options.tracer);
  } else {
    c.register(v2CoreTokens.tracer, NoopTracer, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  return c;
};

export const createV2BunPgContainer = async (
  options: IV2BunPgContainerOptions = {}
): Promise<DependencyContainer> => {
  const c = container.createChildContainer();
  await registerV2BunPgDependencies(c, options);
  return c;
};
