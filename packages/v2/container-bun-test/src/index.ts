import { ConsoleLogger } from '@teable/v2-adapter-logger-console';
import { registerV2PostgresDdlAdapter } from '@teable/v2-adapter-postgres-ddl';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-postgres-state';
import type { ITableRepository } from '@teable/v2-core';
import {
  BaseId,
  getRandomString,
  MemoryCommandBus,
  MemoryEventBus,
  MemoryQueryBus,
  NoopTracer,
  v2CoreTokens,
} from '@teable/v2-core';
import { PostgresUnitOfWork, v2PostgresDbTokens } from '@teable/v2-db-postgres';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { Wait } from 'testcontainers';

export interface IV2BunTestContainer {
  container: DependencyContainer;
  tableRepository: ITableRepository;
  eventBus: MemoryEventBus;
  baseId: BaseId;
  dispose(): Promise<void>;
}

export const createV2BunTestContainer = async (): Promise<IV2BunTestContainer> => {
  const c = container.createChildContainer();

  const pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('teable_v2_test')
    .withUsername('teable')
    .withPassword('teable')
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
  const connectionString = pgContainer.getConnectionUri();
  console.log('connectionString', connectionString);

  await registerV2PostgresStateAdapter(c, {
    pg: { connectionString },
    ensureSchema: true,
  });

  await registerV2PostgresDdlAdapter(c, { pg: { connectionString } });

  c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });
  c.registerInstance(v2CoreTokens.logger, new ConsoleLogger());
  c.register(v2CoreTokens.tracer, NoopTracer, {
    lifecycle: Lifecycle.Singleton,
  });

  const tableRepository = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);
  const commandBus = new MemoryCommandBus(c);
  const queryBus = new MemoryQueryBus(c);
  const eventBus = new MemoryEventBus(c);

  c.registerInstance(v2CoreTokens.commandBus, commandBus);
  c.registerInstance(v2CoreTokens.queryBus, queryBus);
  c.registerInstance(v2CoreTokens.eventBus, eventBus);

  const db = c.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
  const baseIdResult = BaseId.generate();
  if (baseIdResult.isErr()) {
    throw new Error(baseIdResult.error);
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
    dispose: async () => {
      try {
        await db.destroy();
      } finally {
        await pgContainer.stop();
      }
    },
  };
};
