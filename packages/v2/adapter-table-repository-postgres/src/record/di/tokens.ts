export const v2RecordRepositoryPostgresTokens = {
  db: Symbol('v2.adapter.recordRepositoryPostgres.db'),
  metaDb: Symbol('v2.adapter.recordRepositoryPostgres.metaDb'),
  recordMutationSnapshotCaptureService: Symbol(
    'v2.adapter.recordRepositoryPostgres.recordMutationSnapshotCaptureService'
  ),
  tableRecordQueryBuilderManager: Symbol(
    'v2.adapter.recordRepositoryPostgres.tableRecordQueryBuilderManager'
  ),
  computedDependencyGraph: Symbol('v2.adapter.recordRepositoryPostgres.computedDependencyGraph'),
  computedUpdatePlanner: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdatePlanner'),
  computedFieldUpdater: Symbol('v2.adapter.recordRepositoryPostgres.computedFieldUpdater'),
  computedUpdateStrategy: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdateStrategy'),
  computedUpdateLockConfig: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdateLockConfig'),
  computedUpdateHybridConfig: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedUpdateHybridConfig'
  ),
  computedUpdateOutbox: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdateOutbox'),
  computedOutboxWakeupPublisher: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedOutboxWakeupPublisher'
  ),
  computedUpdatePauseRegistry: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedUpdatePauseRegistry'
  ),
  computedUpdateOutboxConfig: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedUpdateOutboxConfig'
  ),
  computedUpdateWorker: Symbol('v2.adapter.recordRepositoryPostgres.computedUpdateWorker'),
  computedFieldBackfillService: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedFieldBackfillService'
  ),
  fieldBackfillConfig: Symbol('v2.adapter.recordRepositoryPostgres.fieldBackfillConfig'),
  computedFieldCascadeService: Symbol(
    'v2.adapter.recordRepositoryPostgres.computedFieldCascadeService'
  ),
} as const;
