import * as fs from 'node:fs';
import * as path from 'node:path';
import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import {
  PostgresUnitOfWork,
  registerV2PostgresPgliteDb,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pglite';
import { ConsoleLogger } from '@teable/v2-adapter-logger-console';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import { registerV2TableRepositoryPostgresAdapter } from '@teable/v2-adapter-table-repository-postgres';
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
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Effect, Layer } from 'effect';
import type { Kysely } from 'kysely';
import { Database, DatabaseConfig } from '../services/Database';
import { getAbsolutePgliteDataDir } from '../utils/connection';
import { NodeCryptoHasher } from './NodeCryptoHasher';

/**
 * Create a pglite-based Database layer.
 * - Creates file-persisted pglite database
 * - Initializes schema, space, and base if not already present
 * - Returns the baseId for use in subsequent commands
 */
export const DatabasePgliteLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* DatabaseConfig;
    const absoluteDataDir = getAbsolutePgliteDataDir(config.connectionString);

    // Ensure the data directory exists
    yield* Effect.try({
      try: () => {
        const parentDir = path.dirname(absoluteDataDir);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      },
      catch: (error) => new Error(`Failed to create pglite data directory: ${error}`),
    });

    // Create child container
    const c = container.createChildContainer();

    // Register pglite database
    yield* Effect.tryPromise({
      try: () =>
        registerV2PostgresPgliteDb(c, {
          pg: { connectionString: absoluteDataDir },
        }),
      catch: (error) => new Error(`Failed to register pglite database: ${error}`),
    });

    const db = c.resolve(v2PostgresDbTokens.db) as Kysely<V1TeableDatabase>;

    // Register state adapter (creates schema if needed)
    yield* Effect.tryPromise({
      try: () =>
        registerV2PostgresStateAdapter(c, {
          db,
          ensureSchema: true,
        }),
      catch: (error) => new Error(`Failed to register state adapter: ${error}`),
    });

    // Register table repository postgres adapter
    registerV2TableRepositoryPostgresAdapter(c, { db });

    // Register core dependencies
    c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
      lifecycle: Lifecycle.Singleton,
    });
    c.registerInstance(v2CoreTokens.logger, new ConsoleLogger());
    c.register(v2CoreTokens.tracer, NoopTracer, {
      lifecycle: Lifecycle.Singleton,
    });
    c.register(v2CoreTokens.realtimeEngine, NoopRealtimeEngine, {
      lifecycle: Lifecycle.Singleton,
    });
    c.register(v2CoreTokens.hasher, NodeCryptoHasher, {
      lifecycle: Lifecycle.Singleton,
    });
    c.register(v2CoreTokens.tableMapper, DefaultTableMapper, {
      lifecycle: Lifecycle.Singleton,
    });
    c.register(v2CoreTokens.csvParser, PapaparseCsvParser, {
      lifecycle: Lifecycle.Singleton,
    });

    const commandBus = new MemoryCommandBus(c);
    const queryBus = new MemoryQueryBus(c);
    const eventBus = new MemoryEventBus(c);

    c.registerInstance(v2CoreTokens.commandBus, commandBus);
    c.registerInstance(v2CoreTokens.queryBus, queryBus);
    c.registerInstance(v2CoreTokens.eventBus, eventBus);

    // Register core services
    registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

    // Check if space/base already exists
    const existingBase = yield* Effect.tryPromise({
      try: async () => {
        try {
          const result = await db.selectFrom('base').select('id').limit(1).execute();
          return result.length > 0 ? result[0].id : null;
        } catch {
          // Table doesn't exist yet, return null
          return null;
        }
      },
      catch: () => null as string | null,
    });

    let baseId: string;

    if (existingBase) {
      // Reuse existing base
      baseId = existingBase;
    } else {
      // Create new space and base
      const baseIdResult = BaseId.generate();
      if (baseIdResult.isErr()) {
        return yield* Effect.fail(new Error(baseIdResult.error.message));
      }
      baseId = baseIdResult.value.toString();

      const spaceId = `spc${getRandomString(16)}`;
      const actorId = 'cli-pglite';

      yield* Effect.tryPromise({
        try: async () => {
          await db
            .insertInto('space')
            .values({ id: spaceId, name: 'CLI Space', created_by: actorId })
            .execute();

          await db
            .insertInto('base')
            .values({
              id: baseId,
              space_id: spaceId,
              name: 'CLI Base',
              order: 1,
              created_by: actorId,
            })
            .execute();
        },
        catch: (error) => new Error(`Failed to initialize space/base: ${error}`),
      });
    }

    return {
      container: c,
      connectionString: config.connectionString,
      isPglite: true,
      baseId,
    };
  })
);
