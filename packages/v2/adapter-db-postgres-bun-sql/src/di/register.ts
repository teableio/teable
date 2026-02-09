import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-shared';
import {
  v2PostgresDbConfigSchema,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-shared';
import type { DependencyContainer } from '@teable/v2-di';
import { container } from '@teable/v2-di';

import { createV2PostgresBunSqlDb } from '../createDb';

export const registerV2PostgresBunSqlDb = async (
  c: DependencyContainer = container,
  rawConfig: Partial<IV2PostgresDbConfig> = {}
): Promise<DependencyContainer> => {
  const parsed = v2PostgresDbConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error('Invalid v2 postgres db config');
  }

  const config = parsed.data;
  const db = await createV2PostgresBunSqlDb(config);

  c.registerInstance(v2PostgresDbTokens.db, db);
  c.registerInstance(v2PostgresDbTokens.config, config);

  return c;
};
