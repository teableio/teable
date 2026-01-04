export const v2RecordRepositoryPostgresTokens = {
  db: Symbol('v2.adapter.recordRepositoryPostgres.db'),
  tableRecordQueryBuilderManager: Symbol(
    'v2.adapter.recordRepositoryPostgres.tableRecordQueryBuilderManager'
  ),
  computedDependencyGraph: Symbol('v2.adapter.recordRepositoryPostgres.computedDependencyGraph'),
  computedUpdatePlanner: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdatePlanner'),
  computedFieldUpdater: Symbol('v2.adapter.recordRepositoryPostgres.computedFieldUpdater'),
  computedUpdateStrategy: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdateStrategy'),
  computedUpdateHybridConfig: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedUpdateHybridConfig'
  ),
  computedUpdateOutbox: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdateOutbox'),
  computedUpdateOutboxConfig: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedUpdateOutboxConfig'
  ),
  computedUpdateWorker: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdateWorker'),
} as const;
