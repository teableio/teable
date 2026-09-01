import {
  v2CoreTokens,
  type ICommandBus,
  type IExecutionContext,
  type ILogger,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import {
  AnalyzeAndRecommendTableQueryCommand,
  DecideTableQueryRecommendationCommand,
  RunTableQueryRemediationTaskCommand,
  type AnalyzeAndRecommendTableQueryResult,
} from './application';
import { TableQueryDecisionLogEntry, type TableQueryDecisionPolicy } from './decisionPolicy';
import {
  defaultTableQueryRiskPolicyConfig,
  SEARCH_ACCESS_PATH_RECOMMENDATION_SHAPE_HASH,
  stableHash,
  TableQueryObservationWindow,
  TableQueryRemediationTask,
  TableQueryShape,
  type TableQueryRiskPolicy,
} from './domain';
import type {
  TableQueryDecisionLogRepository,
  TableQueryObservationReader,
  TableQueryOpsAnalyzerConfig,
  TableQueryOpsClock,
  TableQueryOpsLeaseRepository,
  TableQueryOpsTaskWorkerConfig,
  TableQueryRemediationTaskRepository,
  TableQuerySearchHeatByTable,
  TableSearchAccessPathReclaimCandidate,
  TableSearchAccessPathReclaimSource,
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
    const result = await commandBus.execute<
      AnalyzeAndRecommendTableQueryCommand,
      AnalyzeAndRecommendTableQueryResult
    >(context, new AnalyzeAndRecommendTableQueryCommand(observation));
    if (result.isErr()) {
      logger?.warn('Table query ops analyzer failed to analyze observation', {
        error: result.error.message,
        tableId: observation.tableId(),
      });
      continue;
    }
    const { report, recommendation } = result.value;
    if (!recommendation) continue;
    const decided = await commandBus.execute(
      context,
      new DecideTableQueryRecommendationCommand(recommendation, report)
    );
    if (decided.isErr()) {
      logger?.warn('Table query ops analyzer failed to decide on recommendation', {
        error: decided.error.message,
        tableId: observation.tableId(),
        recommendationId: recommendation.snapshot().id,
      });
    }
  }

  await runReclaimSweepOnce(container, context, clock, logger, config.workerId);
  await runSearchAccessPathRecommendSweepOnce(container, context);
};

/** Reclaim thresholds are 30-day scale; sweeping more than daily is pure waste. */
const RECLAIM_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Reclaims idle search access paths: for every ready config past the minimum hold
 * with no observed search traffic and zero index scans over the idle window, queue a
 * drop task. The policy enforces every guard; unknown usage evidence never reclaims.
 */
export const runReclaimSweepOnce = async (
  container: DependencyContainer,
  context: IExecutionContext,
  clock: TableQueryOpsClock,
  logger: ILogger | undefined,
  workerId: string
): Promise<void> => {
  if (!container.isRegistered(v2TableOpsTokens.searchAccessPathReclaimSource)) return;
  const leaseRepository = resolveOptionalLeaseRepository(container);
  if (leaseRepository) {
    const leaseNow = clock.now();
    // Unique owner per attempt: the lease's same-owner renewal path would let a
    // single worker re-acquire every analyzer tick, defeating the daily cadence.
    const acquired = await leaseRepository.acquire(context, {
      leaseKey: 'table-query-ops-reclaim-sweep',
      ownerId: `${workerId}:${leaseNow.getTime()}`,
      ttlMs: RECLAIM_SWEEP_INTERVAL_MS,
      now: leaseNow,
    });
    if (acquired.isErr() || acquired.value === false) return;
  }
  const reclaimSource = container.resolve<TableSearchAccessPathReclaimSource>(
    v2TableOpsTokens.searchAccessPathReclaimSource
  );
  const decisionPolicy = container.resolve<TableQueryDecisionPolicy>(
    v2TableOpsTokens.decisionPolicy
  );
  const decisionLogRepository = container.resolve<TableQueryDecisionLogRepository>(
    v2TableOpsTokens.decisionLogRepository
  );
  const taskRepository = container.resolve<TableQueryRemediationTaskRepository>(
    v2TableOpsTokens.taskRepository
  );
  const now = clock.now();
  const config = decisionPolicy.reclaimConfig();
  const candidates = await reclaimSource.listCandidates(context, {
    now,
    minHoldMs: config.reclaimMinHoldMs,
    idleMs: config.reclaimIdleMs,
  });
  if (candidates.isErr()) {
    logger?.warn('Table query ops reclaim sweep failed to list candidates', {
      error: candidates.error.message,
    });
    return;
  }
  for (const candidate of candidates.value) {
    await reclaimOneCandidate(
      {
        context,
        now,
        decisionPolicy,
        decisionLogRepository,
        taskRepository,
        reclaimSource,
        logger,
      },
      candidate
    );
  }
};

type ReclaimCandidateDeps = {
  readonly context: IExecutionContext;
  readonly now: Date;
  readonly decisionPolicy: TableQueryDecisionPolicy;
  readonly decisionLogRepository: TableQueryDecisionLogRepository;
  readonly taskRepository: TableQueryRemediationTaskRepository;
  readonly reclaimSource: TableSearchAccessPathReclaimSource;
  readonly logger: ILogger | undefined;
};

export const reclaimDropTaskId = (tableId: string, scopeKey: string, dropAfter: Date): string =>
  `tqt_reclaim_${tableId}_${dropAfter.getTime()}_${stableHash(scopeKey)}`;

const queueDueReclaimDrop = async (
  deps: ReclaimCandidateDeps,
  candidate: Extract<TableSearchAccessPathReclaimCandidate, { readonly phase: 'drop_due' }>
): Promise<void> => {
  const claimed = await deps.reclaimSource.claimDueDrop(deps.context, {
    tableId: candidate.tableId,
    scopeKey: candidate.scopeKey,
    now: deps.now,
  });
  if (claimed.isErr() || !claimed.value) return;
  const task = TableQueryRemediationTask.createQueued({
    id: reclaimDropTaskId(candidate.tableId, candidate.scopeKey, candidate.dropAfter),
    tableId: candidate.tableId,
    baseId: candidate.baseId,
    kind: 'drop_search_access_path',
    payload: { trigger: 'reclaim', scopeKey: candidate.scopeKey },
    now: deps.now,
  });
  if (task.isErr()) {
    await deps.reclaimSource.releaseDueDrop(deps.context, candidate);
    return;
  }
  const saved = await deps.taskRepository.saveIfAbsent(deps.context, task.value);
  if (saved.isOk()) {
    if (!saved.value) {
      deps.logger?.debug('Table query ops reclaim drop task already exists', {
        taskId: task.value.snapshot().id,
        tableId: candidate.tableId,
      });
    }
    return;
  }
  await deps.reclaimSource.releaseDueDrop(deps.context, candidate);
  deps.logger?.warn('Table query ops reclaim sweep failed to queue drop task', {
    error: saved.error.message,
    tableId: candidate.tableId,
  });
};

const reclaimOneCandidate = async (
  deps: ReclaimCandidateDeps,
  candidate: TableSearchAccessPathReclaimCandidate
): Promise<void> => {
  const { context, now } = deps;
  if (candidate.phase === 'drop_due') {
    await queueDueReclaimDrop(deps, candidate);
    return;
  }
  const history = await deps.decisionLogRepository.findRecentByScope(context, {
    tableId: candidate.tableId,
    scopeKey: candidate.scopeKey,
    limit: 20,
  });
  const decision = deps.decisionPolicy.evaluateReclaim({
    now,
    scopeKey: candidate.scopeKey,
    accessPathReadyAt: candidate.accessPathReadyAt,
    ...(candidate.lastSearchActivityAt
      ? { lastSearchActivityAt: candidate.lastSearchActivityAt }
      : {}),
    ...(candidate.indexScanDelta !== undefined ? { indexScanDelta: candidate.indexScanDelta } : {}),
    history: history.isOk() ? history.value.map((entry) => entry.snapshot()) : [],
  });
  if (decision.isErr() || decision.value.action !== 'reclaim') return;
  const dropAfter = decision.value.cooldownUntil;
  if (!dropAfter) return;
  const beganGrace = await deps.reclaimSource.beginGrace(context, {
    tableId: candidate.tableId,
    scopeKey: candidate.scopeKey,
    expectedVersion: candidate.configVersion,
    disabledAt: now,
    dropAfter,
  });
  if (beganGrace.isErr() || !beganGrace.value) return;
  const entry = TableQueryDecisionLogEntry.create({
    baseId: candidate.baseId,
    tableId: candidate.tableId,
    scopeKey: candidate.scopeKey,
    decision: decision.value,
    actor: 'system_policy',
    now,
  });
  if (entry.isOk()) {
    const executed = entry.value.withOutcome('executed', now);
    if (executed.isOk()) {
      await deps.decisionLogRepository.save(context, executed.value);
    }
  }
};

const SEARCH_ACCESS_PATH_SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SEARCH_ACCESS_PATH_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const SEARCH_ACCESS_PATH_SWEEP_MIN_SLOW_COUNT = 5;
const SEARCH_ACCESS_PATH_SWEEP_LIMIT = 10;

export const runSearchAccessPathRecommendSweepOnce = async (
  container: DependencyContainer,
  context: IExecutionContext
): Promise<void> => {
  const logger = resolveOptionalLogger(container);
  if (!container.isRegistered(v2TableOpsTokens.observationReader)) return;
  const clock = container.resolve<TableQueryOpsClock>(v2TableOpsTokens.clock);
  const leaseRepository = resolveOptionalLeaseRepository(container);
  const leaseNow = clock.now();
  const leaseOwnerId = `search-access-path-recommend:${leaseNow.getTime()}`;
  if (leaseRepository) {
    const acquired = await leaseRepository.acquire(context, {
      leaseKey: 'table-query-ops-search-access-path-recommend-sweep',
      ownerId: leaseOwnerId,
      ttlMs: SEARCH_ACCESS_PATH_SWEEP_INTERVAL_MS,
      now: leaseNow,
    });
    if (acquired.isErr() || acquired.value === false) return;
  }
  const reader = container.resolve<TableQueryObservationReader>(v2TableOpsTokens.observationReader);
  const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  const wideSearchFields = container.isRegistered(v2TableOpsTokens.riskPolicy)
    ? container.resolve<TableQueryRiskPolicy>(v2TableOpsTokens.riskPolicy).wideSearchFields()
    : defaultTableQueryRiskPolicyConfig.wideSearchFields;
  const heat = await reader.findSearchHeatByTable(context, {
    since: new Date(clock.now().getTime() - SEARCH_ACCESS_PATH_SWEEP_LOOKBACK_MS),
    minSlowCount: SEARCH_ACCESS_PATH_SWEEP_MIN_SLOW_COUNT,
    limit: SEARCH_ACCESS_PATH_SWEEP_LIMIT,
    wideSearchFields,
  });
  if (heat.isErr()) {
    logger?.warn('Table query ops search access-path sweep failed to read heat', {
      error: heat.error.message,
    });
    if (leaseRepository) {
      await leaseRepository.acquire(context, {
        leaseKey: 'table-query-ops-search-access-path-recommend-sweep',
        ownerId: leaseOwnerId,
        ttlMs: 1,
        now: clock.now(),
      });
    }
    return;
  }
  for (const row of heat.value) {
    const observation = observationFromSearchHeat(row, clock.now());
    if (!observation) continue;
    const result = await commandBus.execute(
      context,
      new AnalyzeAndRecommendTableQueryCommand(observation)
    );
    if (result.isErr()) {
      logger?.warn('Table query ops search access-path sweep failed to recommend', {
        error: result.error.message,
        tableId: row.tableId,
      });
    }
  }
};

const observationFromSearchHeat = (heat: TableQuerySearchHeatByTable, now: Date) => {
  const shape = TableQueryShape.create({
    queryKind: 'search',
    searchShape: {
      fieldCount: heat.fieldCount,
      allFields: heat.allFields,
      valueLengthBucket: 'medium',
    },
    executionShape: {
      durationMs: heat.maxDurationMs,
      timedOut: heat.timeoutCount > 0,
    },
  });
  if (shape.isErr()) return undefined;
  const observation = TableQueryObservationWindow.create({
    ...(heat.spaceId ? { spaceId: heat.spaceId } : {}),
    baseId: heat.baseId,
    tableId: heat.tableId,
    windowStart: new Date(now.getTime() - SEARCH_ACCESS_PATH_SWEEP_LOOKBACK_MS),
    windowSizeSeconds: SEARCH_ACCESS_PATH_SWEEP_LOOKBACK_MS / 1000,
    shapeHash: SEARCH_ACCESS_PATH_RECOMMENDATION_SHAPE_HASH,
    shape: shape.value,
    requestCount: heat.requestCount,
    slowCount: heat.slowCount,
    timeoutCount: heat.timeoutCount,
    dbErrorCount: heat.dbErrorCount,
    totalDurationMs: heat.totalDurationMs,
    maxDurationMs: heat.maxDurationMs,
  });
  return observation.isOk() ? observation.value : undefined;
};

const runTaskWorkerOnce = async (
  container: DependencyContainer,
  context: IExecutionContext,
  config: TableQueryOpsTaskWorkerConfig
): Promise<void> => {
  const logger = resolveOptionalLogger(container);
  void runSearchAccessPathRecommendSweepOnce(container, context).catch((error: unknown) => {
    logger?.warn('Table query ops search access-path sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  const taskRepository = container.resolve<TableQueryRemediationTaskRepository>(
    v2TableOpsTokens.taskRepository
  );
  const clock = container.resolve<TableQueryOpsClock>(v2TableOpsTokens.clock);
  const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  const claimed = await taskRepository.claimNextAccepted(context, {
    workerId: config.workerId,
    now: clock.now(),
    allowedKinds: config.allowedKinds,
    allowManualIndexExecution: config.allowManualIndexExecution,
    allowPolicyIndexExecution: config.allowPolicyIndexExecution,
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
      config.allowManualIndexExecution || config.allowPolicyIndexExecution,
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
