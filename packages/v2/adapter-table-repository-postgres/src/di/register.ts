import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type {
  ComputedUpdateLockConfig,
  ComputedUpdateOutboxConfig,
  ComputedUpdatePollingConfig,
  HybridWithOutboxStrategyConfig,
} from '../record/computed';
import {
  AsyncWithRetryStrategy,
  ComputedFieldUpdater,
  defaultComputedUpdateLockConfig,
  ComputedUpdateOutbox,
  ComputedUpdatePlanner,
  ComputedUpdatePollingService,
  FieldDependencyGraph,
  HybridWithOutboxStrategy,
  SyncInTransactionStrategy,
  defaultComputedUpdateOutboxConfig,
  defaultHybridWithOutboxStrategyConfig,
  defaultPollingConfig,
  ComputedUpdateWorker,
} from '../record/computed';
import { v2RecordRepositoryPostgresTokens } from '../record/di/tokens';
import { TableRecordQueryBuilderManager } from '../record/query-builder';
import {
  PostgresTableRecordQueryRepository,
  PostgresTableRecordRepository,
} from '../record/repository';
import {
  v2PostgresDdlAdapterConfigSchema,
  type IV2PostgresDdlAdapterConfig,
} from '../schema/config';
import { v2PostgresDdlTokens } from '../schema/di/tokens';
import { PostgresTableSchemaRepository } from '../schema/repositories/PostgresTableSchemaRepository';

// Combined config for unified table repository postgres adapter
export interface IV2TableRepositoryPostgresConfig {
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
    pollingConfig?: Partial<ComputedUpdatePollingConfig>;
  };
}

/**
 * Register unified table repository postgres adapter.
 * This combines both schema (DDL) and record (DML) repositories.
 */
export const registerV2TableRepositoryPostgresAdapter = (
  c: DependencyContainer = container,
  config: IV2TableRepositoryPostgresConfig
): DependencyContainer => {
  // Register schema (DDL) components
  const ddlConfig: IV2PostgresDdlAdapterConfig = { db: config.db };
  const parsed = v2PostgresDdlAdapterConfigSchema.safeParse(ddlConfig);
  if (!parsed.success) {
    throw new Error('Invalid v2 postgres ddl adapter config');
  }
  c.registerInstance(v2PostgresDdlTokens.config, parsed.data);
  c.registerInstance(v2PostgresDdlTokens.db, config.db);

  c.register(v2CoreTokens.tableSchemaRepository, PostgresTableSchemaRepository, {
    lifecycle: Lifecycle.Singleton,
  });

  // Register record (DML) components
  c.registerInstance(v2RecordRepositoryPostgresTokens.db, config.db);

  c.register(
    v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager,
    TableRecordQueryBuilderManager,
    { lifecycle: Lifecycle.Singleton }
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
  const lockConfig: ComputedUpdateLockConfig = {
    ...defaultComputedUpdateLockConfig,
    ...config.computedUpdate?.lockConfig,
  };

  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateHybridConfig, hybridConfig);
  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig, outboxConfig);
  c.registerInstance(v2RecordRepositoryPostgresTokens.computedUpdateLockConfig, lockConfig);

  const dispatchMode = hybridConfig.dispatchMode ?? 'push';
  const pollingEnabled =
    config.computedUpdate?.pollingConfig?.enabled ??
    (dispatchMode === 'hybrid' || dispatchMode === 'external');

  const pollingConfig: ComputedUpdatePollingConfig = {
    ...defaultPollingConfig,
    enabled: pollingEnabled,
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

// Re-export legacy registration functions for backward compatibility
export type { IV2TableRepositoryPostgresConfig as IV2RecordRepositoryPostgresConfig };
export const registerV2RecordRepositoryPostgresAdapter = registerV2TableRepositoryPostgresAdapter;
export const registerV2PostgresDdlAdapter = registerV2TableRepositoryPostgresAdapter;
