import { domainError, type DomainError } from '@teable/v2-core';
import { nanoid } from 'nanoid';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;

export type TableQueryDecisionAction = 'auto_accept' | 'hold' | 'reclaim' | 'noop';
export type TableQueryDecisionActor = 'system_policy' | 'admin';
export type TableQueryDecisionOutcome = 'pending' | 'executed' | 'post_verify_failed' | 'skipped';
export type TableQueryAutoAcceptMode = 'off' | 'shadow' | 'auto';

export type TableQueryDecisionReason =
  | 'auto_accept_criteria_met'
  | 'optimistic_execution_candidate'
  | 'shadow_mode'
  | 'auto_accept_disabled'
  | 'not_hot'
  | 'plan_evidence_insufficient'
  | 'cost_improvement_below_threshold'
  | 'large_table_requires_manual'
  | 'table_size_unknown'
  | 'cooldown_active'
  | 'reclaim_min_hold_not_elapsed'
  | 'reclaim_search_activity_unknown'
  | 'reclaim_recent_search_activity'
  | 'reclaim_index_still_used'
  | 'reclaim_criteria_met'
  | 'no_executable_phase1_candidate';

export type TableQueryDecisionPolicyConfig = {
  readonly autoAcceptMode: TableQueryAutoAcceptMode;
  /** Minimum plan-cost improvement (positive pct) required for evidence-backed auto accept. */
  readonly minCostImprovementPct: number;
  /** Auto-accept for tables at or above this estimated row count always requires a human. */
  readonly smallTableMaxEstimatedRows: number;
  readonly autoAcceptCooldownMs: number;
  readonly postVerifyFailureBackoffBaseMs: number;
  readonly postVerifyFailureBackoffMaxMs: number;
  /** An access path must exist at least this long before reclaim is considered. */
  readonly reclaimMinHoldMs: number;
  /** The scope must have seen no search traffic for this long before reclaim. */
  readonly reclaimIdleMs: number;
  /** Grace period between disabling an access path and physically dropping it. */
  readonly reclaimDisableGraceMs: number;
};

export const defaultTableQueryDecisionPolicyConfig: TableQueryDecisionPolicyConfig = {
  autoAcceptMode: 'off',
  minCostImprovementPct: 20,
  smallTableMaxEstimatedRows: 50_000,
  autoAcceptCooldownMs: 7 * DAY_MS,
  postVerifyFailureBackoffBaseMs: 7 * DAY_MS,
  postVerifyFailureBackoffMaxMs: 30 * DAY_MS,
  reclaimMinHoldMs: 30 * DAY_MS,
  reclaimIdleMs: 30 * DAY_MS,
  reclaimDisableGraceMs: 7 * DAY_MS,
};

export type TableQueryDecision = {
  readonly action: TableQueryDecisionAction;
  /** True when acceptance criteria are met even if the mode (off/shadow) blocks execution. */
  readonly wouldAutoAccept: boolean;
  readonly reasonCodes: ReadonlyArray<TableQueryDecisionReason>;
  readonly cooldownUntil?: Date;
};

export type TableQueryDecisionLogEntrySnapshot = {
  readonly id: string;
  readonly baseId: string;
  readonly tableId: string;
  readonly scopeKey: string;
  readonly action: TableQueryDecisionAction;
  readonly actor: TableQueryDecisionActor;
  readonly outcome: TableQueryDecisionOutcome;
  readonly reasonCodes: ReadonlyArray<TableQueryDecisionReason>;
  readonly recommendationId?: string;
  readonly wouldAutoAccept: boolean;
  readonly cooldownUntil?: Date;
  readonly decidedAt: Date;
  readonly lastModifiedTime?: Date;
};

const decisionLogEntrySchema = z.object({
  id: z.string().min(1),
  baseId: z.string().min(1),
  tableId: z.string().min(1),
  scopeKey: z.string().min(1),
  action: z.enum(['auto_accept', 'hold', 'reclaim', 'noop']),
  actor: z.enum(['system_policy', 'admin']),
  outcome: z.enum(['pending', 'executed', 'post_verify_failed', 'skipped']),
  reasonCodes: z.array(z.string().min(1)),
  recommendationId: z.string().min(1).optional(),
  wouldAutoAccept: z.boolean(),
  cooldownUntil: z.date().optional(),
  decidedAt: z.date(),
  lastModifiedTime: z.date().optional(),
});

export class TableQueryDecisionLogEntry {
  private constructor(private readonly props: TableQueryDecisionLogEntrySnapshot) {}

  static create(input: {
    readonly baseId: string;
    readonly tableId: string;
    readonly scopeKey: string;
    readonly decision: TableQueryDecision;
    readonly actor: TableQueryDecisionActor;
    readonly recommendationId?: string;
    readonly now: Date;
  }): Result<TableQueryDecisionLogEntry, DomainError> {
    return TableQueryDecisionLogEntry.rehydrate({
      id: `tqd_${nanoid(16)}`,
      baseId: input.baseId,
      tableId: input.tableId,
      scopeKey: input.scopeKey,
      action: input.decision.action,
      actor: input.actor,
      outcome: 'pending',
      reasonCodes: input.decision.reasonCodes,
      ...(input.recommendationId ? { recommendationId: input.recommendationId } : {}),
      wouldAutoAccept: input.decision.wouldAutoAccept,
      ...(input.decision.cooldownUntil ? { cooldownUntil: input.decision.cooldownUntil } : {}),
      decidedAt: input.now,
    });
  }

  static rehydrate(
    input: TableQueryDecisionLogEntrySnapshot
  ): Result<TableQueryDecisionLogEntry, DomainError> {
    const parsed = decisionLogEntrySchema.safeParse(input);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid table query decision log entry' }));
    }
    return ok(
      new TableQueryDecisionLogEntry({
        ...input,
        reasonCodes: [...input.reasonCodes],
      })
    );
  }

  withOutcome(
    outcome: TableQueryDecisionOutcome,
    now: Date,
    cooldownUntil?: Date
  ): Result<TableQueryDecisionLogEntry, DomainError> {
    return TableQueryDecisionLogEntry.rehydrate({
      ...this.props,
      outcome,
      ...(cooldownUntil ? { cooldownUntil } : {}),
      lastModifiedTime: now,
    });
  }

  isCoolingDownAt(now: Date): boolean {
    return Boolean(this.props.cooldownUntil && this.props.cooldownUntil.getTime() > now.getTime());
  }

  snapshot(): TableQueryDecisionLogEntrySnapshot {
    return this.props;
  }
}

export type TableQueryAcceptancePlanEvidence = {
  readonly explainStatus: 'validated' | 'skipped' | 'failed';
  readonly explainMethod?: 'explain' | 'hypothetical_index';
  readonly costDeltaPct?: number;
  readonly usesCandidateIndex?: boolean;
};

export type TableQueryAcceptanceDecisionInput = {
  readonly now: Date;
  readonly scopeKey: string;
  readonly hot: boolean;
  readonly estimatedRows: number;
  readonly nextAction:
    | 'ready_for_confirmation'
    | 'needs_plan_validation'
    | 'candidate_not_recommended'
    | 'no_index_change'
    | 'manual_investigation';
  readonly planEvidence: TableQueryAcceptancePlanEvidence;
  readonly history: ReadonlyArray<TableQueryDecisionLogEntrySnapshot>;
};

export type TableQueryReclaimDecisionInput = {
  readonly now: Date;
  readonly scopeKey: string;
  /** When the access path config last became ready. */
  readonly accessPathReadyAt: Date;
  /** Latest observed search activity for the scope; undefined means none on record. */
  readonly lastSearchActivityAt?: Date;
  /** idx_scan delta for the backing index over the idle window; undefined means unknown. */
  readonly indexScanDelta?: number;
  readonly history: ReadonlyArray<TableQueryDecisionLogEntrySnapshot>;
};

const hold = (
  reasonCodes: TableQueryDecisionReason[],
  wouldAutoAccept: boolean,
  cooldownUntil?: Date
): TableQueryDecision => ({
  action: 'hold',
  wouldAutoAccept,
  reasonCodes,
  ...(cooldownUntil ? { cooldownUntil } : {}),
});

const noop = (reasonCodes: TableQueryDecisionReason[]): TableQueryDecision => ({
  action: 'noop',
  wouldAutoAccept: false,
  reasonCodes,
});

export class TableQueryDecisionPolicy {
  private readonly config: TableQueryDecisionPolicyConfig;

  constructor(config: Partial<TableQueryDecisionPolicyConfig> = {}) {
    this.config = { ...defaultTableQueryDecisionPolicyConfig, ...config };
  }

  reclaimConfig(): Pick<
    TableQueryDecisionPolicyConfig,
    'reclaimMinHoldMs' | 'reclaimIdleMs' | 'reclaimDisableGraceMs'
  > {
    return {
      reclaimMinHoldMs: this.config.reclaimMinHoldMs,
      reclaimIdleMs: this.config.reclaimIdleMs,
      reclaimDisableGraceMs: this.config.reclaimDisableGraceMs,
    };
  }

  decideAcceptance(
    input: TableQueryAcceptanceDecisionInput
  ): Result<TableQueryDecision, DomainError> {
    if (!input.scopeKey || input.estimatedRows < 0) {
      return err(domainError.validation({ message: 'Invalid acceptance decision input' }));
    }

    if (!input.hot) return ok(noop(['not_hot']));

    const evidence = this.evaluateAcceptanceEvidence(input);
    if (evidence.blockedBy) return ok(hold([evidence.blockedBy], false));

    const activeCooldown = this.activeCooldown(input.history, input.scopeKey, input.now);
    if (activeCooldown) {
      return ok(hold(['cooldown_active', ...evidence.reasonCodes], true, activeCooldown));
    }

    // The executor refuses generated-column rewrites on large or unknown-size tables
    // without an explicit human confirmation, so auto accept is small-table only.
    if (input.estimatedRows === 0) {
      return ok(hold(['table_size_unknown', ...evidence.reasonCodes], true));
    }
    if (input.estimatedRows >= this.config.smallTableMaxEstimatedRows) {
      return ok(hold(['large_table_requires_manual', ...evidence.reasonCodes], true));
    }

    if (this.config.autoAcceptMode === 'off') {
      return ok(hold(['auto_accept_disabled', ...evidence.reasonCodes], true));
    }
    if (this.config.autoAcceptMode === 'shadow') {
      return ok(hold(['shadow_mode', ...evidence.reasonCodes], true));
    }

    return ok({
      action: 'auto_accept',
      wouldAutoAccept: true,
      reasonCodes: evidence.reasonCodes,
      cooldownUntil: new Date(input.now.getTime() + this.config.autoAcceptCooldownMs),
    });
  }

  evaluateReclaim(input: TableQueryReclaimDecisionInput): Result<TableQueryDecision, DomainError> {
    if (!input.scopeKey) {
      return err(domainError.validation({ message: 'Invalid reclaim decision input' }));
    }

    const activeCooldown = this.activeCooldown(input.history, input.scopeKey, input.now);
    if (activeCooldown) return ok(noop(['cooldown_active']));

    const heldFor = input.now.getTime() - input.accessPathReadyAt.getTime();
    if (heldFor < this.config.reclaimMinHoldMs) {
      return ok(noop(['reclaim_min_hold_not_elapsed']));
    }

    if (!input.lastSearchActivityAt) {
      return ok(noop(['reclaim_search_activity_unknown']));
    }
    if (input.now.getTime() - input.lastSearchActivityAt.getTime() < this.config.reclaimIdleMs) {
      return ok(noop(['reclaim_recent_search_activity']));
    }

    // Unknown index usage is treated as "still used": never reclaim on missing evidence.
    if (input.indexScanDelta === undefined || input.indexScanDelta > 0) {
      return ok(noop(['reclaim_index_still_used']));
    }

    return ok({
      action: 'reclaim',
      wouldAutoAccept: false,
      reasonCodes: ['reclaim_criteria_met'],
      cooldownUntil: new Date(input.now.getTime() + this.config.reclaimDisableGraceMs),
    });
  }

  /**
   * Cooldown to attach when recording a post-verify failure: exponential backoff on
   * consecutive failures (base, 2x, 4x, ...) capped at the configured maximum.
   */
  computePostVerifyFailureCooldown(input: {
    readonly now: Date;
    readonly scopeKey: string;
    readonly history: ReadonlyArray<TableQueryDecisionLogEntrySnapshot>;
  }): Date {
    const failures = this.consecutivePostVerifyFailures(input.history, input.scopeKey);
    const backoff = Math.min(
      this.config.postVerifyFailureBackoffBaseMs * 2 ** failures,
      this.config.postVerifyFailureBackoffMaxMs
    );
    return new Date(input.now.getTime() + backoff);
  }

  private evaluateAcceptanceEvidence(input: TableQueryAcceptanceDecisionInput): {
    readonly reasonCodes: TableQueryDecisionReason[];
    readonly blockedBy?: TableQueryDecisionReason;
  } {
    if (input.nextAction === 'ready_for_confirmation') {
      const evidence = input.planEvidence;
      if (
        evidence.explainStatus !== 'validated' ||
        evidence.explainMethod !== 'hypothetical_index' ||
        evidence.usesCandidateIndex === false
      ) {
        return { reasonCodes: [], blockedBy: 'plan_evidence_insufficient' };
      }
      if (
        typeof evidence.costDeltaPct !== 'number' ||
        !Number.isFinite(evidence.costDeltaPct) ||
        evidence.costDeltaPct > -this.config.minCostImprovementPct
      ) {
        return { reasonCodes: [], blockedBy: 'cost_improvement_below_threshold' };
      }
      return { reasonCodes: ['auto_accept_criteria_met'] };
    }
    return { reasonCodes: [], blockedBy: 'plan_evidence_insufficient' };
  }

  private activeCooldown(
    history: ReadonlyArray<TableQueryDecisionLogEntrySnapshot>,
    scopeKey: string,
    now: Date
  ): Date | undefined {
    let latest: Date | undefined;
    for (const entry of history) {
      if (entry.scopeKey !== scopeKey || !entry.cooldownUntil) continue;
      if (entry.cooldownUntil.getTime() <= now.getTime()) continue;
      if (!latest || entry.cooldownUntil.getTime() > latest.getTime()) {
        latest = entry.cooldownUntil;
      }
    }
    return latest;
  }

  private consecutivePostVerifyFailures(
    history: ReadonlyArray<TableQueryDecisionLogEntrySnapshot>,
    scopeKey: string
  ): number {
    const ordered = history
      .filter(
        (entry) =>
          entry.scopeKey === scopeKey &&
          entry.action === 'auto_accept' &&
          entry.outcome !== 'pending' &&
          entry.outcome !== 'skipped'
      )
      .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());
    let failures = 0;
    for (const entry of ordered) {
      if (entry.outcome !== 'post_verify_failed') break;
      failures += 1;
    }
    return failures;
  }
}
