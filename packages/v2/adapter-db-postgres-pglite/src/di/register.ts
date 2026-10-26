import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-shared';
import {
  v2DataDbTokens,
  v2MetaDbTokens,
  v2PostgresDbConfigSchema,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-shared';
import type { DependencyContainer } from '@teable/v2-di';
import { container } from '@teable/v2-di';

import { createV2PostgresPgliteDb, type IV2PostgresPgliteOptions } from '../createDb';

export type IV2PostgresPgliteRegisterConfig = Partial<IV2PostgresDbConfig> & {
  pglite?: IV2PostgresPgliteOptions;
};

export const registerV2PostgresPgliteDb = async (
  c: DependencyContainer = container,
  rawConfig: IV2PostgresPgliteRegisterConfig = {}
): Promise<DependencyContainer> => {
  const { pglite, ...pgConfig } = rawConfig;
  const parsed = v2PostgresDbConfigSchema.safeParse(pgConfig);
  if (!parsed.success) {
    throw new Error('Invalid v2 postgres db config');
  }

  const config = parsed.data;
  const db = await createV2PostgresPgliteDb({ ...config, pglite });

  c.registerInstance(v2MetaDbTokens.db, db);
  c.registerInstance(v2MetaDbTokens.config, config);
  c.registerInstance(v2DataDbTokens.db, db);
  c.registerInstance(v2DataDbTokens.config, config);
  c.registerInstance(v2PostgresDbTokens.db, db);
  c.registerInstance(v2PostgresDbTokens.config, config);

  return c;
};
