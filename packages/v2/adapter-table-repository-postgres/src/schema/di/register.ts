import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import { ok } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../record/di/tokens';
import type { IV2PostgresDdlAdapterConfig } from '../config';
import { v2PostgresDdlAdapterConfigSchema } from '../config';
import { PostgresTableSchemaRepository } from '../repositories/PostgresTableSchemaRepository';
import { v2PostgresDdlTokens } from './tokens';

class NoopComputedFieldBackfillService {
  async backfill() {
    return ok(undefined);
  }

  async backfillMany() {
    return ok(undefined);
  }

  async executeSync() {
    return ok(undefined);
  }

  async executeSyncMany() {
    return ok(undefined);
  }
}

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

  if (!c.isRegistered(v2RecordRepositoryPostgresTokens.computedFieldBackfillService)) {
    c.registerInstance(
      v2RecordRepositoryPostgresTokens.computedFieldBackfillService,
      new NoopComputedFieldBackfillService()
    );
  }

  c.register(v2CoreTokens.tableSchemaRepository, PostgresTableSchemaRepository, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
