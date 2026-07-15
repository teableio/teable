import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type {
  ComputedUpdateLockConfig,
  ComputedUpdateOutboxConfig,
  FieldBackfillConfig,
  HybridWithOutboxStrategyConfig,
  IComputedOutboxWakeupPublisher,
} from '../computed';
import {
  AsyncWithRetryStrategy,
  ComputedFieldBackfillService,
  ComputedFieldUpdater,
  ComputedUpdateDrainService,
  defaultComputedUpdateLockConfig,
  ComputedUpdateOutbox,
  ComputedUpdatePlanner,
  ExternalComputedRefreshService,
  FieldDependencyGraph,
  HybridWithOutboxStrategy,
  SyncInTransactionStrategy,
  defaultComputedUpdateOutboxConfig,
  defaultFieldBackfillConfig,
  defaultHybridWithOutboxStrategyConfig,
  normalizeComputedUpdateOutboxConfig,
  noopComputedOutboxWakeupPublisher,
  ComputedUpdateWorker,
  UserRenamePropagationService,
} from '../computed';
import { ComputedFieldCascadeAfterSchemaUpdate } from '../computed/ComputedFieldCascadeAfterSchemaUpdate';
import { TableRecordQueryBuilderManager } from '../query-builder';
import {
  PostgresRecordMutationSnapshotCaptureService,
  PostgresTableRecordQueryRepository,
  PostgresTableRecordRepository,
} from '../repository';
import { v2RecordRepositoryPostgresTokens } from './tokens';

export interface IV2RecordRepositoryPostgresConfig {
  /** Kysely database instance for data-plane record storage */
  db: Kysely<V1TeableDatabase>;
  /** Kysely database instance for metadata reads needed by record operations */
  metaDb?: Kysely<V1TeableDatabase>;
  computedUpdate?: {
    /**
     * Strategy mode for computed field updates.
     * @default 'hybrid'
     */
    mode?: 'sync' | 'hybrid' | 'async';
    hybridConfig?: Partial<HybridWithOutboxStrategyConfig>;
    outboxConfig?: Partial<ComputedUpdateOutboxConfig>;
    lockConfig?: Partial<ComputedUpdateLockConfig>;
    wakeupPublisher?: IComputedOutboxWakeupPublisher;
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
  c.registerInstance(v2RecordRepositoryPostgresTokens.metaDb, config.metaDb ?? config.db);

  c.register(
    v2RecordRepositoryPostgresTokens.recordMutationSnapshotCaptureService,
    PostgresRecordMutationSnapshotCaptureService,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );

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
  c.register(ExternalComputedRefreshService, ExternalComputedRefreshService, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.userRenamePropagationService, UserRenamePropagationService, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.computedUpdateDrainService, ComputedUpdateDrainService, {
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
  c.register(v2CoreTokens.computedFieldBackfillService, ComputedFieldBackfillService, {
    lifecycle: Lifecycle.Singleton,
  });

  c.register(
    v2RecordRepositoryPostgresTokens.computedFieldCascadeService,
    ComputedFieldCascadeAfterSchemaUpdate,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );

  const hybridConfig: HybridWithOutboxStrategyConfig = {
    ...defaultHybridWithOutboxStrategyConfig,
    ...config.computedUpdate?.hybridConfig,
  };
  const outboxConfig: ComputedUpdateOutboxConfig = normalizeComputedUpdateOutboxConfig({
    ...defaultComputedUpdateOutboxConfig,
    ...config.computedUpdate?.outboxConfig,
  });
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

  c.registerInstance(
    v2RecordRepositoryPostgresTokens.computedOutboxWakeupPublisher,
    config.computedUpdate?.wakeupPublisher ?? noopComputedOutboxWakeupPublisher
  );

  c.register(v2RecordRepositoryPostgresTokens.computedUpdateOutbox, ComputedUpdateOutbox, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2RecordRepositoryPostgresTokens.computedUpdateWorker, ComputedUpdateWorker, {
    lifecycle: Lifecycle.Singleton,
  });
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
