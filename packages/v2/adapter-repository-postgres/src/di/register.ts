import { DefaultTableMapper, registerRecordWritePlugin, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type { IV2PostgresStateAdapterConfig } from '../config';
import { v2PostgresStateAdapterConfigSchema } from '../config';
import { ensureV1MetaSchema } from '../db/schema';
import { PostgresBaseRepository } from '../repositories/PostgresBaseRepository';
import { PostgresTableRepository } from '../repositories/PostgresTableRepository';
import { PostgresTableRowLimitPlugin } from '../repositories/PostgresTableRowLimitPlugin';
import { v2PostgresStateTokens } from './tokens';

export const registerV2PostgresStateAdapter = async (
  c: DependencyContainer = container,
  rawConfig: Partial<IV2PostgresStateAdapterConfig> = {}
): Promise<DependencyContainer> => {
  const parsed = v2PostgresStateAdapterConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error('Invalid v2 postgres state adapter config');
  }

  const config = parsed.data;

  const db = config.db as Kysely<V1TeableDatabase>;
  const ensureSchema = config.ensureSchema ?? false;
  if (ensureSchema) {
    await ensureV1MetaSchema(db);
  }

  c.registerInstance(v2PostgresStateTokens.config, config);
  c.registerInstance(v2PostgresStateTokens.db, db);

  c.register(v2PostgresStateTokens.tableMapper, DefaultTableMapper, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tableMapper, DefaultTableMapper, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tableRepository, PostgresTableRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.baseRepository, PostgresBaseRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  if (typeof config.maxFreeRowLimit === 'number' && config.maxFreeRowLimit > 0) {
    c.registerInstance(v2PostgresStateTokens.maxFreeRowLimit, config.maxFreeRowLimit);
    registerRecordWritePlugin(c, new PostgresTableRowLimitPlugin(db, config.maxFreeRowLimit), {
      source: 'registerV2PostgresStateAdapter',
    });
  }

  return c;
};
