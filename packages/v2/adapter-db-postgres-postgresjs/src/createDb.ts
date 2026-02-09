import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-shared';
import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';

const createPostgresJsDb = <DB>(config: IV2PostgresDbConfig): Kysely<DB> => {
  const connectionString = config.pg.connectionString;
  if (!connectionString) {
    throw new Error('Missing pg.connectionString');
  }

  const sql = postgres(connectionString, {
    onnotice: () => undefined,
  });

  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: sql,
    }),
  });
};

export const createV2PostgresJsDb = async <DB = unknown>(
  config: IV2PostgresDbConfig
): Promise<Kysely<DB>> => {
  return createPostgresJsDb<DB>(config);
};
