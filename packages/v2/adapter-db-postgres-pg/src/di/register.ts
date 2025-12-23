import type { DependencyContainer } from '@teable/v2-di';
import { container } from '@teable/v2-di';

import type { IV2PostgresDbConfig } from '../config';
import { v2PostgresDbConfigSchema } from '../config';
import { createV2PostgresDb } from '../createDb';
import { v2PostgresDbTokens } from './tokens';

export const registerV2PostgresDb = async (
  c: DependencyContainer = container,
  rawConfig: Partial<IV2PostgresDbConfig> = {}
): Promise<DependencyContainer> => {
  const parsed = v2PostgresDbConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error('Invalid v2 postgres db config');
  }

  const config = parsed.data;
  const db = await createV2PostgresDb(config);

  c.registerInstance(v2PostgresDbTokens.db, db);
  c.registerInstance(v2PostgresDbTokens.config, config);

  return c;
};
