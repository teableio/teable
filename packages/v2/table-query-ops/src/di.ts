import { Lifecycle, type DependencyContainer } from '@teable/v2-di';

import {
  AcceptTableQueryRecommendationHandler,
  AnalyzeAndRecommendTableQueryHandler,
  AnalyzeTableQueryRiskHandler,
  DecideTableQueryRecommendationHandler,
  DismissTableQueryRecommendationHandler,
  NoopTableQueryObservationReader,
  NoopTableQueryObservationSink,
  NoopTableQueryPlanValidator,
  RecordTableQueryObservationHandler,
  RunTableQueryRecommendedIndexHandler,
  RunTableQueryRemediationTaskHandler,
} from './application';
import {
  TableQueryDecisionPolicy,
  defaultTableQueryDecisionPolicyConfig,
  type TableQueryDecisionPolicyConfig,
} from './decisionPolicy';
import {
  TableQueryRiskPolicy,
  defaultTableQueryRiskPolicyConfig,
  type TableQueryRiskPolicyConfig,
} from './domain';
import {
  NoopTableQueryDecisionLogRepository,
  NoopTableQueryObservationPublisher,
  NoopTableSearchVectorSchemaMaintenanceScheduler,
  SystemTableQueryOpsClock,
  type TableQueryOpsAnalyzerConfig,
  type TableQueryOpsTaskWorkerConfig,
} from './ports';
import { TableSearchVectorSchemaMaintenanceProjection } from './searchVectorSchemaMaintenance';
import {
  defaultTableQuerySqlDiagnosticsConfig,
  type TableQuerySqlDiagnosticsConfig,
} from './sqlDiagnostics';
import { v2TableOpsTokens } from './tokens';

export type RegisterV2TableOpsOptions = {
  readonly riskPolicyConfig?: Partial<TableQueryRiskPolicyConfig>;
  readonly decisionPolicyConfig?: Partial<TableQueryDecisionPolicyConfig>;
  readonly sqlDiagnosticsConfig?: Partial<TableQuerySqlDiagnosticsConfig>;
  readonly analyzerConfig?: Partial<TableQueryOpsAnalyzerConfig>;
  readonly taskWorkerConfig?: Partial<TableQueryOpsTaskWorkerConfig>;
  readonly lifecycle?: Lifecycle;
};

export const registerV2TableOps = (
  container: DependencyContainer,
  options: RegisterV2TableOpsOptions = {}
): DependencyContainer => {
  const lifecycle = options.lifecycle ?? Lifecycle.Singleton;

  if (!container.isRegistered(v2TableOpsTokens.clock)) {
    container.register(v2TableOpsTokens.clock, SystemTableQueryOpsClock, { lifecycle });
  }
  if (!container.isRegistered(v2TableOpsTokens.riskPolicy)) {
    container.registerInstance(
      v2TableOpsTokens.riskPolicy,
      new TableQueryRiskPolicy({
        ...defaultTableQueryRiskPolicyConfig,
        ...options.riskPolicyConfig,
      })
    );
  }
  if (!container.isRegistered(v2TableOpsTokens.decisionPolicy)) {
    container.registerInstance(
      v2TableOpsTokens.decisionPolicy,
      new TableQueryDecisionPolicy({
        ...defaultTableQueryDecisionPolicyConfig,
        ...options.decisionPolicyConfig,
      })
    );
  }
  if (!container.isRegistered(v2TableOpsTokens.decisionLogRepository)) {
    container.register(
      v2TableOpsTokens.decisionLogRepository,
      NoopTableQueryDecisionLogRepository,
      {
        lifecycle,
      }
    );
  }
  if (!container.isRegistered(v2TableOpsTokens.sqlDiagnosticsConfig)) {
    container.registerInstance(v2TableOpsTokens.sqlDiagnosticsConfig, {
      ...defaultTableQuerySqlDiagnosticsConfig,
      ...options.sqlDiagnosticsConfig,
    } satisfies TableQuerySqlDiagnosticsConfig);
  }
  if (!container.isRegistered(v2TableOpsTokens.observationSink)) {
    container.register(v2TableOpsTokens.observationSink, NoopTableQueryObservationSink, {
      lifecycle,
    });
  }
  if (!container.isRegistered(v2TableOpsTokens.observationPublisher)) {
    container.register(v2TableOpsTokens.observationPublisher, NoopTableQueryObservationPublisher, {
      lifecycle,
    });
  }
  if (!container.isRegistered(v2TableOpsTokens.observationReader)) {
    container.register(v2TableOpsTokens.observationReader, NoopTableQueryObservationReader, {
      lifecycle,
    });
  }
  if (!container.isRegistered(v2TableOpsTokens.planValidator)) {
    container.register(v2TableOpsTokens.planValidator, NoopTableQueryPlanValidator, {
      lifecycle,
    });
  }
  // The projection is registered into the global event bus by @ProjectionHandler on
  // package import. Always wire a scheduler + the class token so field events never
  // hit "unregistered dependency" when table-query-ops postgres adapters are off.
  if (!container.isRegistered(v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler)) {
    container.register(
      v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler,
      NoopTableSearchVectorSchemaMaintenanceScheduler,
      { lifecycle }
    );
  }
  if (!container.isRegistered(TableSearchVectorSchemaMaintenanceProjection)) {
    container.register(
      TableSearchVectorSchemaMaintenanceProjection,
      TableSearchVectorSchemaMaintenanceProjection,
      { lifecycle }
    );
  }
  if (!container.isRegistered(v2TableOpsTokens.analyzerConfig)) {
    container.registerInstance(v2TableOpsTokens.analyzerConfig, {
      enabled: false,
      intervalMs: 60_000,
      lookbackMs: 15 * 60_000,
      batchSize: 100,
      workerId: 'table-query-ops-analyzer',
      ...options.analyzerConfig,
    } satisfies TableQueryOpsAnalyzerConfig);
  }
  if (!container.isRegistered(v2TableOpsTokens.taskWorkerConfig)) {
    container.registerInstance(v2TableOpsTokens.taskWorkerConfig, {
      enabled: false,
      intervalMs: 60_000,
      workerId: 'table-query-ops-task-worker',
      allowManualIndexExecution: false,
      allowPolicyIndexExecution: false,
      allowedKinds: ['manual_investigation'],
      ...options.taskWorkerConfig,
    } satisfies TableQueryOpsTaskWorkerConfig);
  }

  container.register(RecordTableQueryObservationHandler, RecordTableQueryObservationHandler, {
    lifecycle,
  });
  container.register(AnalyzeTableQueryRiskHandler, AnalyzeTableQueryRiskHandler, { lifecycle });
  container.register(AnalyzeAndRecommendTableQueryHandler, AnalyzeAndRecommendTableQueryHandler, {
    lifecycle,
  });
  container.register(AcceptTableQueryRecommendationHandler, AcceptTableQueryRecommendationHandler, {
    lifecycle,
  });
  container.register(
    DismissTableQueryRecommendationHandler,
    DismissTableQueryRecommendationHandler,
    { lifecycle }
  );
  container.register(DecideTableQueryRecommendationHandler, DecideTableQueryRecommendationHandler, {
    lifecycle,
  });
  container.register(RunTableQueryRemediationTaskHandler, RunTableQueryRemediationTaskHandler, {
    lifecycle,
  });
  container.register(RunTableQueryRecommendedIndexHandler, RunTableQueryRecommendedIndexHandler, {
    lifecycle,
  });

  return container;
};
