import { describe, expect, it } from 'vitest';

import {
  TableQueryDecisionLogEntry,
  TableQueryDecisionPolicy,
  defaultTableQueryDecisionPolicyConfig,
  type TableQueryAcceptanceDecisionInput,
  type TableQueryDecisionLogEntrySnapshot,
} from './decisionPolicy';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const strongEvidence = {
  explainStatus: 'validated' as const,
  explainMethod: 'hypothetical_index' as const,
  costDeltaPct: -35,
  usesCandidateIndex: true,
};

const acceptanceInput = (
  overrides: Partial<TableQueryAcceptanceDecisionInput> = {}
): TableQueryAcceptanceDecisionInput => ({
  now: NOW,
  scopeKey: 'scope-a',
  hot: true,
  estimatedRows: 20_000,
  nextAction: 'ready_for_confirmation',
  planEvidence: strongEvidence,
  history: [],
  ...overrides,
});

const historyEntry = (
  overrides: Partial<TableQueryDecisionLogEntrySnapshot> = {}
): TableQueryDecisionLogEntrySnapshot => ({
  id: 'tqd_x',
  baseId: 'bse_x',
  tableId: 'tbl_x',
  scopeKey: 'scope-a',
  action: 'auto_accept',
  actor: 'system_policy',
  outcome: 'executed',
  reasonCodes: ['auto_accept_criteria_met'],
  wouldAutoAccept: true,
  decidedAt: new Date(NOW.getTime() - 10 * DAY_MS),
  ...overrides,
});

describe('TableQueryDecisionPolicy.decideAcceptance', () => {
  it('auto accepts a hot small table with hypothetical-index evidence in auto mode', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(acceptanceInput())
      ._unsafeUnwrap();

    expect(decision.action).toBe('auto_accept');
    expect(decision.wouldAutoAccept).toBe(true);
    expect(decision.reasonCodes).toEqual(['auto_accept_criteria_met']);
    expect(decision.cooldownUntil).toEqual(
      new Date(NOW.getTime() + defaultTableQueryDecisionPolicyConfig.autoAcceptCooldownMs)
    );
  });

  it('holds when hypothetical-index cost evidence is unavailable', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(
        acceptanceInput({
          nextAction: 'needs_plan_validation',
          planEvidence: { explainStatus: 'skipped' },
        })
      )
      ._unsafeUnwrap();

    expect(decision.action).toBe('hold');
    expect(decision.wouldAutoAccept).toBe(false);
    expect(decision.reasonCodes).toEqual(['plan_evidence_insufficient']);
  });

  it('accepts exactly 20% cost improvement and rejects anything below it', () => {
    const policy = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' });

    const boundary = policy
      .decideAcceptance(acceptanceInput({ planEvidence: { ...strongEvidence, costDeltaPct: -20 } }))
      ._unsafeUnwrap();
    const below = policy
      .decideAcceptance(
        acceptanceInput({ planEvidence: { ...strongEvidence, costDeltaPct: -19.99 } })
      )
      ._unsafeUnwrap();

    expect(boundary.action).toBe('auto_accept');
    expect(below.action).toBe('hold');
    expect(below.reasonCodes).toEqual(['cost_improvement_below_threshold']);
  });

  it('noops when the scope is not hot', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(acceptanceInput({ hot: false }))
      ._unsafeUnwrap();

    expect(decision).toEqual({ action: 'noop', wouldAutoAccept: false, reasonCodes: ['not_hot'] });
  });

  it('holds without auto-accept when cost improvement is below the threshold', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(acceptanceInput({ planEvidence: { ...strongEvidence, costDeltaPct: -10 } }))
      ._unsafeUnwrap();

    expect(decision.action).toBe('hold');
    expect(decision.wouldAutoAccept).toBe(false);
    expect(decision.reasonCodes).toEqual(['cost_improvement_below_threshold']);
  });

  it('holds when evidence is not hypothetical-index backed', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(
        acceptanceInput({ planEvidence: { ...strongEvidence, explainMethod: 'explain' } })
      )
      ._unsafeUnwrap();

    expect(decision.action).toBe('hold');
    expect(decision.reasonCodes).toEqual(['plan_evidence_insufficient']);
  });

  it('routes large and unknown-size tables to manual review even in auto mode', () => {
    const policy = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' });

    const large = policy
      .decideAcceptance(acceptanceInput({ estimatedRows: 60_000 }))
      ._unsafeUnwrap();
    expect(large.action).toBe('hold');
    expect(large.wouldAutoAccept).toBe(true);
    expect(large.reasonCodes).toContain('large_table_requires_manual');

    const unknown = policy.decideAcceptance(acceptanceInput({ estimatedRows: 0 }))._unsafeUnwrap();
    expect(unknown.action).toBe('hold');
    expect(unknown.reasonCodes).toContain('table_size_unknown');
  });

  it('reports would-auto-accept in shadow mode without acting', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'shadow' })
      .decideAcceptance(acceptanceInput())
      ._unsafeUnwrap();

    expect(decision.action).toBe('hold');
    expect(decision.wouldAutoAccept).toBe(true);
    expect(decision.reasonCodes).toEqual(['shadow_mode', 'auto_accept_criteria_met']);
  });

  it('holds while a cooldown from a prior decision is active', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(
        acceptanceInput({
          history: [historyEntry({ cooldownUntil: new Date(NOW.getTime() + DAY_MS) })],
        })
      )
      ._unsafeUnwrap();

    expect(decision.action).toBe('hold');
    expect(decision.reasonCodes[0]).toBe('cooldown_active');
    expect(decision.cooldownUntil).toEqual(new Date(NOW.getTime() + DAY_MS));
  });

  it('ignores expired cooldowns and cooldowns from other scopes', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(
        acceptanceInput({
          history: [
            historyEntry({ cooldownUntil: new Date(NOW.getTime() - DAY_MS) }),
            historyEntry({
              scopeKey: 'scope-other',
              cooldownUntil: new Date(NOW.getTime() + DAY_MS),
            }),
          ],
        })
      )
      ._unsafeUnwrap();

    expect(decision.action).toBe('auto_accept');
  });

  it('rejects invalid input', () => {
    const result = new TableQueryDecisionPolicy().decideAcceptance(
      acceptanceInput({ scopeKey: '' })
    );
    expect(result.isErr()).toBe(true);
  });
});

describe('TableQueryDecisionPolicy.evaluateReclaim', () => {
  const reclaimInput = {
    now: NOW,
    scopeKey: 'scope-a',
    accessPathReadyAt: new Date(NOW.getTime() - 60 * DAY_MS),
    lastSearchActivityAt: new Date(NOW.getTime() - 45 * DAY_MS),
    indexScanDelta: 0,
    history: [] as TableQueryDecisionLogEntrySnapshot[],
  };

  it('reclaims an idle access path past the minimum hold with zero index usage', () => {
    const decision = new TableQueryDecisionPolicy().evaluateReclaim(reclaimInput)._unsafeUnwrap();

    expect(decision.action).toBe('reclaim');
    expect(decision.reasonCodes).toEqual(['reclaim_criteria_met']);
    expect(decision.cooldownUntil).toEqual(
      new Date(NOW.getTime() + defaultTableQueryDecisionPolicyConfig.reclaimDisableGraceMs)
    );
  });

  it('noops before the minimum hold has elapsed', () => {
    const decision = new TableQueryDecisionPolicy()
      .evaluateReclaim({
        ...reclaimInput,
        accessPathReadyAt: new Date(NOW.getTime() - 10 * DAY_MS),
      })
      ._unsafeUnwrap();

    expect(decision.action).toBe('noop');
    expect(decision.reasonCodes).toEqual(['reclaim_min_hold_not_elapsed']);
  });

  it('noops on recent search activity', () => {
    const decision = new TableQueryDecisionPolicy()
      .evaluateReclaim({
        ...reclaimInput,
        lastSearchActivityAt: new Date(NOW.getTime() - 5 * DAY_MS),
      })
      ._unsafeUnwrap();

    expect(decision.action).toBe('noop');
    expect(decision.reasonCodes).toEqual(['reclaim_recent_search_activity']);
  });

  it('never reclaims when search activity coverage is unknown', () => {
    const decision = new TableQueryDecisionPolicy()
      .evaluateReclaim({ ...reclaimInput, lastSearchActivityAt: undefined })
      ._unsafeUnwrap();

    expect(decision.action).toBe('noop');
    expect(decision.reasonCodes).toEqual(['reclaim_search_activity_unknown']);
  });

  it('never reclaims on unknown or non-zero index usage', () => {
    const policy = new TableQueryDecisionPolicy();

    const unknown = policy
      .evaluateReclaim({ ...reclaimInput, indexScanDelta: undefined })
      ._unsafeUnwrap();
    expect(unknown.action).toBe('noop');
    expect(unknown.reasonCodes).toEqual(['reclaim_index_still_used']);

    const used = policy.evaluateReclaim({ ...reclaimInput, indexScanDelta: 3 })._unsafeUnwrap();
    expect(used.action).toBe('noop');
  });
});

describe('TableQueryDecisionPolicy.computePostVerifyFailureCooldown', () => {
  it('applies exponential backoff on consecutive failures, capped at the maximum', () => {
    const policy = new TableQueryDecisionPolicy();
    const base = defaultTableQueryDecisionPolicyConfig.postVerifyFailureBackoffBaseMs;
    const max = defaultTableQueryDecisionPolicyConfig.postVerifyFailureBackoffMaxMs;
    const failure = (daysAgo: number) =>
      historyEntry({
        outcome: 'post_verify_failed',
        decidedAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
      });

    expect(
      policy.computePostVerifyFailureCooldown({ now: NOW, scopeKey: 'scope-a', history: [] })
    ).toEqual(new Date(NOW.getTime() + base));

    expect(
      policy.computePostVerifyFailureCooldown({
        now: NOW,
        scopeKey: 'scope-a',
        history: [failure(1)],
      })
    ).toEqual(new Date(NOW.getTime() + 2 * base));

    expect(
      policy.computePostVerifyFailureCooldown({
        now: NOW,
        scopeKey: 'scope-a',
        history: [failure(1), failure(2), failure(3), failure(4)],
      })
    ).toEqual(new Date(NOW.getTime() + max));
  });

  it('resets the failure streak after a successful execution', () => {
    const policy = new TableQueryDecisionPolicy();
    const base = defaultTableQueryDecisionPolicyConfig.postVerifyFailureBackoffBaseMs;

    const cooldown = policy.computePostVerifyFailureCooldown({
      now: NOW,
      scopeKey: 'scope-a',
      history: [
        historyEntry({
          outcome: 'executed',
          decidedAt: new Date(NOW.getTime() - 1 * DAY_MS),
        }),
        historyEntry({
          outcome: 'post_verify_failed',
          decidedAt: new Date(NOW.getTime() - 2 * DAY_MS),
        }),
      ],
    });

    expect(cooldown).toEqual(new Date(NOW.getTime() + base));
  });
});

describe('TableQueryDecisionLogEntry', () => {
  it('creates a pending entry from a decision and records an outcome', () => {
    const decision = new TableQueryDecisionPolicy({ autoAcceptMode: 'auto' })
      .decideAcceptance(acceptanceInput())
      ._unsafeUnwrap();

    const entry = TableQueryDecisionLogEntry.create({
      baseId: 'bse_1',
      tableId: 'tbl_1',
      scopeKey: 'scope-a',
      decision,
      actor: 'system_policy',
      recommendationId: 'tqr_1',
      now: NOW,
    })._unsafeUnwrap();

    const snapshot = entry.snapshot();
    expect(snapshot.id).toMatch(/^tqd_/);
    expect(snapshot.action).toBe('auto_accept');
    expect(snapshot.outcome).toBe('pending');
    expect(snapshot.recommendationId).toBe('tqr_1');
    expect(entry.isCoolingDownAt(NOW)).toBe(true);
    expect(entry.isCoolingDownAt(new Date(NOW.getTime() + 8 * DAY_MS))).toBe(false);

    const failed = entry
      .withOutcome('post_verify_failed', new Date(NOW.getTime() + DAY_MS))
      ._unsafeUnwrap();
    expect(failed.snapshot().outcome).toBe('post_verify_failed');
    expect(failed.snapshot().lastModifiedTime).toEqual(new Date(NOW.getTime() + DAY_MS));
  });

  it('rejects invalid snapshots on rehydrate', () => {
    const result = TableQueryDecisionLogEntry.rehydrate({
      id: '',
      baseId: 'bse_1',
      tableId: 'tbl_1',
      scopeKey: 'scope-a',
      action: 'hold',
      actor: 'system_policy',
      outcome: 'pending',
      reasonCodes: [],
      wouldAutoAccept: false,
      decidedAt: NOW,
    });
    expect(result.isErr()).toBe(true);
  });
});
