import {
  v2CoreTokens,
  type ICommandBus,
  type IExecutionContext,
  type ILogger,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import {
  AnalyzeAndRecommendTableQueryCommand,
  RunTableQueryRemediationTaskCommand,
} from './application';
import type {
  TableQueryObservationReader,
  TableQueryOpsAnalyzerConfig,
  TableQueryOpsClock,
  TableQueryOpsLeaseRepository,
  TableQueryOpsTaskWorkerConfig,
  TableQueryRemediationTaskRepository,
} from './ports';
import { v2TableOpsTokens } from './tokens';

export type TableQueryOpsRunnerHandle = {
  readonly stop: () => void;
};

export const startTableQueryOpsAnalyzerIfEnabled = (
  container: DependencyContainer,
  context: IExecutionContext
): TableQueryOpsRunnerHandle | undefined => {
  const config = container.resolve<TableQueryOpsAnalyzerConfig>(v2TableOpsTokens.analyzerConfig);
  if (!config.enabled) return undefined;
  const timer = setInterval(() => {
    void runAnalyzerOnce(container, context, config);
  }, config.intervalMs);
  void runAnalyzerOnce(container, context, config);
  return { stop: () => clearInterval(timer) };
};

export const startTableQueryOpsTaskWorkerIfEnabled = (
  container: DependencyContainer,
  context: IExecutionContext
): TableQueryOpsRunnerHandle | undefined => {
  const config = container.resolve<TableQueryOpsTaskWorkerConfig>(
    v2TableOpsTokens.taskWorkerConfig
  );
  if (!config.enabled) return undefined;
  const timer = setInterval(() => {
    void runTaskWorkerOnce(container, context, config);
  }, config.intervalMs);
  void runTaskWorkerOnce(container, context, config);
  return { stop: () => clearInterval(timer) };
};

const runAnalyzerOnce = async (
  container: DependencyContainer,
  context: IExecutionContext,
  config: TableQueryOpsAnalyzerConfig
): Promise<void> => {
  const logger = resolveOptionalLogger(container);
  const leaseRepository = resolveOptionalLeaseRepository(container);
  const clock = container.resolve<TableQueryOpsClock>(v2TableOpsTokens.clock);
  const acquired = await leaseRepository?.acquire(context, {
    leaseKey: 'table-query-ops-analyzer',
    ownerId: config.workerId,
    ttlMs: config.intervalMs,
    now: clock.now(),
  });
  if (acquired && (acquired.isErr() || acquired.value === false)) return;
  const reader = container.resolve<TableQueryObservationReader>(v2TableOpsTokens.observationReader);
  const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  const windows = await reader.findRecent(context, {
    since: new Date(clock.now().getTime() - config.lookbackMs),
    limit: config.batchSize,
  });
  if (windows.isErr()) {
    logger?.warn('Table query ops analyzer failed to read observations', {
      error: windows.error.message,
    });
    return;
  }
  for (const observation of windows.value) {
    const result = await commandBus.execute(
      context,
      new AnalyzeAndRecommendTableQueryCommand(observation)
    );
    if (result.isErr()) {
      logger?.warn('Table query ops analyzer failed to analyze observation', {
        error: result.error.message,
        tableId: observation.tableId(),
      });
    }
  }
};

const runTaskWorkerOnce = async (
  container: DependencyContainer,
  context: IExecutionContext,
  config: TableQueryOpsTaskWorkerConfig
): Promise<void> => {
  const logger = resolveOptionalLogger(container);
  const taskRepository = container.resolve<TableQueryRemediationTaskRepository>(
    v2TableOpsTokens.taskRepository
  );
  const clock = container.resolve<TableQueryOpsClock>(v2TableOpsTokens.clock);
  const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  const claimed = await taskRepository.claimNextAccepted(context, {
    workerId: config.workerId,
    now: clock.now(),
    allowedKinds: config.allowedKinds,
  });
  if (claimed.isErr()) {
    logger?.warn('Table query ops task worker failed to claim task', {
      error: claimed.error.message,
    });
    return;
  }
  if (!claimed.value) return;
  const result = await commandBus.execute(
    context,
    new RunTableQueryRemediationTaskCommand(
      claimed.value.snapshot().id,
      config.allowManualIndexExecution,
      config.workerId
    )
  );
  if (result.isErr()) {
    logger?.warn('Table query ops task worker failed to run task', {
      error: result.error.message,
      taskId: claimed.value.snapshot().id,
    });
  }
};

const resolveOptionalLogger = (container: DependencyContainer): ILogger | undefined =>
  container.isRegistered(v2CoreTokens.logger)
    ? container.resolve<ILogger>(v2CoreTokens.logger)
    : undefined;

const resolveOptionalLeaseRepository = (
  container: DependencyContainer
): TableQueryOpsLeaseRepository | undefined =>
  container.isRegistered(v2TableOpsTokens.leaseRepository)
    ? container.resolve<TableQueryOpsLeaseRepository>(v2TableOpsTokens.leaseRepository)
    : undefined;
