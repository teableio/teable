import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import { v2CoreTokens, type ITableRepository } from '@teable/v2-core';
import { Lifecycle, type DependencyContainer } from '@teable/v2-di';
import {
  v2TableOpsTokens,
  type TablePhysicalStatsReader,
  type TableQueryIndexInspector,
  type TableQueryObservationReader,
  type TableQueryObservationSink,
  type TableQueryOpsLeaseRepository,
  type TableQueryPlanValidator,
  type TableQueryRecommendationRepository,
  type TableQueryRemediationExecutor,
  type TableQueryRemediationTaskRepository,
  type TableSearchVectorReconciler,
  type TableSearchVectorSchemaMaintenanceScheduler,
  type TableSearchVectorStatusReader,
  TableSearchVectorSchemaMaintenanceProjection,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { PostgresTableQueryRemediationExecutor } from './executor';
import { PostgresTableQueryIndexInspector } from './indexInspection';
import { PostgresTableQueryPlanValidator } from './planValidation';
import {
  PostgresTablePhysicalStatsReader,
  PostgresTableQueryObservationRepository,
  PostgresTableQueryOpsLeaseRepository,
  PostgresTableQueryRecommendationRepository,
  PostgresTableQueryRemediationTaskRepository,
} from './repositories';
import { ensureTableQueryOpsSchema, type TableQueryOpsDatabase } from './schema';
import { PostgresTableSearchVectorReconciler } from './searchVector';
import { PostgresTableSearchVectorSchemaMaintenanceScheduler } from './searchVectorMaintenance';
import { PostgresTableSearchVectorStatusReader } from './searchVectorStatus';
import { v2TableOpsPostgresTokens } from './tokens';
import type { UnknownPostgresDatabase } from './types';

export type RegisterV2TableOpsPostgresAdapterOptions<
  MetaDatabase = UnknownPostgresDatabase,
  DataDatabase = UnknownPostgresDatabase,
> = {
  readonly metaDb?: Kysely<MetaDatabase>;
  readonly dataDb?: Kysely<DataDatabase>;
  readonly ensureSchema?: boolean;
  readonly lifecycle?: Lifecycle;
};

const registerConfigSchema = z.object({
  ensureSchema: z.boolean().optional(),
});

export const registerV2TableOpsPostgresAdapter = async <
  MetaDatabase = UnknownPostgresDatabase,
  DataDatabase = UnknownPostgresDatabase,
>(
  container: DependencyContainer,
  rawOptions: RegisterV2TableOpsPostgresAdapterOptions<MetaDatabase, DataDatabase> = {}
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

  if (rawOptions.ensureSchema) {
    await ensureTableQueryOpsSchema(opsMetaDb);
  }

  container.registerInstance(v2TableOpsPostgresTokens.config, parsed.data);
  container.registerInstance(v2TableOpsPostgresTokens.metaDb, unknownMetaDb);
  container.registerInstance(v2TableOpsPostgresTokens.dataDb, unknownDataDb);

  const observationRepository = new PostgresTableQueryObservationRepository(opsMetaDb);
  container.registerInstance<TableQueryObservationSink>(
    v2TableOpsTokens.observationSink,
    observationRepository
  );
  container.registerInstance<TableQueryObservationReader>(
    v2TableOpsTokens.observationReader,
    observationRepository
  );

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
  container.registerInstance<TableSearchVectorStatusReader>(
    v2TableOpsTokens.searchVectorStatusReader,
    new PostgresTableSearchVectorStatusReader(unknownMetaDb)
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
