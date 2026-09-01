import type { DomainError, IExecutionContext } from '@teable/v2-core';
import { ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  AcceptTableQueryRecommendationCommand,
  DecideTableQueryRecommendationCommand,
  DecideTableQueryRecommendationHandler,
} from './application';
import { TableQueryDecisionPolicy, type TableQueryDecisionLogEntry } from './decisionPolicy';
import {
  TablePhysicalStats,
  TableQueryIndexInspection,
  TableQueryObservationWindow,
  TableQueryPlanValidation,
  TableQueryRecommendation,
  TableQueryRemediationTask,
  TableQueryRiskPolicy,
  TableQueryShape,
} from './domain';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const context = {} as IExecutionContext;

const unwrap = <T>(result: Result<T, DomainError>, label: string): T => {
  if (result.isErr()) throw new Error(`${label}: ${JSON.stringify(result.error)}`);
  return result.value;
};

const buildScenario = (input: { estimatedRows: number; requestCount?: number }) => {
  const requestCount = input.requestCount ?? 6;
  const shape = unwrap(
    TableQueryShape.create({
      queryKind: 'filter',
      whereShape: {
        conditionCount: 1,
        andDepth: 1,
        orDepth: 0,
        fields: [
          {
            fieldId: 'fldDecisionText',
            fieldType: 'singleLineText',
            operatorFamily: 'text_contains',
          },
        ],
      },
      executionShape: {
        durationMs: 12_000,
        dbDurationMs: 11_500,
        timedOut: false,
        resultCountBucket: 'small',
      },
    }),
    'shape'
  );
  const observation = unwrap(
    TableQueryObservationWindow.create({
      baseId: 'bseDecisionFlow',
      tableId: 'tblDecisionFlow',
      windowStart: NOW,
      windowSizeSeconds: 300,
      shape,
      requestCount,
      slowCount: requestCount,
      timeoutCount: 0,
      dbErrorCount: 0,
      totalDurationMs: requestCount * 12_000,
      maxDurationMs: 12_000,
    }),
    'observation'
  );
  const report = unwrap(
    new TableQueryRiskPolicy().evaluate({
      observation,
      physicalStats: unwrap(
        TablePhysicalStats.create({ estimatedRows: input.estimatedRows, totalBytes: 1024 }),
        'physicalStats'
      ),
      indexInspection: unwrap(
        TableQueryIndexInspection.create({
          state: 'missing',
          usefulIndexes: [],
          missingIndexCandidates: [
            {
              fieldId: 'fldDecisionText',
              fieldDbName: 'fld_text',
              kind: 'gin_trgm',
              reason: 'text contains filter needs trigram index',
            },
          ],
          abnormalIndexes: [],
        }),
        'indexInspection'
      ),
      planValidation: unwrap(
        TableQueryPlanValidation.create({
          status: 'validated',
          method: 'hypothetical_index',
          candidateCount: 1,
          totalCostBefore: 100,
          totalCostAfter: 50,
          usesCandidateIndex: true,
        }),
        'planValidation'
      ),
    }),
    'report'
  );
  const recommendation = unwrap(
    TableQueryRecommendation.createOpen({ observation, report, now: NOW }),
    'recommendation'
  );
  return { observation, report, recommendation };
};

class InMemoryDecisionLogRepository {
  readonly saved: TableQueryDecisionLogEntry[] = [];

  async save(_context: IExecutionContext, entry: TableQueryDecisionLogEntry) {
    this.saved.push(entry);
    return ok(entry);
  }

  async findRecentByScope(): Promise<
    Result<ReadonlyArray<TableQueryDecisionLogEntry>, DomainError>
  > {
    // Mirror the Postgres repository: newest first.
    return ok([...this.saved].reverse());
  }

  async findLatestByRecommendation(): Promise<
    Result<TableQueryDecisionLogEntry | undefined, DomainError>
  > {
    return ok(this.saved.at(-1));
  }
}

const buildHandler = (mode: 'off' | 'shadow' | 'auto') => {
  const repository = new InMemoryDecisionLogRepository();
  const executed: unknown[] = [];
  const commandBus = {
    async execute(_context: IExecutionContext, command: unknown) {
      executed.push(command);
      const accept = command as AcceptTableQueryRecommendationCommand;
      return ok(
        unwrap(
          TableQueryRemediationTask.createQueued({
            tableId: 'tblDecisionFlow',
            baseId: 'bseDecisionFlow',
            kind: 'create_filter_index',
            payload: { recommendationId: accept.recommendationId },
            now: NOW,
          }),
          'task'
        )
      );
    },
  };
  const handler = new DecideTableQueryRecommendationHandler(
    new TableQueryDecisionPolicy({ autoAcceptMode: mode }),
    repository as never,
    commandBus as never,
    { now: () => NOW }
  );
  return { handler, repository, executed };
};

describe('DecideTableQueryRecommendationHandler', () => {
  it('auto accepts a hot small-table recommendation and queues remediation', async () => {
    const { recommendation, report, observation } = buildScenario({ estimatedRows: 20_000 });
    const { handler, repository, executed } = buildHandler('auto');

    const result = unwrap(
      await handler.handle(
        context,
        new DecideTableQueryRecommendationCommand(recommendation, report)
      ),
      'decide'
    );

    expect(result.decision.action).toBe('auto_accept');
    expect(result.task).toBeDefined();
    expect(executed).toHaveLength(1);
    expect(executed[0]).toBeInstanceOf(AcceptTableQueryRecommendationCommand);
    expect(repository.saved).toHaveLength(1);
    const entry = repository.saved[0].snapshot();
    expect(entry.action).toBe('auto_accept');
    expect(entry.actor).toBe('system_policy');
    expect(entry.outcome).toBe('pending');
    expect(entry.scopeKey).toBe(observation.shapeHash());
    expect(entry.recommendationId).toBe(recommendation.snapshot().id);
  });

  it('logs a shadow hold without executing anything', async () => {
    const { recommendation, report } = buildScenario({ estimatedRows: 20_000 });
    const { handler, repository, executed } = buildHandler('shadow');

    const result = unwrap(
      await handler.handle(
        context,
        new DecideTableQueryRecommendationCommand(recommendation, report)
      ),
      'decide'
    );

    expect(result.decision.action).toBe('hold');
    expect(result.decision.wouldAutoAccept).toBe(true);
    expect(result.decision.reasonCodes).toContain('shadow_mode');
    expect(result.task).toBeUndefined();
    expect(executed).toHaveLength(0);
    expect(repository.saved).toHaveLength(1);
  });

  it('does not append a duplicate log row when the hold decision is unchanged', async () => {
    const { recommendation, report } = buildScenario({ estimatedRows: 20_000 });
    const { handler, repository } = buildHandler('shadow');

    const first = unwrap(
      await handler.handle(
        context,
        new DecideTableQueryRecommendationCommand(recommendation, report)
      ),
      'first decide'
    );
    const second = unwrap(
      await handler.handle(
        context,
        new DecideTableQueryRecommendationCommand(recommendation, report)
      ),
      'second decide'
    );

    expect(first.decision.action).toBe('hold');
    expect(second.decision.action).toBe('hold');
    expect(repository.saved).toHaveLength(1);
  });

  it('holds large tables for manual review even in auto mode', async () => {
    const { recommendation, report } = buildScenario({ estimatedRows: 120_000 });
    const { handler, executed } = buildHandler('auto');

    const result = unwrap(
      await handler.handle(
        context,
        new DecideTableQueryRecommendationCommand(recommendation, report)
      ),
      'decide'
    );

    expect(result.decision.action).toBe('hold');
    expect(result.decision.reasonCodes).toContain('large_table_requires_manual');
    expect(executed).toHaveLength(0);
  });

  it('does not auto accept a recommendation below the workload heat threshold', async () => {
    const { recommendation, report } = buildScenario({
      estimatedRows: 20_000,
      requestCount: 1,
    });
    const { handler, repository, executed } = buildHandler('auto');

    const result = unwrap(
      await handler.handle(
        context,
        new DecideTableQueryRecommendationCommand(recommendation, report)
      ),
      'decide'
    );

    expect(result.decision).toEqual({
      action: 'noop',
      wouldAutoAccept: false,
      reasonCodes: ['not_hot'],
    });
    expect(repository.saved).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });

  it('noops on recommendations that are no longer open', async () => {
    const { recommendation, report } = buildScenario({ estimatedRows: 20_000 });
    const accepted = unwrap(recommendation.accept(NOW), 'accept');
    const { handler, repository, executed } = buildHandler('auto');

    const result = unwrap(
      await handler.handle(context, new DecideTableQueryRecommendationCommand(accepted, report)),
      'decide'
    );

    expect(result.decision.action).toBe('noop');
    expect(repository.saved).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });

  it('holds auto-accept when the only candidate is a non-executable search access path', async () => {
    const shape = unwrap(
      TableQueryShape.create({
        queryKind: 'search',
        searchShape: {
          fieldCount: 40,
          allFields: true,
          valueLengthBucket: 'medium',
        },
        executionShape: {
          durationMs: 12_000,
          timedOut: false,
        },
      }),
      'search-shape'
    );
    const observation = unwrap(
      TableQueryObservationWindow.create({
        baseId: 'bseDecisionFlow',
        tableId: 'tblDecisionFlow',
        windowStart: NOW,
        windowSizeSeconds: 300,
        shape,
        requestCount: 6,
        slowCount: 6,
        timeoutCount: 0,
        dbErrorCount: 0,
        totalDurationMs: 72_000,
        maxDurationMs: 12_000,
      }),
      'search-observation'
    );
    const report = unwrap(
      new TableQueryRiskPolicy().evaluate({
        observation,
        physicalStats: unwrap(
          TablePhysicalStats.create({ estimatedRows: 20_000, totalBytes: 1024 }),
          'search-physicalStats'
        ),
        indexInspection: unwrap(
          TableQueryIndexInspection.create({
            state: 'missing',
            usefulIndexes: [],
            missingIndexCandidates: [],
            abnormalIndexes: [],
          }),
          'search-indexInspection'
        ),
        planValidation: unwrap(
          TableQueryPlanValidation.create({
            status: 'validated',
            method: 'hypothetical_index',
            candidateCount: 1,
            totalCostBefore: 100,
            totalCostAfter: 50,
            usesCandidateIndex: true,
          }),
          'search-planValidation'
        ),
      }),
      'search-report'
    );
    const recommendation = unwrap(
      TableQueryRecommendation.createOpen({ observation, report, now: NOW }),
      'search-recommendation'
    );
    const { handler, repository, executed } = buildHandler('auto');

    const result = unwrap(
      await handler.handle(
        context,
        new DecideTableQueryRecommendationCommand(recommendation, report)
      ),
      'decide-search-path'
    );

    expect(recommendation.snapshot().remediationCandidates[0]?.kind).toBe(
      'create_search_access_path'
    );
    expect(result.decision.action).toBe('hold');
    expect(result.decision.reasonCodes).toContain('no_executable_phase1_candidate');
    expect(repository.saved).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });
});
