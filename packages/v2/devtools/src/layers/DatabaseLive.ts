import { Effect, Layer } from 'effect';
import { Database, DatabaseConfig } from '../services/Database';
import { getConnectionString, isPgliteConnection } from '../utils/connection';
import { DatabasePgliteLive } from './DatabasePgliteLive';

export const DatabaseConfigFromOption = (connectionString: string | undefined) =>
  Layer.succeed(DatabaseConfig, {
    connectionString: getConnectionString(connectionString),
  });

/**
 * PostgreSQL database layer (real PostgreSQL connection)
 */
export const DatabasePgLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* DatabaseConfig;

    const { createV2NodePgContainer } = yield* Effect.tryPromise({
      try: () => import('@teable/v2-container-node'),
      catch: (error) => new Error(`Failed to import container-node: ${error}`),
    });

    const container = yield* Effect.tryPromise({
      try: () => createV2NodePgContainer({ connectionString: config.connectionString }),
      catch: (error) => new Error(`Failed to create database container: ${error}`),
    });

    return {
      container,
      connectionString: config.connectionString,
      isPglite: false,
      baseId: undefined,
    };
  })
);

/**
 * Unified database layer that selects pg or pglite based on connection string protocol.
 * - pglite:// protocol -> uses pglite file-based database
 * - postgresql:// or other -> uses real PostgreSQL connection
 */
export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* DatabaseConfig;

    if (isPgliteConnection(config.connectionString)) {
      // Use pglite layer
      const pgliteLayer = DatabasePgliteLive.pipe(
        Layer.provide(Layer.succeed(DatabaseConfig, config))
      );
      return yield* Effect.provide(Database, pgliteLayer);
    } else {
      // Use pg layer
      const pgLayer = DatabasePgLive.pipe(Layer.provide(Layer.succeed(DatabaseConfig, config)));
      return yield* Effect.provide(Database, pgLayer);
    }
  })
);

export const DatabaseLayer = (connectionString?: string) =>
  DatabaseLive.pipe(Layer.provide(DatabaseConfigFromOption(connectionString)));

// Re-export for explicit usage
export { DatabasePgliteLive } from './DatabasePgliteLive';
