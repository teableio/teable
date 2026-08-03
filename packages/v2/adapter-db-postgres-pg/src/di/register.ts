import type { DependencyContainer } from '@teable/v2-di';
import { container } from '@teable/v2-di';

import type { IV2PostgresDbConfig } from '../config';
import { v2PostgresDbConfigSchema } from '../config';
import { createV2PostgresDb } from '../createDb';
import { v2DataDbTokens, v2MetaDbTokens, v2PostgresDbTokens } from './tokens';

const registerDb = async (
  c: DependencyContainer,
  rawConfig: Partial<IV2PostgresDbConfig>,
  target: 'all' | 'meta' | 'data'
): Promise<DependencyContainer> => {
  const parsed = v2PostgresDbConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error('Invalid v2 postgres db config');
  }

  const config = parsed.data;
  const db = await createV2PostgresDb(config);

  if (target === 'all' || target === 'meta') {
    c.registerInstance(v2MetaDbTokens.db, db);
    c.registerInstance(v2MetaDbTokens.config, config);
  }
  if (target === 'all' || target === 'data') {
    c.registerInstance(v2DataDbTokens.db, db);
    c.registerInstance(v2DataDbTokens.config, config);
  }
  if (target === 'all') {
    c.registerInstance(v2PostgresDbTokens.db, db);
    c.registerInstance(v2PostgresDbTokens.config, config);
  }

  return c;
};

export const registerV2PostgresDb = async (
  c: DependencyContainer = container,
  rawConfig: Partial<IV2PostgresDbConfig> = {}
): Promise<DependencyContainer> => {
  return registerDb(c, rawConfig, 'all');
};

export const registerV2PostgresMetaDb = async (
  c: DependencyContainer = container,
  rawConfig: Partial<IV2PostgresDbConfig> = {}
): Promise<DependencyContainer> => {
  return registerDb(c, rawConfig, 'meta');
};

export const registerV2PostgresDataDb = async (
  c: DependencyContainer = container,
  rawConfig: Partial<IV2PostgresDbConfig> = {}
): Promise<DependencyContainer> => {
  return registerDb(c, rawConfig, 'data');
};
