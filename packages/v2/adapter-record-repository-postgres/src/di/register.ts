import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type { ComputedUpdateOutboxConfig, HybridWithOutboxStrategyConfig } from '../computed';
import {
  AsyncWithRetryStrategy,
  ComputedFieldUpdater,
  ComputedUpdateOutbox,
  ComputedUpdatePlanner,
  FieldDependencyGraph,
  HybridWithOutboxStrategy,
  SyncInTransactionStrategy,
  defaultComputedUpdateOutboxConfig,
  defaultHybridWithOutboxStrategyConfig,
  ComputedUpdateWorker,
} from '../computed';
import { TableRecordQueryBuilderManager } from '../query-builder';
import { PostgresTableRecordQueryRepository, PostgresTableRecordRepository } from '../repository';
import { v2RecordRepositoryPostgresTokens } from './tokens';

export interface IV2RecordRepositoryPostgresConfig {
  /** Kysely database instance */
  db: Kysely<V1TeableDatabase>;
  computedUpdate?: {
    mode?: 'sync' | 'hybrid' | 'async';
    hybridConfig?: Partial<HybridWithOutboxStrategyConfig>;
    outboxConfig?: Partial<ComputedUpdateOutboxConfig>;
  };
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

  c.register(v2RecordRepositoryPostgresTokens.computedDependencyGraph, FieldDependencyGraph, {
    lifecycle: Lifecycle.Singleton,
  });

  c.register(v2RecordRepositoryPostgresTokens.computedUpdatePlanner, ComputedUpdatePlanner, {
    lifecycle: Lifecycle.Singleton,
  });

  c.register(v2RecordRepositoryPostgresTokens.computedFieldUpdater, ComputedFieldUpdater, {
    lifecycle: Lifecycle.Singleton,
  });

  const hybridConfig: HybridWithOutboxStrategyConfig = {
    ...defaultHybridWithOutboxStrategyConfig,
    ...config.computedUpdate?.hybridConfig,
  };
  const outboxConfig: ComputedUpdateOutboxConfig = {
    ...defaultComputedUpdateOutboxConfig,
    ...config.computedUpdate?.outboxConfig,
  };

  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateHybridConfig, hybridConfig);
  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig, outboxConfig);

  c.register(v2RecordRepositoryPostgresTokens.computedUpdateOutbox, ComputedUpdateOutbox, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2RecordRepositoryPostgresTokens.computedUpdateWorker, ComputedUpdateWorker, {
    lifecycle: Lifecycle.Singleton,
  });

  const strategyMode = config.computedUpdate?.mode ?? 'sync';
  if (strategyMode === 'hybrid') {
    c.register(v2RecordRepositoryPostgresTokens.computedUpdateStrategy, HybridWithOutboxStrategy, {
      lifecycle: Lifecycle.Singleton,
    });
  } else if (strategyMode === 'async') {
    c.register(v2RecordRepositoryPostgresTokens.computedUpdateStrategy, AsyncWithRetryStrategy, {
      lifecycle: Lifecycle.Singleton,
    });
  } else {
    c.register(v2RecordRepositoryPostgresTokens.computedUpdateStrategy, SyncInTransactionStrategy, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  c.register(v2CoreTokens.tableRecordQueryRepository, PostgresTableRecordQueryRepository, {
    lifecycle: Lifecycle.Singleton,
  });

  c.register(v2CoreTokens.tableRecordRepository, PostgresTableRecordRepository, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
