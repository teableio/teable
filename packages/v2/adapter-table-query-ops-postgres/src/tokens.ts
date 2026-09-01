export const v2TableOpsPostgresTokens = {
  config: Symbol('v2.tableOps.postgres.config'),
  metaDb: Symbol('v2.tableOps.postgres.metaDb'),
  dataDb: Symbol('v2.tableOps.postgres.dataDb'),
  observationDb: Symbol('v2.tableOps.postgres.observationDb'),
  observationPublisherLifecycle: Symbol('v2.tableOps.postgres.observationPublisherLifecycle'),
} as const;
