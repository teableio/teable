import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pglite';
import { PinoLoggerAdapter, createV2PinoLogger } from '@teable/v2-adapter-logger-pino';
import { registerV2BroadcastChannelRealtime } from '@teable/v2-adapter-realtime-broadcastchannel';
import { createV2BrowserContainer } from '@teable/v2-container-browser';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import {
  SANDBOX_ACTOR_ID,
  SANDBOX_BASE_ID,
  SANDBOX_BASE_NAME,
  SANDBOX_PGLITE_CONNECTION_STRING,
  SANDBOX_SPACE_ID,
} from '@/lib/playground/constants';

let containerPromise: Promise<DependencyContainer> | undefined;
let spaceSeedPromise: Promise<void> | undefined;
const baseSeedPromises = new Map<string, Promise<void>>();
const sandboxLogLevel = import.meta.env.VITE_LOG_LEVEL ?? (import.meta.env.DEV ? 'debug' : 'info');
const sandboxLogger = new PinoLoggerAdapter(
  createV2PinoLogger({
    name: 'teable-sandbox',
    level: sandboxLogLevel,
    browser: { asObject: true },
  })
);

const ensureSandboxSpace = async (db: Kysely<V1TeableDatabase>): Promise<void> => {
  const existingSpace = await db
    .selectFrom('space')
    .select('id')
    .where('id', '=', SANDBOX_SPACE_ID)
    .executeTakeFirst();

  if (!existingSpace) {
    await db
      .insertInto('space')
      .values({
        id: SANDBOX_SPACE_ID,
        name: 'Sandbox Space',
        created_by: SANDBOX_ACTOR_ID,
      })
      .execute();
  }
};

export const ensureSandboxBase = async (
  container: DependencyContainer,
  baseId: string,
  baseName: string
): Promise<void> => {
  const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

  if (!spaceSeedPromise) {
    spaceSeedPromise = ensureSandboxSpace(db);
  }
  await spaceSeedPromise;

  if (!baseSeedPromises.has(baseId)) {
    const seedPromise = (async () => {
      const existingBase = await db
        .selectFrom('base')
        .select('id')
        .where('id', '=', baseId)
        .executeTakeFirst();

      if (!existingBase) {
        await db
          .insertInto('base')
          .values({
            id: baseId,
            space_id: SANDBOX_SPACE_ID,
            name: baseName,
            order: 1,
            created_by: SANDBOX_ACTOR_ID,
          })
          .execute();
      }
    })();

    baseSeedPromises.set(baseId, seedPromise);
  }

  await baseSeedPromises.get(baseId);
};

export const createSandboxContainer = async (): Promise<DependencyContainer> => {
  if (!containerPromise) {
    containerPromise = (async () => {
      const container = await createV2BrowserContainer({
        ensureSchema: true,
        connectionString: SANDBOX_PGLITE_CONNECTION_STRING,
        logger: sandboxLogger,
      });
      registerV2BroadcastChannelRealtime(container);
      await ensureSandboxBase(container, SANDBOX_BASE_ID, SANDBOX_BASE_NAME);
      return container;
    })();
  }

  return containerPromise;
};
