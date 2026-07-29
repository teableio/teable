export const v2TableOpsTokens = {
  observationSink: Symbol('v2.tableOps.observationSink'),
  observationReader: Symbol('v2.tableOps.observationReader'),
  physicalStatsReader: Symbol('v2.tableOps.physicalStatsReader'),
  indexInspector: Symbol('v2.tableOps.indexInspector'),
  planValidator: Symbol('v2.tableOps.planValidator'),
  recommendationRepository: Symbol('v2.tableOps.recommendationRepository'),
  taskRepository: Symbol('v2.tableOps.taskRepository'),
  remediationExecutor: Symbol('v2.tableOps.remediationExecutor'),
  searchVectorReconciler: Symbol('v2.tableOps.searchVectorReconciler'),
  searchAccessPathReconciler: Symbol('v2.tableOps.searchAccessPathReconciler'),
  searchVectorStatusReader: Symbol('v2.tableOps.searchVectorStatusReader'),
  searchAccessPathCapabilityReader: Symbol('v2.tableOps.searchAccessPathCapabilityReader'),
  searchVectorSchemaMaintenanceScheduler: Symbol(
    'v2.tableOps.searchVectorSchemaMaintenanceScheduler'
  ),
  leaseRepository: Symbol('v2.tableOps.leaseRepository'),
  clock: Symbol('v2.tableOps.clock'),
  riskPolicy: Symbol('v2.tableOps.riskPolicy'),
  sqlDiagnosticsConfig: Symbol('v2.tableOps.sqlDiagnosticsConfig'),
  analyzerConfig: Symbol('v2.tableOps.analyzerConfig'),
  taskWorkerConfig: Symbol('v2.tableOps.taskWorkerConfig'),
} as const;
