import { PostgresUnitOfWork } from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresDdlAdapter } from '@teable/v2-adapter-postgres-ddl';
import type { IV2PostgresStateAdapterConfig } from '@teable/v2-adapter-postgres-state';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-postgres-state';
import {
  MemoryCommandBus,
  MemoryEventBus,
  MemoryQueryBus,
  NoopLogger,
  NoopTracer,
  TableUpdateFlow,
  v2CoreTokens,
  type ICommandBusMiddleware,
  type IQueryBusMiddleware,
  type ILogger,
  type ITracer,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

export interface IV2NodePgContainerOptions {
  connectionString?: string;
  ensureSchema?: boolean;
  seed?: Partial<IV2PostgresStateAdapterConfig['seed']>;
  logger?: ILogger;
  tracer?: ITracer;
  commandBusMiddlewares?: ReadonlyArray<ICommandBusMiddleware>;
  queryBusMiddlewares?: ReadonlyArray<IQueryBusMiddleware>;
}

export const registerV2NodePgDependencies = async (
  c: DependencyContainer = container,
  options: IV2NodePgContainerOptions
): Promise<DependencyContainer> => {
  const connectionString =
    options.connectionString ?? process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL;
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

export const createV2NodePgContainer = async (
  options: IV2NodePgContainerOptions = {}
): Promise<DependencyContainer> => {
  const c = container.createChildContainer();
  await registerV2NodePgDependencies(c, options);
  return c;
};
