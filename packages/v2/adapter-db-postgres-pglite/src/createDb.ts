import type { PGliteOptions } from '@electric-sql/pglite';
import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-shared';
import { Kysely } from 'kysely';
import { KyselyPGlite } from './kyselyPgliteBrowser';

/**
 * PGlite constructor options that callers may need to supply when the default
 * on-disk asset lookup cannot work (for example inside a single-file binary).
 */
export type IV2PostgresPgliteOptions = Pick<
  PGliteOptions,
  'wasmModule' | 'fsBundle' | 'loadDataDir'
>;

export interface IV2PostgresPgliteDbConfig extends IV2PostgresDbConfig {
  /**
   * Options forwarded to `PGlite.create`. `dataDir` always comes from
   * `pg.connectionString`, so it cannot be overridden here.
   */
  pglite?: IV2PostgresPgliteOptions;
}

const createPostgresPgliteDb = async <DB>(
  config: IV2PostgresPgliteDbConfig
): Promise<Kysely<DB>> => {
  // PGlite uses a data directory or "memory://" for in-memory databases.
  const dataDir = config.pg.connectionString ?? 'memory://';

  const { dialect } = await KyselyPGlite.create({ ...config.pglite, dataDir });

  return new Kysely<DB>({
    dialect,
  });
};

export const createV2PostgresPgliteDb = async <DB = unknown>(
  config: IV2PostgresPgliteDbConfig
): Promise<Kysely<DB>> => {
  return createPostgresPgliteDb<DB>(config);
};
