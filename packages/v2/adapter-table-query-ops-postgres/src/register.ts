import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import { v2CoreTokens, type ITableRepository } from '@teable/v2-core';
import { Lifecycle, type DependencyContainer } from '@teable/v2-di';
import {
  BufferedTableQueryObservationPublisher,
  type BufferedTableQueryObservationPublisherOptions,
  v2TableOpsTokens,
  type TablePhysicalStatsReader,
  type TableQueryIndexInspector,
  type TableQueryObservationPublisher,
  type TableQueryObservationReader,
  type TableQueryDecisionLogRepository,
  type TableQueryObservationSink,
  type TableQueryOpsLeaseRepository,
  type TableQueryPlanValidator,
  type TableQueryRecommendationRepository,
  type TableQueryRemediationExecutor,
  type TableQueryRemediationTaskRepository,
  type TableSearchAccessPathReclaimSource,
  type TableSearchAccessPathResolver,
  type TableSearchVectorReconciler,
  type TableSearchVectorSchemaMaintenanceScheduler,
  type TableSearchVectorStatusReader,
  type TableSearchAccessPathCapabilityReader,
  TableSearchVectorSchemaMaintenanceProjection,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { PostgresTableQueryRemediationExecutor } from './executor';
import { PostgresTableQueryIndexInspector } from './indexInspection';
import { PostgresTableQueryPlanValidator } from './planValidation';
import {
  PostgresTablePhysicalStatsReader,
  PostgresTableQueryDecisionLogRepository,
  PostgresTableQueryObservationRepository,
  PostgresTableQueryOpsLeaseRepository,
  PostgresTableQueryRecommendationRepository,
  PostgresTableQueryRemediationTaskRepository,
  type PostgresTableQueryObservationRepositoryOptions,
} from './repositories';
import {
  ensureTableQueryObservationSchema,
  ensureTableQueryOpsSchema,
  type TableQueryObservationDatabase,
  type TableQueryOpsDatabase,
} from './schema';
import { PostgresTableSearchAccessPathCapabilityReader } from './searchAccessPathCapability';
import { PostgresTableSearchAccessPathReclaimSource } from './searchAccessPathReclaim';
import { PostgresTableSearchVectorReconciler } from './searchVector';
import { PostgresTableSearchVectorSchemaMaintenanceScheduler } from './searchVectorMaintenance';
import {
  PostgresTableSearchAccessPathResolver,
  PostgresTableSearchVectorStatusReader,
} from './searchVectorStatus';
import { v2TableOpsPostgresTokens } from './tokens';
import type { UnknownPostgresDatabase } from './types';

export type TableQueryObservationPublisherLifecycle = {
  flush(): Promise<void>;
  stop(): void;
};

const fallbackPublishers = new Set<BufferedTableQueryObservationPublisher>();
const flushFallbackPublishers = (): void => {
  void Promise.all(Array.from(fallbackPublishers, (publisher) => publisher.flush()));
};

const registerFallbackPublisher = (
  publisher: BufferedTableQueryObservationPublisher
): TableQueryObservationPublisherLifecycle => {
  if (fallbackPublishers.size === 0) process.once('beforeExit', flushFallbackPublishers);
  fallbackPublishers.add(publisher);
  return {
    flush: () => publisher.flush(),
    stop: () => {
      fallbackPublishers.delete(publisher);
      publisher.stop();
      if (fallbackPublishers.size === 0) {
        process.off('beforeExit', flushFallbackPublishers);
      }
    },
  };
};

export const disposeTableQueryObservationPublisher = async (
  container: DependencyContainer
): Promise<void> => {
  if (!container.isRegistered(v2TableOpsPostgresTokens.observationPublisherLifecycle)) return;
  const lifecycle = container.resolve<TableQueryObservationPublisherLifecycle>(
    v2TableOpsPostgresTokens.observationPublisherLifecycle
  );
  await lifecycle.flush();
  lifecycle.stop();
};

export type RegisterV2TableOpsPostgresAdapterOptions<
  MetaDatabase = UnknownPostgresDatabase,
  DataDatabase = UnknownPostgresDatabase,
  ObservationDatabase = UnknownPostgresDatabase,
> = {
  readonly metaDb?: Kysely<MetaDatabase>;
  readonly dataDb?: Kysely<DataDatabase>;
  readonly observationDb?: Kysely<ObservationDatabase>;
  readonly observationDisabled?: boolean;
  readonly observationReader?: TableQueryObservationReader;
  readonly observationSink?: TableQueryObservationSink;
  readonly observationPublisher?: TableQueryObservationPublisher;
  readonly observationWriterId?: string;
  readonly observationBuffer?: Omit<BufferedTableQueryObservationPublisherOptions, 'writerId'>;
  readonly observationBatch?: PostgresTableQueryObservationRepositoryOptions;
  readonly ensureSchema?: boolean;
  readonly ensureObservationSchema?: boolean;
  readonly lifecycle?: Lifecycle;
};

const positiveInteger = z.number().int().positive();
const registerConfigSchema = z.object({
  observationDisabled: z.boolean().optional(),
  ensureObservationSchema: z.boolean().optional(),
  ensureSchema: z.boolean().optional(),
  observationWriterId: z.string().min(1).optional(),
  observationBuffer: z
    .object({
      flushIntervalMs: positiveInteger.optional(),
      maxPendingKeys: positiveInteger.optional(),
      batchSize: positiveInteger.optional(),
    })
    .optional(),
  observationBatch: z
    .object({
      lockTimeoutMs: positiveInteger.optional(),
      readStatementTimeoutMs: positiveInteger.optional(),
      statementTimeoutMs: positiveInteger.optional(),
    })
    .optional(),
});

type ObservationRegistrationInput = {
  readonly metaDb: Kysely<TableQueryObservationDatabase>;
  readonly opsMetaDb: Kysely<TableQueryOpsDatabase>;
  readonly dataDb: Kysely<UnknownPostgresDatabase>;
  readonly db?: Kysely<TableQueryObservationDatabase>;
  readonly disabled?: boolean;
  readonly ensureSchema?: boolean;
  readonly reader?: TableQueryObservationReader;
  readonly sink?: TableQueryObservationSink;
  readonly publisher?: TableQueryObservationPublisher;
  readonly writerId?: string;
  readonly buffer?: Omit<BufferedTableQueryObservationPublisherOptions, 'writerId'>;
  readonly batch?: PostgresTableQueryObservationRepositoryOptions;
};

const registerObservationDependencies = async (
  container: DependencyContainer,
  input: ObservationRegistrationInput
): Promise<void> => {
  const observationDb = input.disabled ? undefined : input.db ?? input.metaDb;
  if (observationDb && input.ensureSchema) {
    await ensureTableQueryObservationSchema(observationDb);
  }
  const repository = observationDb
    ? new PostgresTableQueryObservationRepository(observationDb, input.batch)
    : undefined;
  const sink = input.sink ?? repository;
  const reader = input.reader ?? repository;
  let publisher = input.publisher;
  const fallbackPublisher =
    !publisher && repository
      ? new BufferedTableQueryObservationPublisher(repository, {
          writerId: input.writerId,
          ...input.buffer,
        })
      : undefined;
  publisher ??=
    fallbackPublisher ??
    container.resolve<TableQueryObservationPublisher>(v2TableOpsTokens.observationPublisher);

  await disposeTableQueryObservationPublisher(container);
  const lifecycle: TableQueryObservationPublisherLifecycle = fallbackPublisher
    ? registerFallbackPublisher(fallbackPublisher)
    : { flush: async () => undefined, stop: () => undefined };
  if (observationDb) {
    container.registerInstance(
      v2TableOpsPostgresTokens.observationDb,
      observationDb as unknown as Kysely<UnknownPostgresDatabase>
    );
  }
  if (sink) {
    container.registerInstance<TableQueryObservationSink>(v2TableOpsTokens.observationSink, sink);
  }
  if (reader) {
    container.registerInstance<TableQueryObservationReader>(
      v2TableOpsTokens.observationReader,
      reader
    );
  }
  container.registerInstance<TableQueryObservationPublisher>(
    v2TableOpsTokens.observationPublisher,
    publisher
  );
  container.registerInstance<TableQueryObservationPublisherLifecycle>(
    v2TableOpsPostgresTokens.observationPublisherLifecycle,
    lifecycle
  );

  if (observationDb) {
    container.registerInstance<TableSearchAccessPathReclaimSource>(
      v2TableOpsTokens.searchAccessPathReclaimSource,
      new PostgresTableSearchAccessPathReclaimSource(input.opsMetaDb, observationDb, input.dataDb)
    );
  }
};

export const registerV2TableOpsPostgresAdapter = async <
  MetaDatabase = UnknownPostgresDatabase,
  DataDatabase = UnknownPostgresDatabase,
  ObservationDatabase = UnknownPostgresDatabase,
>(
  container: DependencyContainer,
  rawOptions: RegisterV2TableOpsPostgresAdapterOptions<
    MetaDatabase,
    DataDatabase,
    ObservationDatabase
  > = {}
): Promise<DependencyContainer> => {
  const parsed = registerConfigSchema.safeParse(rawOptions);
  if (!parsed.success) {
    throw new Error('Invalid v2 table ops postgres adapter config');
  }
  const metaDb =
    rawOptions.metaDb ??
    (container.isRegistered(v2MetaDbTokens.db)
      ? container.resolve<Kysely<UnknownPostgresDatabase>>(v2MetaDbTokens.db)
      : undefined);
  if (!metaDb) {
    throw new Error('Missing table ops metaDb');
  }
  const dataDb =
    rawOptions.dataDb ??
    (container.isRegistered(v2DataDbTokens.db)
      ? container.resolve<Kysely<UnknownPostgresDatabase>>(v2DataDbTokens.db)
      : (metaDb as unknown as Kysely<UnknownPostgresDatabase>));
  const unknownMetaDb = metaDb as unknown as Kysely<UnknownPostgresDatabase>;
  const unknownDataDb = dataDb as unknown as Kysely<UnknownPostgresDatabase>;
  const opsMetaDb = metaDb as unknown as Kysely<TableQueryOpsDatabase>;

  if (parsed.data.ensureSchema) {
    await ensureTableQueryOpsSchema(opsMetaDb);
  }

  container.registerInstance(v2TableOpsPostgresTokens.config, parsed.data);
  container.registerInstance(v2TableOpsPostgresTokens.metaDb, unknownMetaDb);
  container.registerInstance(v2TableOpsPostgresTokens.dataDb, unknownDataDb);
  await registerObservationDependencies(container, {
    metaDb: metaDb as unknown as Kysely<TableQueryObservationDatabase>,
    opsMetaDb,
    dataDb: unknownDataDb,
    db: rawOptions.observationDb as Kysely<TableQueryObservationDatabase> | undefined,
    disabled: parsed.data.observationDisabled,
    ensureSchema: parsed.data.ensureObservationSchema ?? parsed.data.ensureSchema,
    reader: rawOptions.observationReader,
    sink: rawOptions.observationSink,
    publisher: rawOptions.observationPublisher,
    writerId: parsed.data.observationWriterId,
    buffer: parsed.data.observationBuffer,
    batch: parsed.data.observationBatch,
  });

  container.registerInstance<TablePhysicalStatsReader>(
    v2TableOpsTokens.physicalStatsReader,
    new PostgresTablePhysicalStatsReader(unknownDataDb)
  );
  container.registerInstance<TableQueryIndexInspector>(
    v2TableOpsTokens.indexInspector,
    new PostgresTableQueryIndexInspector(unknownDataDb)
  );
  container.registerInstance<TableQueryPlanValidator>(
    v2TableOpsTokens.planValidator,
    new PostgresTableQueryPlanValidator(unknownDataDb)
  );
  container.registerInstance<TableQueryRecommendationRepository>(
    v2TableOpsTokens.recommendationRepository,
    new PostgresTableQueryRecommendationRepository(opsMetaDb)
  );
  container.registerInstance<TableQueryDecisionLogRepository>(
    v2TableOpsTokens.decisionLogRepository,
    new PostgresTableQueryDecisionLogRepository(opsMetaDb)
  );
  container.registerInstance<TableQueryRemediationTaskRepository>(
    v2TableOpsTokens.taskRepository,
    new PostgresTableQueryRemediationTaskRepository(opsMetaDb)
  );
  container.registerInstance<TableQueryOpsLeaseRepository>(
    v2TableOpsTokens.leaseRepository,
    new PostgresTableQueryOpsLeaseRepository(opsMetaDb)
  );
  const searchVectorReconciler = new PostgresTableSearchVectorReconciler(
    unknownMetaDb,
    unknownDataDb
  );
  container.registerInstance<TableSearchVectorReconciler>(
    v2TableOpsTokens.searchVectorReconciler,
    searchVectorReconciler
  );
  container.registerInstance<TableSearchVectorReconciler>(
    v2TableOpsTokens.searchAccessPathReconciler,
    searchVectorReconciler
  );
  container.registerInstance<TableSearchVectorStatusReader>(
    v2TableOpsTokens.searchVectorStatusReader,
    new PostgresTableSearchVectorStatusReader(unknownMetaDb)
  );
  container.registerInstance<TableSearchAccessPathResolver>(
    v2TableOpsTokens.searchAccessPathResolver,
    new PostgresTableSearchAccessPathResolver(unknownMetaDb)
  );
  container.registerInstance<TableSearchAccessPathCapabilityReader>(
    v2TableOpsTokens.searchAccessPathCapabilityReader,
    new PostgresTableSearchAccessPathCapabilityReader(unknownDataDb)
  );
  container.registerInstance<TableSearchVectorSchemaMaintenanceScheduler>(
    v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler,
    new PostgresTableSearchVectorSchemaMaintenanceScheduler(unknownMetaDb)
  );
  container.registerInstance<TableQueryRemediationExecutor>(
    v2TableOpsTokens.remediationExecutor,
    new PostgresTableQueryRemediationExecutor(
      unknownMetaDb,
      unknownDataDb,
      container.resolve<ITableRepository>(v2CoreTokens.tableRepository),
      searchVectorReconciler
    )
  );
  container.register(
    TableSearchVectorSchemaMaintenanceProjection,
    TableSearchVectorSchemaMaintenanceProjection,
    { lifecycle: rawOptions.lifecycle ?? Lifecycle.Singleton }
  );

  return container;
};
