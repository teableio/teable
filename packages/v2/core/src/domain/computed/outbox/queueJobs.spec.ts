import { describe, expect, it } from 'vitest';

import { projectComputedOutboxQueueJobs } from './queueJobs';
import type { ComputedOutboxQueueJob } from './types';

const job = (
  overrides: Partial<ComputedOutboxQueueJob> & Pick<ComputedOutboxQueueJob, 'taskId' | 'state'>
): ComputedOutboxQueueJob => ({
  baseId: 'bse123',
  attemptsMade: 1,
  createdAt: '2026-08-07T04:00:00.000Z',
  ...overrides,
});

describe('projectComputedOutboxQueueJobs', () => {
  it('filters, sorts, facets, and paginates scanned queue jobs', () => {
    const jobs: ComputedOutboxQueueJob[] = [
      job({
        taskId: 'cuo-delayed',
        baseId: 'bse-finance',
        spaceId: 'spc-finance',
        spaceName: 'Finance',
        cause: 'retry',
        state: 'delayed',
        scheduledFor: '2026-08-07T06:00:00.000Z',
      }),
      job({
        taskId: 'cuo-active',
        baseId: 'bse-ops',
        spaceId: 'spc-ops',
        spaceName: 'Operations',
        cause: 'created',
        state: 'active',
        createdAt: '2026-08-07T04:30:00.000Z',
        startedAt: '2026-08-07T04:59:00.000Z',
      }),
      job({
        taskId: 'cuo-failed',
        baseId: 'bse-finance',
        spaceId: 'spc-finance',
        spaceName: 'Finance',
        cause: 'retry',
        state: 'failed',
        createdAt: '2026-08-07T04:10:00.000Z',
        finishedAt: '2026-08-07T04:20:00.000Z',
        failedReason: 'boom',
        ledgerState: 'dead',
      }),
    ];

    const result = projectComputedOutboxQueueJobs({
      jobs,
      scan: [
        { state: 'delayed', scanned: 1, truncated: false },
        { state: 'active', scanned: 1, truncated: false },
        { state: 'failed', scanned: 1, truncated: false },
      ],
      states: ['delayed', 'active', 'failed'],
      spaceIds: ['spc-finance'],
      baseIds: [],
      causes: [],
      outcomes: [],
      view: 'deliveries',
      includeSettled: true,
      sort: 'time',
      limit: 1,
      offset: 0,
      sampledAt: '2026-08-07T07:00:00.000Z',
    });

    expect(result.total).toBe(2);
    expect(result.jobs).toEqual([
      expect.objectContaining({ taskId: 'cuo-delayed', spaceName: 'Finance' }),
    ]);
    expect(result.facets.spaces).toEqual([
      { id: 'spc-finance', name: 'Finance', count: 2 },
      { id: 'spc-ops', name: 'Operations', count: 1 },
    ]);
    expect(result.facets.causes).toEqual([
      { cause: 'retry', count: 2 },
      { cause: 'created', count: 1 },
    ]);

    const secondPage = projectComputedOutboxQueueJobs({
      jobs,
      scan: [],
      states: ['delayed', 'active', 'failed'],
      spaceIds: ['spc-finance'],
      baseIds: [],
      causes: [],
      outcomes: [],
      view: 'deliveries',
      includeSettled: true,
      sort: 'time',
      limit: 1,
      offset: 1,
      sampledAt: '2026-08-07T07:00:00.000Z',
    });
    expect(secondPage.jobs).toEqual([
      expect.objectContaining({ taskId: 'cuo-failed', ledgerState: 'dead' }),
    ]);
  });

  it('collapses deliveries per task and hides settled failures', () => {
    const jobs: ComputedOutboxQueueJob[] = [
      job({
        taskId: 'cuo-a',
        cause: 'created',
        state: 'completed',
        finishedAt: '2026-08-07T04:00:01.000Z',
        processingDurationMs: 5,
        outcome: 'deferred',
      }),
      job({
        taskId: 'cuo-a',
        cause: 'replay',
        state: 'delayed',
        attemptsMade: 0,
        createdAt: '2026-08-07T04:00:01.000Z',
        scheduledFor: '2026-08-07T04:00:02.000Z',
      }),
      job({
        taskId: 'cuo-b',
        cause: 'retry',
        state: 'failed',
        attemptsMade: 3,
        createdAt: '2026-08-07T04:01:00.000Z',
        finishedAt: '2026-08-07T04:02:00.000Z',
        failedReason: 'transient timeout',
        ledgerState: 'settled',
      }),
      job({
        taskId: 'cuo-c',
        cause: 'retry',
        state: 'failed',
        attemptsMade: 3,
        createdAt: '2026-08-07T04:03:00.000Z',
        finishedAt: '2026-08-07T04:04:00.000Z',
        failedReason: 'boom',
        ledgerState: 'dead',
      }),
    ];

    const grouped = projectComputedOutboxQueueJobs({
      jobs,
      scan: [],
      states: [],
      spaceIds: [],
      baseIds: [],
      causes: [],
      outcomes: [],
      view: 'tasks',
      includeSettled: false,
      sort: 'time',
      limit: 50,
      offset: 0,
      sampledAt: '2026-08-07T07:00:00.000Z',
    });
    expect(grouped.total).toBe(2);
    expect(grouped.jobs).toEqual([
      expect.objectContaining({ taskId: 'cuo-c', state: 'failed', ledgerState: 'dead' }),
      expect.objectContaining({ taskId: 'cuo-a', state: 'delayed', deliveryCount: 2 }),
    ]);
    expect(grouped.hiddenSettled).toBe(1);

    const withSettled = projectComputedOutboxQueueJobs({
      jobs,
      scan: [],
      states: [],
      spaceIds: [],
      baseIds: [],
      causes: [],
      outcomes: [],
      view: 'tasks',
      includeSettled: true,
      sort: 'time',
      limit: 50,
      offset: 0,
      sampledAt: '2026-08-07T07:00:00.000Z',
    });
    expect(withSettled.total).toBe(3);
    expect(withSettled.hiddenSettled).toBeUndefined();

    const deliveries = projectComputedOutboxQueueJobs({
      jobs,
      scan: [],
      states: [],
      spaceIds: [],
      baseIds: [],
      causes: [],
      outcomes: [],
      view: 'deliveries',
      includeSettled: true,
      sort: 'time',
      limit: 50,
      offset: 0,
      sampledAt: '2026-08-07T07:00:00.000Z',
    });
    expect(deliveries.total).toBe(4);
  });

  it('keeps slow jobs via duration threshold and duration sort', () => {
    const jobs: ComputedOutboxQueueJob[] = [
      job({
        taskId: 'cuo-fast',
        state: 'completed',
        finishedAt: '2026-08-07T04:00:02.000Z',
        processingDurationMs: 20,
        outcome: 'processed',
      }),
      job({
        taskId: 'cuo-slow',
        state: 'completed',
        finishedAt: '2026-08-07T04:01:00.000Z',
        processingDurationMs: 5_000,
        outcome: 'processed',
      }),
      job({
        taskId: 'cuo-running',
        state: 'active',
        startedAt: '2026-08-07T04:02:00.000Z',
      }),
    ];

    const result = projectComputedOutboxQueueJobs({
      jobs,
      scan: [],
      states: [],
      spaceIds: [],
      baseIds: [],
      causes: [],
      outcomes: [],
      minDurationMs: 1_000,
      view: 'deliveries',
      includeSettled: true,
      sort: 'duration',
      limit: 50,
      offset: 0,
      sampledAt: '2026-08-07T07:00:00.000Z',
    });
    expect(result.jobs.map((item) => item.taskId)).toEqual(['cuo-slow']);
  });
});
