import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-shared';
import { Kysely } from 'kysely';
import { BunPostgresDialect } from 'kysely-bun-sql';

const createPostgresBunSqlDb = <DB>(config: IV2PostgresDbConfig): Kysely<DB> => {
  const connectionString = config.pg.connectionString;
  if (!connectionString) {
    throw new Error('Missing pg.connectionString');
  }

  return new Kysely<DB>({
    dialect: new BunPostgresDialect({
      url: connectionString,
    }),
  });
};

export const createV2PostgresBunSqlDb = async <DB = unknown>(
  config: IV2PostgresDbConfig
): Promise<Kysely<DB>> => {
  return createPostgresBunSqlDb<DB>(config);
};
