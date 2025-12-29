import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-shared';
import { Kysely } from 'kysely';
import { KyselyPGlite } from './kyselyPgliteBrowser';

const createPostgresPgliteDb = async <DB>(config: IV2PostgresDbConfig): Promise<Kysely<DB>> => {
  // PGlite uses a data directory or "memory://" for in-memory databases.
  const dataDir = config.pg.connectionString ?? 'memory://';

  const { dialect } = await KyselyPGlite.create(dataDir);

  return new Kysely<DB>({
    dialect,
  });
};

export const createV2PostgresPgliteDb = async <DB = unknown>(
  config: IV2PostgresDbConfig
): Promise<Kysely<DB>> => {
  return createPostgresPgliteDb<DB>(config);
};
