import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import {
  formulaSqlPgTokens,
  Pg16TypeValidationStrategy,
  PgLegacyTypeValidationStrategy,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type {
  ComputedUpdateLockConfig,
  ComputedUpdateOutboxConfig,
  ComputedUpdatePollingConfig,
  FieldBackfillConfig,
  HybridWithOutboxStrategyConfig,
} from '../record/computed';
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
} from '../record/computed';
import { v2RecordRepositoryPostgresTokens } from '../record/di/tokens';
import { TableRecordQueryBuilderManager } from '../record/query-builder';
import {
  PostgresTableRecordQueryRepository,
  PostgresTableRecordRepository,
  PostgresRecordOrderCalculator,
  PostgresAttachmentLookupService,
  PostgresUserLookupService,
} from '../record/repository';
import {
  v2PostgresDdlAdapterConfigSchema,
  type IV2PostgresDdlAdapterConfig,
} from '../schema/config';
import { v2PostgresDdlTokens } from '../schema/di/tokens';
import { PostgresTableSchemaRepository } from '../schema/repositories/PostgresTableSchemaRepository';
import { assertTypeValidationPolyfill, hasPgInputIsValid } from '../utils';

// Combined config for unified table repository postgres adapter
export interface IV2TableRepositoryPostgresConfig {
  /** Kysely database instance */
  db: Kysely<V1TeableDatabase>;
  /**
   * Type validation strategy for PostgreSQL version compatibility.
   *
   * If not provided, defaults to `Pg16TypeValidationStrategy` (emits `pg_input_is_valid`).
   * For PostgreSQL < 16, callers must provide a legacy strategy (typically created via
   * `createTypeValidationStrategy(db)` after running DB migrations).
   */
  typeValidationStrategy?: IPgTypeValidationStrategy;
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
    /**
     * Field backfill config for computed field initialization.
     * Controls how newly created computed fields are backfilled.
     */
    fieldBackfillConfig?: Partial<FieldBackfillConfig>;
  };
}

/**
 * Creates the appropriate type validation strategy based on PostgreSQL version.
 * This should be called once at application startup.
 *
 * For PG 16+, returns Pg16TypeValidationStrategy (uses native pg_input_is_valid).
 * For PG < 16, returns PgLegacyTypeValidationStrategy and asserts the polyfill exists.
 */
export async function createTypeValidationStrategy<DB>(
  db: Kysely<DB>
): Promise<IPgTypeValidationStrategy> {
  const hasPgInputValid = await hasPgInputIsValid(db);
  if (hasPgInputValid) {
    return new Pg16TypeValidationStrategy();
  }
  // PG < 16: require polyfill installed via migrations.
  // await assertTypeValidationPolyfill(db);
  return new PgLegacyTypeValidationStrategy();
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

  c.register(v2CoreTokens.userLookupService, PostgresUserLookupService, {
    lifecycle: Lifecycle.Singleton,
  });

  c.register(v2CoreTokens.attachmentLookupService, PostgresAttachmentLookupService, {
    lifecycle: Lifecycle.Singleton,
  });

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

  c.register(v2CoreTokens.recordOrderCalculator, PostgresRecordOrderCalculator, {
    lifecycle: Lifecycle.Singleton,
  });

  c.register(v2CoreTokens.tableRecordRepository, PostgresTableRecordRepository, {
    lifecycle: Lifecycle.Singleton,
  });

  // Register type validation strategy for formula SQL generation
  // If not provided in config, default to Pg16 strategy (works with pglite and PG 16+)
  // For PG < 16, callers should use createTypeValidationStrategy() before registration
  const typeValidationStrategy = config.typeValidationStrategy ?? new Pg16TypeValidationStrategy();
  c.registerInstance(formulaSqlPgTokens.typeValidationStrategy, typeValidationStrategy);

  return c;
};

// Re-export legacy registration functions for backward compatibility
export type { IV2TableRepositoryPostgresConfig as IV2RecordRepositoryPostgresConfig };
export const registerV2RecordRepositoryPostgresAdapter = registerV2TableRepositoryPostgresAdapter;
export const registerV2PostgresDdlAdapter = registerV2TableRepositoryPostgresAdapter;
