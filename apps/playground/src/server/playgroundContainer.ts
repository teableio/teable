import { ensureServerOtel, v2Tracer } from './otel';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { playgroundLogger } from './playgroundLogger';
import { registerPlaygroundShareDbRealtime } from './shareDbServer';
import { getPlaygroundDbConnectionString } from './playgroundDbContext';

import {
  PLAYGROUND_ACTOR_ID,
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_NAME,
  PLAYGROUND_SPACE_ID,
} from '@/lib/playground/constants';

const containerPromises = new Map<string, Promise<DependencyContainer>>();
const seedPromises = new Map<string, Promise<void>>();

const resolveConnectionString = (override?: string): string | undefined =>
  override ??
  getPlaygroundDbConnectionString() ??
  process.env.VITE_PLAYGROUND_DB_URL ??
  process.env.VITE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL;

const ensurePlaygroundSeed = async (container: DependencyContainer, key: string): Promise<void> => {
  if (!seedPromises.has(key)) {
    const seedPromise = (async () => {
      const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

      const existingSpace = await db
        .selectFrom('space')
        .select('id')
        .where('id', '=', PLAYGROUND_SPACE_ID)
        .executeTakeFirst();

      if (!existingSpace) {
        await db
          .insertInto('space')
          .values({
            id: PLAYGROUND_SPACE_ID,
            name: 'Playground Space',
            created_by: PLAYGROUND_ACTOR_ID,
          })
          .execute();
      }

      const existingBase = await db
        .selectFrom('base')
        .select('id')
        .where('id', '=', PLAYGROUND_BASE_ID)
        .executeTakeFirst();

      if (!existingBase) {
        await db
          .insertInto('base')
          .values({
            id: PLAYGROUND_BASE_ID,
            space_id: PLAYGROUND_SPACE_ID,
            name: PLAYGROUND_BASE_NAME,
            order: 1,
            created_by: PLAYGROUND_ACTOR_ID,
          })
          .execute();
      }
    })();
    seedPromises.set(key, seedPromise);
  }

  await seedPromises.get(key)!;
};

export const createPlaygroundContainer = async (
  options: {
    connectionString?: string;
  } = {}
): Promise<DependencyContainer> => {
  const connectionString = resolveConnectionString(options.connectionString);
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL for playground container (.env or .env.development)');
  }
  const key = connectionString;

  if (!containerPromises.has(key)) {
    const promise = (async () => {
      await ensureServerOtel();
      const container = await createV2NodePgContainer({
        ensureSchema: true,
        connectionString,
        logger: playgroundLogger,
        tracer: v2Tracer,
      });
      await registerPlaygroundShareDbRealtime(container);
      await ensurePlaygroundSeed(container, key);
      return container;
    })();
    containerPromises.set(key, promise);
  }

  return containerPromises.get(key)!;
};

export const warmPlaygroundContainer = (): void => {
  void createPlaygroundContainer().catch((error) => {
    console.error('Playground container warmup failed', error);
  });
};
