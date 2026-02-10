import { createHash } from 'crypto';
import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-pg';
import {
  PostgresUnitOfWork,
  registerV2PostgresDb,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { ConsoleLogger } from '@teable/v2-adapter-logger-console';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  createTypeValidationStrategy,
  registerV2TableRepositoryPostgresAdapter,
} from '@teable/v2-adapter-table-repository-postgres';
import type { IHasher, ITableRepository } from '@teable/v2-core';
import {
  BaseId,
  DefaultTableMapper,
  getRandomString,
  MemoryCommandBus,
  MemoryEventBus,
  MemoryQueryBus,
  NoopRealtimeEngine,
  NoopTracer,
  registerV2CoreServices,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { Wait } from 'testcontainers';

/**
 * Bun crypto-based hasher implementation for tests.
 */
class BunCryptoHasher implements IHasher {
  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}

export interface IV2BunTestContainer {
  container: DependencyContainer;
  tableRepository: ITableRepository;
  eventBus: MemoryEventBus;
  baseId: BaseId;
  db: Kysely<V1TeableDatabase>;
  dispose(): Promise<void>;
}

export interface IV2BunTestContainerOptions {
  registerDb?: (
    container: DependencyContainer,
    config: IV2PostgresDbConfig
  ) => Promise<DependencyContainer | void>;
  maxFreeRowLimit?: number;
}

export const createV2BunTestContainer = async (
  options: IV2BunTestContainerOptions = {}
): Promise<IV2BunTestContainer> => {
  const c = container.createChildContainer();

  const pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('teable_v2_test')
    .withUsername('teable')
    .withPassword('teable')
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
  const connectionString = pgContainer.getConnectionUri();
  const dbConfig: IV2PostgresDbConfig = { pg: { connectionString } };
  console.log('connectionString', connectionString);

  if (options.registerDb) {
    await options.registerDb(c, dbConfig);
  }

  if (!c.isRegistered(v2PostgresDbTokens.db)) {
    await registerV2PostgresDb(c, dbConfig);
  }

  const db = c.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

  const maxFreeRowLimit = resolveMaxFreeRowLimit(options.maxFreeRowLimit);

  await registerV2PostgresStateAdapter(c, {
    db,
    ensureSchema: true,
    ...(maxFreeRowLimit ? { maxFreeRowLimit } : {}),
  });

  // Register table repository postgres adapter (schema + record repositories)
  const typeValidationStrategy = await createTypeValidationStrategy(db);
  registerV2TableRepositoryPostgresAdapter(c, { db, typeValidationStrategy });

  c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });
  c.registerInstance(v2CoreTokens.logger, new ConsoleLogger());
  c.register(v2CoreTokens.tracer, NoopTracer, {
    lifecycle: Lifecycle.Singleton,
  });
  if (!c.isRegistered(v2CoreTokens.realtimeEngine)) {
    c.register(v2CoreTokens.realtimeEngine, NoopRealtimeEngine, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  if (!c.isRegistered(v2CoreTokens.hasher)) {
    c.register(v2CoreTokens.hasher, BunCryptoHasher, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  if (!c.isRegistered(v2CoreTokens.tableMapper)) {
    c.register(v2CoreTokens.tableMapper, DefaultTableMapper, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  if (!c.isRegistered(v2CoreTokens.csvParser)) {
    c.register(v2CoreTokens.csvParser, PapaparseCsvParser, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  const tableRepository = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);
  const commandBus = new MemoryCommandBus(c);
  const queryBus = new MemoryQueryBus(c);
  const eventBus = new MemoryEventBus(c);

  c.registerInstance(v2CoreTokens.commandBus, commandBus);
  c.registerInstance(v2CoreTokens.queryBus, queryBus);
  c.registerInstance(v2CoreTokens.eventBus, eventBus);

  // Register core services (uses defaults unless already registered)
  registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

  const baseIdResult = BaseId.generate();
  if (baseIdResult.isErr()) {
    throw new Error(baseIdResult.error.message);
  }
  const baseId = baseIdResult.value;
  const spaceId = `spc${getRandomString(16)}`;
  const actorId = 'system';

  await db
    .insertInto('space')
    .values({ id: spaceId, name: 'Test Space', created_by: actorId })
    .execute();

  await db
    .insertInto('base')
    .values({
      id: baseId.toString(),
      space_id: spaceId,
      name: 'Test Base',
      order: 1,
      created_by: actorId,
    })
    .execute();

  return {
    container: c,
    tableRepository,
    eventBus,
    baseId,
    db,
    dispose: async () => {
      try {
        await db.destroy();
      } finally {
        await pgContainer.stop();
      }
    },
  };
};

const resolveMaxFreeRowLimit = (value?: number): number | undefined => {
  if (typeof value === 'number' && value > 0) return value;
  const envValue = process.env.MAX_FREE_ROW_LIMIT;
  if (!envValue) return undefined;
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
