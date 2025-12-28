import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

import type { IV2PostgresDdlAdapterConfig } from '../config';
import { v2PostgresDdlAdapterConfigSchema } from '../config';
import { PostgresTableSchemaRepository } from '../repositories/PostgresTableSchemaRepository';
import { v2PostgresDdlTokens } from './tokens';

export const registerV2PostgresDdlAdapter = async (
  c: DependencyContainer = container,
  rawConfig: Partial<IV2PostgresDdlAdapterConfig> = {}
): Promise<DependencyContainer> => {
  const parsed = v2PostgresDdlAdapterConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error('Invalid v2 postgres ddl adapter config');
  }

  const config = parsed.data;
  const db = config.db;

  c.registerInstance(v2PostgresDdlTokens.config, config);
  c.registerInstance(v2PostgresDdlTokens.db, db);

  c.register(v2CoreTokens.tableSchemaRepository, PostgresTableSchemaRepository, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
