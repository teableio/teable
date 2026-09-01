import {
  CommandHandler,
  QueryHandler,
  TableByIdSpec,
  TableId,
  domainError,
  v2CoreTokens,
  type DomainError,
  type ICommandBus,
  type ICommandHandler,
  type IExecutionContext,
  type IQueryHandler,
  type ITableRepository,
  PublicCommand,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry, type Result } from 'neverthrow';

import {
  TableQueryDecisionLogEntry,
  type TableQueryAcceptanceDecisionInput,
  type TableQueryAcceptancePlanEvidence,
  type TableQueryDecision,
  type TableQueryDecisionPolicy,
} from './decisionPolicy';
import {
  SEARCH_ACCESS_PATH_RECOMMENDATION_SHAPE_HASH,
  TableQueryPlanValidation,
  TableQueryRecommendation,
  TableQueryRemediationTask,
} from './domain';
import type {
  ExecutablePhase1RemediationKind,
  TableQueryIndexInspection,
  TableQueryObservationWindow,
  TableQueryRiskPolicy,
  TableQueryRiskReport,
} from './domain';
// These ports are injected by explicit DI tokens; keep them type-only so tsdown
// does not emit runtime imports for interfaces.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type {
  TablePhysicalStatsReader,
  TableQueryDecisionLogRepository,
  TableQueryIndexInspector,
  TableQueryObservationReader,
  TableQueryObservationSink,
  TableQueryOpsClock,
  TableQueryPlanValidator,
  TableQueryRecommendationRepository,
  TableQueryRemediationExecutor,
  TableQueryRemediationTaskRepository,
  TableQuerySearchHeatByTable,
} from './ports';
import { v2TableOpsTokens } from './tokens';

export class RecordTableQueryObservationCommand extends PublicCommand {
  constructor(readonly observation: TableQueryObservationWindow) {
    super();
  }
}

export class AnalyzeTableQueryRiskQuery {
  constructor(readonly observation: TableQueryObservationWindow) {}
}

export type AnalyzeTableQueryRiskResult = {
  readonly report: TableQueryRiskReport;
};

export class AnalyzeAndRecommendTableQueryCommand extends PublicCommand {
  constructor(readonly observation: TableQueryObservationWindow) {
    super();
  }
}

export type AnalyzeAndRecommendTableQueryResult = {
  readonly report: TableQueryRiskReport;
  readonly recommendation?: TableQueryRecommendation;
};

export class AcceptTableQueryRecommendationCommand extends PublicCommand {
  constructor(
    readonly recommendationId: string,
    readonly kind?: ExecutablePhase1RemediationKind
  ) {
    super();
  }
}

export class DismissTableQueryRecommendationCommand extends PublicCommand {
  constructor(readonly recommendationId: string) {
    super();
  }
}

export class DecideTableQueryRecommendationCommand extends PublicCommand {
  constructor(
    readonly recommendation: TableQueryRecommendation,
    readonly report: TableQueryRiskReport
  ) {
    super();
  }
}

export type DecideTableQueryRecommendationResult = {
  readonly decision: TableQueryDecision;
  readonly logEntry?: TableQueryDecisionLogEntry;
  readonly task?: TableQueryRemediationTask;
};

export class RunTableQueryRemediationTaskCommand extends PublicCommand {
  constructor(
    readonly taskId: string,
    readonly allowManualIndexExecution = false,
    readonly workerId = 'manual'
  ) {
    super();
  }
}

export class RunTableQueryRecommendedIndexCommand extends PublicCommand {
  constructor(
    readonly input: {
      readonly baseId: string;
      readonly tableId: string;
      readonly kind: ExecutablePhase1RemediationKind;
      readonly payload: unknown;
      readonly allowManualIndexExecution?: boolean;
      readonly workerId?: string;
    }
  ) {
    super();
  }
}

@CommandHandler(RecordTableQueryObservationCommand)
@injectable()
export class RecordTableQueryObservationHandler
  implements ICommandHandler<RecordTableQueryObservationCommand, void>
{
  constructor(
    @inject(v2TableOpsTokens.observationSink)
    private readonly observationSink: TableQueryObservationSink
  ) {}

  async handle(
    context: IExecutionContext,
    command: RecordTableQueryObservationCommand
  ): Promise<Result<void, DomainError>> {
    return this.observationSink.record(context, command.observation);
  }
}

@QueryHandler(AnalyzeTableQueryRiskQuery)
@injectable()
export class AnalyzeTableQueryRiskHandler
  implements IQueryHandler<AnalyzeTableQueryRiskQuery, AnalyzeTableQueryRiskResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2TableOpsTokens.physicalStatsReader)
    private readonly physicalStatsReader: TablePhysicalStatsReader,
    @inject(v2TableOpsTokens.indexInspector)
    private readonly indexInspector: TableQueryIndexInspector,
    @inject(v2TableOpsTokens.planValidator)
    private readonly planValidator: TableQueryPlanValidator,
    @inject(v2TableOpsTokens.riskPolicy)
    private readonly riskPolicy: TableQueryRiskPolicy
  ) {}

  async handle(
    context: IExecutionContext,
    query: AnalyzeTableQueryRiskQuery
  ): Promise<Result<AnalyzeTableQueryRiskResult, DomainError>> {
    return safeTry<AnalyzeTableQueryRiskResult, DomainError>(
      async function* (this: AnalyzeTableQueryRiskHandler) {
        const tableId = yield* parseTableId(query.observation.tableId());
        const table = yield* await this.tableRepository.findOne(
          context,
          TableByIdSpec.create(tableId)
        );
        const physicalStats = yield* await this.physicalStatsReader.read(context, table);
        const indexInspection = yield* await this.indexInspector.inspect(
          context,
          table,
          query.observation.shape()
        );
        const planValidation = yield* await this.planValidator.validate(context, {
          table,
          observation: query.observation,
          indexInspection,
        });
        const report = yield* this.riskPolicy.evaluate({
          observation: query.observation,
          physicalStats,
          indexInspection,
          planValidation,
        });
        return ok({ report });
      }.bind(this)
    );
  }
}

@CommandHandler(AnalyzeAndRecommendTableQueryCommand)
@injectable()
export class AnalyzeAndRecommendTableQueryHandler
  implements
    ICommandHandler<AnalyzeAndRecommendTableQueryCommand, AnalyzeAndRecommendTableQueryResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2TableOpsTokens.physicalStatsReader)
    private readonly physicalStatsReader: TablePhysicalStatsReader,
    @inject(v2TableOpsTokens.indexInspector)
    private readonly indexInspector: TableQueryIndexInspector,
    @inject(v2TableOpsTokens.planValidator)
    private readonly planValidator: TableQueryPlanValidator,
    @inject(v2TableOpsTokens.riskPolicy)
    private readonly riskPolicy: TableQueryRiskPolicy,
    @inject(v2TableOpsTokens.recommendationRepository)
    private readonly recommendationRepository: TableQueryRecommendationRepository,
    @inject(v2TableOpsTokens.clock)
    private readonly clock: TableQueryOpsClock
  ) {}

  async handle(
    context: IExecutionContext,
    command: AnalyzeAndRecommendTableQueryCommand
  ): Promise<Result<AnalyzeAndRecommendTableQueryResult, DomainError>> {
    return safeTry<AnalyzeAndRecommendTableQueryResult, DomainError>(
      async function* (this: AnalyzeAndRecommendTableQueryHandler) {
        const tableId = yield* parseTableId(command.observation.tableId());
        const table = yield* await this.tableRepository.findOne(
          context,
          TableByIdSpec.create(tableId)
        );
        const physicalStats = yield* await this.physicalStatsReader.read(context, table);
        const indexInspection = yield* await this.indexInspector.inspect(
          context,
          table,
          command.observation.shape()
        );
        const planValidation = yield* await this.planValidator.validate(context, {
          table,
          observation: command.observation,
          indexInspection,
        });
        const report = yield* this.riskPolicy.evaluate({
          observation: command.observation,
          physicalStats,
          indexInspection,
          planValidation,
        });
        const wantsAccessPath = report
          .snapshot()
          .remediationCandidates.some(
            (candidate) => candidate.kind === 'create_search_access_path'
          );
        const existingSentinel = yield* await this.recommendationRepository.findOpenByShape(
          context,
          {
            tableId: command.observation.tableId(),
            shapeHash: SEARCH_ACCESS_PATH_RECOMMENDATION_SHAPE_HASH,
            policyVersion: report.snapshot().policyVersion,
          }
        );
        if (!wantsAccessPath && existingSentinel) {
          const dismissed = yield* existingSentinel.dismiss(this.clock.now());
          yield* await this.recommendationRepository.save(context, dismissed);
        }
        if (
          !wantsAccessPath &&
          command.observation.shapeHash() === SEARCH_ACCESS_PATH_RECOMMENDATION_SHAPE_HASH
        ) {
          return ok({ report });
        }
        if (!report.shouldRecommend()) {
          return ok({ report });
        }
        const recommendation = yield* TableQueryRecommendation.createOpen({
          observation: command.observation,
          report,
          now: this.clock.now(),
        });
        const saved = yield* await this.recommendationRepository.save(context, recommendation);
        return ok({ report, recommendation: saved });
      }.bind(this)
    );
  }
}

@CommandHandler(AcceptTableQueryRecommendationCommand)
@injectable()
export class AcceptTableQueryRecommendationHandler
  implements ICommandHandler<AcceptTableQueryRecommendationCommand, TableQueryRemediationTask>
{
  constructor(
    @inject(v2TableOpsTokens.recommendationRepository)
    private readonly recommendationRepository: TableQueryRecommendationRepository,
    @inject(v2TableOpsTokens.taskRepository)
    private readonly taskRepository: TableQueryRemediationTaskRepository,
    @inject(v2TableOpsTokens.clock)
    private readonly clock: TableQueryOpsClock
  ) {}

  async handle(
    context: IExecutionContext,
    command: AcceptTableQueryRecommendationCommand
  ): Promise<Result<TableQueryRemediationTask, DomainError>> {
    return safeTry<TableQueryRemediationTask, DomainError>(
      async function* (this: AcceptTableQueryRecommendationHandler) {
        const recommendation = yield* await this.recommendationRepository.findById(
          context,
          command.recommendationId
        );
        const snapshot = recommendation.snapshot();
        const firstCandidate = snapshot.remediationCandidates.find((candidate) => {
          if (!candidate.executableInPhase1) return false;
          if (command.kind) return candidate.kind === command.kind;
          return candidate.kind !== 'create_search_access_path';
        });
        const kind = command.kind ?? firstCandidate?.kind;
        if (!kind || !isExecutablePhase1Kind(kind) || kind === 'create_search_access_path') {
          return err(
            domainError.validation({
              code: 'table_query_ops.invalid_remediation_kind',
              message: 'Recommendation has no executable phase 1 remediation candidate',
            })
          );
        }
        const accepted = yield* recommendation.accept(this.clock.now());
        const savedRecommendation = yield* await this.recommendationRepository.save(
          context,
          accepted
        );
        const task = yield* TableQueryRemediationTask.createQueued({
          recommendation: savedRecommendation,
          tableId: snapshot.tableId,
          baseId: snapshot.baseId,
          kind,
          payload: firstCandidate ?? { kind },
          now: this.clock.now(),
        });
        const savedTask = yield* await this.taskRepository.save(context, task);
        return ok(savedTask);
      }.bind(this)
    );
  }
}

@CommandHandler(DismissTableQueryRecommendationCommand)
@injectable()
export class DismissTableQueryRecommendationHandler
  implements ICommandHandler<DismissTableQueryRecommendationCommand, TableQueryRecommendation>
{
  constructor(
    @inject(v2TableOpsTokens.recommendationRepository)
    private readonly recommendationRepository: TableQueryRecommendationRepository,
    @inject(v2TableOpsTokens.clock)
    private readonly clock: TableQueryOpsClock
  ) {}

  async handle(
    context: IExecutionContext,
    command: DismissTableQueryRecommendationCommand
  ): Promise<Result<TableQueryRecommendation, DomainError>> {
    return safeTry<TableQueryRecommendation, DomainError>(
      async function* (this: DismissTableQueryRecommendationHandler) {
        const recommendation = yield* await this.recommendationRepository.findById(
          context,
          command.recommendationId
        );
        const dismissed = yield* recommendation.dismiss(this.clock.now());
        const saved = yield* await this.recommendationRepository.save(context, dismissed);
        return ok(saved);
      }.bind(this)
    );
  }
}

@CommandHandler(DecideTableQueryRecommendationCommand)
@injectable()
export class DecideTableQueryRecommendationHandler
  implements
    ICommandHandler<DecideTableQueryRecommendationCommand, DecideTableQueryRecommendationResult>
{
  constructor(
    @inject(v2TableOpsTokens.decisionPolicy)
    private readonly decisionPolicy: TableQueryDecisionPolicy,
    @inject(v2TableOpsTokens.decisionLogRepository)
    private readonly decisionLogRepository: TableQueryDecisionLogRepository,
    @inject(v2CoreTokens.commandBus)
    private readonly commandBus: ICommandBus,
    @inject(v2TableOpsTokens.clock)
    private readonly clock: TableQueryOpsClock
  ) {}

  async handle(
    context: IExecutionContext,
    command: DecideTableQueryRecommendationCommand
  ): Promise<Result<DecideTableQueryRecommendationResult, DomainError>> {
    return safeTry<DecideTableQueryRecommendationResult, DomainError>(
      async function* (this: DecideTableQueryRecommendationHandler) {
        const snapshot = command.recommendation.snapshot();
        if (snapshot.status !== 'open') {
          return ok({
            decision: { action: 'noop', wouldAutoAccept: false, reasonCodes: [] },
          } satisfies DecideTableQueryRecommendationResult);
        }
        const report = command.report.snapshot();
        const now = this.clock.now();
        const scopeKey = snapshot.shapeHash;
        const history = yield* await this.decisionLogRepository.findRecentByScope(context, {
          tableId: snapshot.tableId,
          scopeKey,
          limit: 20,
        });
        const decision = yield* this.decisionPolicy.decideAcceptance({
          now,
          scopeKey,
          hot: report.workloadHot,
          estimatedRows: report.physicalStats.estimatedRows,
          nextAction: toDecisionNextAction(report.planValidation),
          planEvidence: toDecisionPlanEvidence(report.planValidation),
          history: history.map((entry) => entry.snapshot()),
        });
        if (decision.action === 'noop') {
          return ok({ decision } satisfies DecideTableQueryRecommendationResult);
        }
        if (
          decision.action === 'auto_accept' &&
          !hasGenericPhase1AcceptCandidate(snapshot.remediationCandidates)
        ) {
          return ok({
            decision: {
              action: 'hold',
              wouldAutoAccept: false,
              reasonCodes: ['no_executable_phase1_candidate'],
            },
          } satisfies DecideTableQueryRecommendationResult);
        }
        // The analyzer re-decides the same open recommendation every tick; only
        // log decision *transitions*, or a persistently hot scope in shadow or
        // cooldown would append an identical hold row every interval forever.
        const latest = history[0]?.snapshot();
        if (
          decision.action === 'hold' &&
          latest !== undefined &&
          latest.action === 'hold' &&
          latest.actor === 'system_policy' &&
          latest.outcome === 'pending' &&
          sameReasonCodes(latest.reasonCodes, decision.reasonCodes)
        ) {
          return ok({ decision } satisfies DecideTableQueryRecommendationResult);
        }
        const entry = yield* TableQueryDecisionLogEntry.create({
          baseId: snapshot.baseId,
          tableId: snapshot.tableId,
          scopeKey,
          decision,
          actor: 'system_policy',
          recommendationId: snapshot.id,
          now,
        });
        const savedEntry = yield* await this.decisionLogRepository.save(context, entry);
        if (decision.action !== 'auto_accept') {
          return ok({ decision, logEntry: savedEntry });
        }
        const accepted = await this.commandBus.execute<
          AcceptTableQueryRecommendationCommand,
          TableQueryRemediationTask
        >(context, new AcceptTableQueryRecommendationCommand(snapshot.id));
        if (accepted.isErr()) {
          const skipped = yield* savedEntry.withOutcome('skipped', this.clock.now());
          yield* await this.decisionLogRepository.save(context, skipped);
          return err(accepted.error);
        }
        return ok({ decision, logEntry: savedEntry, task: accepted.value });
      }.bind(this)
    );
  }
}

@CommandHandler(RunTableQueryRemediationTaskCommand)
@injectable()
export class RunTableQueryRemediationTaskHandler
  implements ICommandHandler<RunTableQueryRemediationTaskCommand, TableQueryRemediationTask>
{
  constructor(
    @inject(v2TableOpsTokens.taskRepository)
    private readonly taskRepository: TableQueryRemediationTaskRepository,
    @inject(v2TableOpsTokens.remediationExecutor)
    private readonly remediationExecutor: TableQueryRemediationExecutor,
    @inject(v2TableOpsTokens.decisionPolicy)
    private readonly decisionPolicy: TableQueryDecisionPolicy,
    @inject(v2TableOpsTokens.decisionLogRepository)
    private readonly decisionLogRepository: TableQueryDecisionLogRepository,
    @inject(v2TableOpsTokens.clock)
    private readonly clock: TableQueryOpsClock
  ) {}

  async handle(
    context: IExecutionContext,
    command: RunTableQueryRemediationTaskCommand
  ): Promise<Result<TableQueryRemediationTask, DomainError>> {
    return safeTry<TableQueryRemediationTask, DomainError>(
      async function* (this: RunTableQueryRemediationTaskHandler) {
        const task = yield* await this.taskRepository.findById(context, command.taskId);
        const running = yield* task.start(command.workerId, this.clock.now());
        const savedRunning = yield* await this.taskRepository.save(context, running);
        const executed = await this.remediationExecutor.execute(context, {
          task: savedRunning,
          allowManualIndexExecution: command.allowManualIndexExecution,
        });
        if (executed.isErr()) {
          const failed = yield* savedRunning.fail(executed.error.message, this.clock.now());
          const savedFailed = yield* await this.taskRepository.save(context, failed);
          await this.recordDecisionOutcome(context, savedFailed, false);
          return ok(savedFailed);
        }
        const succeeded = yield* savedRunning.succeed(executed.value, this.clock.now());
        const savedSucceeded = yield* await this.taskRepository.save(context, succeeded);
        await this.recordDecisionOutcome(context, savedSucceeded, true);
        return ok(savedSucceeded);
      }.bind(this)
    );
  }

  /**
   * Best-effort: close the loop for policy-driven executions. Any failure counts as a
   * post-verify failure so backoff kicks in even for transient errors — being slow to
   * retry is safe; thrashing DDL on a hot table is not.
   */
  private async recordDecisionOutcome(
    context: IExecutionContext,
    task: TableQueryRemediationTask,
    succeeded: boolean
  ): Promise<void> {
    const taskSnapshot = task.snapshot();
    if (!taskSnapshot.recommendationId) return;
    const latest = await this.decisionLogRepository.findLatestByRecommendation(context, {
      recommendationId: taskSnapshot.recommendationId,
    });
    if (latest.isErr() || !latest.value) return;
    const entrySnapshot = latest.value.snapshot();
    if (
      entrySnapshot.actor !== 'system_policy' ||
      entrySnapshot.action !== 'auto_accept' ||
      entrySnapshot.outcome !== 'pending'
    ) {
      return;
    }
    const now = this.clock.now();
    let updated: Result<TableQueryDecisionLogEntry, DomainError>;
    if (succeeded) {
      updated = latest.value.withOutcome('executed', now);
    } else {
      const history = await this.decisionLogRepository.findRecentByScope(context, {
        tableId: entrySnapshot.tableId,
        scopeKey: entrySnapshot.scopeKey,
        limit: 20,
      });
      const cooldownUntil = this.decisionPolicy.computePostVerifyFailureCooldown({
        now,
        scopeKey: entrySnapshot.scopeKey,
        history: history.isOk() ? history.value.map((entry) => entry.snapshot()) : [],
      });
      updated = latest.value.withOutcome('post_verify_failed', now, cooldownUntil);
    }
    if (updated.isOk()) {
      await this.decisionLogRepository.save(context, updated.value);
    }
  }
}

@CommandHandler(RunTableQueryRecommendedIndexCommand)
@injectable()
export class RunTableQueryRecommendedIndexHandler
  implements ICommandHandler<RunTableQueryRecommendedIndexCommand, TableQueryRemediationTask>
{
  constructor(
    @inject(v2TableOpsTokens.taskRepository)
    private readonly taskRepository: TableQueryRemediationTaskRepository,
    @inject(v2TableOpsTokens.remediationExecutor)
    private readonly remediationExecutor: TableQueryRemediationExecutor,
    @inject(v2TableOpsTokens.clock)
    private readonly clock: TableQueryOpsClock
  ) {}

  async handle(
    context: IExecutionContext,
    command: RunTableQueryRecommendedIndexCommand
  ): Promise<Result<TableQueryRemediationTask, DomainError>> {
    return safeTry<TableQueryRemediationTask, DomainError>(
      async function* (this: RunTableQueryRecommendedIndexHandler) {
        if (!isExecutablePhase1Kind(command.input.kind)) {
          return err(
            domainError.validation({
              code: 'table_query_ops.invalid_remediation_kind',
              message: 'Recommended index command only supports phase 1 remediation kinds',
            })
          );
        }
        const queued = yield* TableQueryRemediationTask.createQueued({
          baseId: command.input.baseId,
          tableId: command.input.tableId,
          kind: command.input.kind,
          payload: command.input.payload,
          now: this.clock.now(),
        });
        const savedQueued = yield* await this.taskRepository.save(context, queued);
        const running = yield* savedQueued.start(
          command.input.workerId ?? 'manual',
          this.clock.now()
        );
        const savedRunning = yield* await this.taskRepository.save(context, running);
        const executed = await this.remediationExecutor.execute(context, {
          task: savedRunning,
          allowManualIndexExecution: command.input.allowManualIndexExecution ?? false,
        });
        if (executed.isErr()) {
          const failed = yield* savedRunning.fail(executed.error.message, this.clock.now());
          const savedFailed = yield* await this.taskRepository.save(context, failed);
          return ok(savedFailed);
        }
        const succeeded = yield* savedRunning.succeed(executed.value, this.clock.now());
        const savedSucceeded = yield* await this.taskRepository.save(context, succeeded);
        return ok(savedSucceeded);
      }.bind(this)
    );
  }
}

export class NoopTableQueryObservationSink implements TableQueryObservationSink {
  async record(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

export class NoopTableQueryObservationReader implements TableQueryObservationReader {
  async findRecent(): Promise<Result<ReadonlyArray<TableQueryObservationWindow>, DomainError>> {
    return ok([]);
  }

  async findSearchHeatByTable(): Promise<
    Result<ReadonlyArray<TableQuerySearchHeatByTable>, DomainError>
  > {
    return ok([]);
  }
}

export class NoopTableQueryPlanValidator implements TableQueryPlanValidator {
  async validate(
    _context: IExecutionContext,
    input: {
      readonly indexInspection: TableQueryIndexInspection;
    }
  ): Promise<Result<TableQueryPlanValidation, DomainError>> {
    return TableQueryPlanValidation.create({
      status: 'skipped',
      reason: 'plan_validator_not_configured',
      candidateCount: input.indexInspection.snapshot().missingIndexCandidates.length,
    });
  }
}

const parseTableId = (raw: string) => TableId.create(raw);

const sameReasonCodes = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((code, index) => code === right[index]);

type PlanValidationSnapshot = ReturnType<TableQueryPlanValidation['snapshot']> | undefined;

const toDecisionNextAction = (
  plan: PlanValidationSnapshot
): TableQueryAcceptanceDecisionInput['nextAction'] => {
  if (!plan || plan.status === 'skipped') return 'needs_plan_validation';
  if (plan.status === 'failed') return 'manual_investigation';
  return 'ready_for_confirmation';
};

const toDecisionPlanEvidence = (plan: PlanValidationSnapshot): TableQueryAcceptancePlanEvidence => {
  const before = plan?.totalCostBefore;
  const after = plan?.totalCostAfter;
  const costDeltaPct =
    typeof before === 'number' && typeof after === 'number' && before > 0
      ? ((after - before) / before) * 100
      : undefined;
  return {
    explainStatus: plan?.status ?? 'skipped',
    ...(plan?.method ? { explainMethod: plan.method } : {}),
    ...(costDeltaPct !== undefined ? { costDeltaPct } : {}),
    ...(plan?.usesCandidateIndex !== undefined
      ? { usesCandidateIndex: plan.usesCandidateIndex }
      : {}),
  };
};

const isExecutablePhase1Kind = (kind: string): kind is ExecutablePhase1RemediationKind =>
  [
    'create_search_index',
    'create_search_access_path',
    'rebuild_search_access_path',
    'drop_search_access_path',
    'create_search_vector',
    'rebuild_search_vector',
    'create_filter_index',
    'create_sort_index',
    'repair_index',
    'manual_investigation',
  ].includes(kind);

const hasGenericPhase1AcceptCandidate = (
  candidates: ReadonlyArray<{ readonly executableInPhase1: boolean; readonly kind: string }>
): boolean =>
  candidates.some(
    (candidate) =>
      candidate.executableInPhase1 &&
      candidate.kind !== 'create_search_access_path' &&
      isExecutablePhase1Kind(candidate.kind)
  );
