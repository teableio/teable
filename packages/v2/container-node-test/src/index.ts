import { registerV2PostgresDdlAdapter } from '@teable/v2-adapter-postgres-ddl';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-postgres-state';
import type { ITableRepository } from '@teable/v2-core';
import { BaseId, getRandomString, MemoryEventPublisher, v2CoreTokens } from '@teable/v2-core';
import { v2PostgresDbTokens } from '@teable/v2-db-postgres';
import type { DependencyContainer } from '@teable/v2-di';
import { container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';

export interface IV2NodeTestContainer {
  container: DependencyContainer;
  tableRepository: ITableRepository;
  eventPublisher: MemoryEventPublisher;
  baseId: BaseId;
  dispose(): Promise<void>;
}

export const createV2NodeTestContainer = async (): Promise<IV2NodeTestContainer> => {
  const c = container.createChildContainer();

  const pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('teable_v2_test')
    .withUsername('teable')
    .withPassword('teable')
    .start();
  const connectionString = pgContainer.getConnectionUri();

  await registerV2PostgresStateAdapter(c, {
    pg: { connectionString },
    ensureSchema: true,
  });

  await registerV2PostgresDdlAdapter(c, { pg: { connectionString } });

  const tableRepository = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);
  const eventPublisher = new MemoryEventPublisher();

  c.registerInstance(v2CoreTokens.eventPublisher, eventPublisher);

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
    eventPublisher,
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
