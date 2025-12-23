import { v2Tracer } from './otel';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import { PinoLoggerAdapter, v2PinoLogger } from '@teable/v2-adapter-logger-pino';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import {
  PLAYGROUND_ACTOR_ID,
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_NAME,
  PLAYGROUND_SPACE_ID,
} from '@/lib/playground/constants';

let containerPromise: Promise<DependencyContainer> | undefined;
let seedPromise: Promise<void> | undefined;
const playgroundLogger = new PinoLoggerAdapter(v2PinoLogger);

const resolveConnectionString = (): string | undefined =>
  process.env.DATABASE_URL ?? process.env.PRISMA_DATABASE_URL;

const ensurePlaygroundSeed = async (container: DependencyContainer): Promise<void> => {
  if (!seedPromise) {
    seedPromise = (async () => {
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
  }

  await seedPromise;
};

export const createPlaygroundContainer = async (): Promise<DependencyContainer> => {
  if (!containerPromise) {
    containerPromise = (async () => {
      const connectionString = resolveConnectionString();
      if (!connectionString) {
        throw new Error('Missing DATABASE_URL for playground container (.env or .env.development)');
      }
      const container = await createV2NodePgContainer({
        ensureSchema: true,
        connectionString,
        logger: playgroundLogger,
        tracer: v2Tracer,
      });
      await ensurePlaygroundSeed(container);
      return container;
    })();
  }

  return containerPromise;
};

export const warmPlaygroundContainer = (): void => {
  void createPlaygroundContainer().catch((error) => {
    console.error('Playground container warmup failed', error);
  });
};
