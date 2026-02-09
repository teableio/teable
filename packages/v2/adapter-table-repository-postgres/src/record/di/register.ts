import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type {
  ComputedUpdateLockConfig,
  ComputedUpdateOutboxConfig,
  ComputedUpdatePollingConfig,
  FieldBackfillConfig,
  HybridWithOutboxStrategyConfig,
} from '../computed';
import {
  AsyncWithRetryStrategy,
  ComputedFieldBackfillService,
  ComputedFieldUpdater,
  defaultComputedUpdateLockConfig,
  ComputedUpdateOutbox,
  ComputedUpdatePlanner,
  ComputedUpdatePollingService,
  FieldDependencyGraph,
  HybridWithOutboxStrategy,
  SyncInTransactionStrategy,
  defaultComputedUpdateOutboxConfig,
  defaultFieldBackfillConfig,
  defaultHybridWithOutboxStrategyConfig,
  defaultPollingConfig,
  ComputedUpdateWorker,
} from '../computed';
import { TableRecordQueryBuilderManager } from '../query-builder';
import { PostgresTableRecordQueryRepository, PostgresTableRecordRepository } from '../repository';
import { v2RecordRepositoryPostgresTokens } from './tokens';

export interface IV2RecordRepositoryPostgresConfig {
  /** Kysely database instance */
  db: Kysely<V1TeableDatabase>;
  computedUpdate?: {
    /**
     * Strategy mode for computed field updates.
     * @default 'hybrid'
     */
    mode?: 'sync' | 'hybrid' | 'async';
    hybridConfig?: Partial<HybridWithOutboxStrategyConfig>;
    outboxConfig?: Partial<ComputedUpdateOutboxConfig>;
    lockConfig?: Partial<ComputedUpdateLockConfig>;
    /**
     * Polling config for background worker.
     * When enabled, a background polling loop is started automatically.
     * - For 'hybrid' dispatch: polling serves as fallback for missed inline pushes
     * - For 'external' dispatch: polling is the primary execution mechanism
     */
    pollingConfig?: Partial<ComputedUpdatePollingConfig>;
    /**
     * Field backfill config for computed field initialization.
     * Controls how newly created computed fields are backfilled.
     */
    fieldBackfillConfig?: Partial<FieldBackfillConfig>;
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

  c.register(
    v2RecordRepositoryPostgresTokens.computedFieldBackfillService,
    ComputedFieldBackfillService,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );

  const hybridConfig: HybridWithOutboxStrategyConfig = {
    ...defaultHybridWithOutboxStrategyConfig,
    ...config.computedUpdate?.hybridConfig,
  };
  const outboxConfig: ComputedUpdateOutboxConfig = {
    ...defaultComputedUpdateOutboxConfig,
    ...config.computedUpdate?.outboxConfig,
  };
  const lockConfig: ComputedUpdateLockConfig = {
    ...defaultComputedUpdateLockConfig,
    ...config.computedUpdate?.lockConfig,
  };

  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateHybridConfig, hybridConfig);
  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig, outboxConfig);
  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateLockConfig, lockConfig);

  const fieldBackfillConfig: FieldBackfillConfig = {
    ...defaultFieldBackfillConfig,
    ...config.computedUpdate?.fieldBackfillConfig,
  };
  c.registerInstance(v2RecordRepositoryPostgresTokens.fieldBackfillConfig, fieldBackfillConfig);

  // Derive polling enabled from dispatch mode if not explicitly set
  const dispatchMode = hybridConfig.dispatchMode ?? 'push';
  const pollingEnabled =
    config.computedUpdate?.pollingConfig?.enabled ??
    (dispatchMode === 'hybrid' || dispatchMode === 'external');

  const pollingConfig: ComputedUpdatePollingConfig = {
    ...defaultPollingConfig,
    enabled: pollingEnabled,
    // More aggressive polling for external mode
    pollIntervalMs: dispatchMode === 'external' ? 500 : 1000,
    ...config.computedUpdate?.pollingConfig,
  };

  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig, pollingConfig);

  c.register(v2RecordRepositoryPostgresTokens.computedUpdateOutbox, ComputedUpdateOutbox, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2RecordRepositoryPostgresTokens.computedUpdateWorker, ComputedUpdateWorker, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(
    v2RecordRepositoryPostgresTokens.computedUpdatePollingService,
    ComputedUpdatePollingService,
    { lifecycle: Lifecycle.Singleton }
  );

  const strategyMode = config.computedUpdate?.mode ?? 'hybrid';
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
