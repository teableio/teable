import { Effect, Layer } from 'effect';
import { Database, DatabaseConfig } from '../services/Database';
import { DEFAULT_CONNECTION_STRING, getConnectionString } from '../utils/connection';

export const DatabaseConfigFromOption = (connectionString: string | undefined) =>
  Layer.succeed(DatabaseConfig, {
    connectionString: getConnectionString(connectionString),
  });

export const DatabaseLive = Layer.effect(
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
    };
  })
);

export const DatabaseLayer = (connectionString?: string) =>
  DatabaseLive.pipe(Layer.provide(DatabaseConfigFromOption(connectionString)));
