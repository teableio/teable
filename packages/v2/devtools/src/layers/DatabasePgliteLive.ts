import * as fs from 'node:fs';
import * as path from 'node:path';
import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import {
  PostgresUnitOfWork,
  registerV2PostgresPgliteDb,
  v2DataDbTokens,
  v2MetaDbTokens,
} from '@teable/v2-adapter-db-postgres-pglite';
import { ConsoleLogger } from '@teable/v2-adapter-logger-console';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  installUndoCaptureGlobals,
  registerV2TableRepositoryPostgresAdapter,
} from '@teable/v2-adapter-table-repository-postgres';
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
import { sql } from 'kysely';
import { Database, DatabaseConfig } from '../services/Database';
import { getAbsolutePgliteDataDir } from '../utils/connection';
import { NodeCryptoHasher } from './NodeCryptoHasher';
import { StderrLogger } from './StderrLogger';

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

    // JSON output reserves stdout for the DTO, including diagnostics emitted while
    // adapters and plugins are registered.
    if (config.diagnostics === 'stderr') {
      c.registerInstance(v2CoreTokens.logger, new StderrLogger());
    }

    // Register pglite database
    yield* Effect.tryPromise({
      try: () =>
        registerV2PostgresPgliteDb(c, {
          pg: { connectionString: absoluteDataDir },
        }),
      catch: (error) => new Error(`Failed to register pglite database: ${error}`),
    });

    const metaDb = c.resolve(v2MetaDbTokens.db) as Kysely<V1TeableDatabase>;
    const dataDb = c.resolve(v2DataDbTokens.db) as Kysely<V1TeableDatabase>;

    // Preview uses existing metadata only. Schema creation belongs to ordinary
    // devtools commands and would violate preview's strict no-write contract.
    yield* Effect.tryPromise({
      try: () =>
        registerV2PostgresStateAdapter(c, {
          db: metaDb,
          ensureSchema: config.initializePglite,
        }),
      catch: (error) => new Error(`Failed to register state adapter: ${error}`),
    });

    // Register table repository postgres adapter
    registerV2TableRepositoryPostgresAdapter(c, {
      db: dataDb,
      computedUpdate: { mode: 'sync' },
    });

    // Register core dependencies
    c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork, {
      lifecycle: Lifecycle.Singleton,
    });
    if (config.diagnostics === 'default') {
      c.registerInstance(v2CoreTokens.logger, new ConsoleLogger());
    }
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
    c.registerInstance(v2CoreTokens.internalCommandBus, commandBus);
    c.registerInstance(v2CoreTokens.queryBus, queryBus);
    c.registerInstance(v2CoreTokens.eventBus, eventBus);

    // Register core services
    registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });

    // Check if space/base already exists
    const existingBase = yield* Effect.tryPromise({
      try: async () => {
        try {
          const result = await metaDb.selectFrom('base').select('id').limit(1).execute();
          return result.length > 0 ? result[0].id : null;
        } catch {
          // Table doesn't exist yet, return null
          return null;
        }
      },
      catch: () => null as string | null,
    });

    let baseId: string | undefined = existingBase ?? undefined;

    if (config.initializePglite) {
      if (!baseId) {
        // Create the local workspace used by ordinary mutable devtools commands.
        const baseIdResult = BaseId.generate();
        if (baseIdResult.isErr()) {
          return yield* Effect.fail(new Error(baseIdResult.error.message));
        }
        const generatedBaseId = baseIdResult.value.toString();
        baseId = generatedBaseId;

        const spaceId = `spc${getRandomString(16)}`;
        const actorId = 'cli-pglite';

        yield* Effect.tryPromise({
          try: async () => {
            await metaDb
              .insertInto('space')
              .values({ id: spaceId, name: 'CLI Space', created_by: actorId })
              .execute();

            await metaDb
              .insertInto('base')
              .values({
                id: generatedBaseId,
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

      // Same local bootstrap as the headless runtime: record mutations need the
      // undo-capture globals and resolve actors through `public.users`.
      yield* Effect.tryPromise({
        try: () => installUndoCaptureGlobals(metaDb as unknown as Kysely<unknown>),
        catch: (error) => new Error(`Failed to install pglite undo capture globals: ${error}`),
      });

      yield* Effect.tryPromise({
        try: async () => {
          await sql`
            create table if not exists public.users (
              id varchar(255) primary key,
              name varchar(255) not null,
              email varchar(255)
            )
          `.execute(metaDb);
          for (const actorId of [
            'cli-mock-records',
            'cli-record-mutation',
            'cli-pglite',
            'system',
          ]) {
            await sql`
              insert into public.users (id, name)
              values (${actorId}, ${actorId})
              on conflict (id) do nothing
            `.execute(metaDb);
          }
        },
        catch: (error) => new Error(`Failed to bootstrap pglite users: ${error}`),
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
