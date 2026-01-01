import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import { TableRecordQueryBuilderManager } from '../query-builder';
import { PostgresTableRecordQueryRepository } from '../repository';
import { v2RecordRepositoryPostgresTokens } from './tokens';

export interface IV2RecordRepositoryPostgresConfig {
  /** Kysely database instance */
  db: Kysely<V1TeableDatabase>;
}

export const registerV2RecordRepositoryPostgresAdapter = (
  c: DependencyContainer = container,
  config: IV2RecordRepositoryPostgresConfig
): DependencyContainer => {
  c.registerInstance(v2RecordRepositoryPostgresTokens.db, config.db);

  c.register(
    v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager,
    TableRecordQueryBuilderManager,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );

  c.register(v2CoreTokens.tableRecordQueryRepository, PostgresTableRecordQueryRepository, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
