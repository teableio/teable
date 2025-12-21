/* eslint-disable @typescript-eslint/naming-convention */
import { Kysely, PostgresDialect } from 'kysely';
import pkg from 'pg';
import type { IV2PostgresDbConfig } from './config';

const { Pool } = pkg;

const createPgDb = async <DB>(config: IV2PostgresDbConfig): Promise<Kysely<DB>> => {
  const connectionString = config.pg.connectionString;
  if (!connectionString) {
    throw new Error('Missing pg.connectionString');
  }

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
