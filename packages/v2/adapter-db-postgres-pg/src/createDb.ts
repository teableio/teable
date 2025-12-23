/* eslint-disable @typescript-eslint/naming-convention */
import { Kysely, PostgresDialect } from 'kysely';
import type { IV2PostgresDbConfig } from './config';

const resolvePgPool = async () => {
  const pgModule = await import('pg');
  const pg = (pgModule.default ?? pgModule) as typeof import('pg');
  return pg.Pool;
};

const createPgDb = async <DB>(config: IV2PostgresDbConfig): Promise<Kysely<DB>> => {
  const connectionString = config.pg.connectionString;
  if (!connectionString) {
    throw new Error('Missing pg.connectionString');
  }

  const Pool = await resolvePgPool();

  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
};

export const createV2PostgresDb = async <DB = unknown>(
  config: IV2PostgresDbConfig
): Promise<Kysely<DB>> => {
  return createPgDb<DB>(config);
};
