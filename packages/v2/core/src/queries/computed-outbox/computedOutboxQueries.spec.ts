import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type {
  ComputedOutboxQueueJob,
  ComputedOutboxTaskLineage,
} from '../../domain/computed/outbox';
import { ActorId } from '../../domain/shared/ActorId';
import type { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { GetComputedOutboxOverviewQuery } from './GetComputedOutboxOverviewQuery';
import { GetComputedOutboxTaskLineageHandler } from './GetComputedOutboxTaskLineageHandler';
import { GetComputedOutboxTaskLineageQuery } from './GetComputedOutboxTaskLineageQuery';
import { ListComputedOutboxAnomaliesQuery } from './ListComputedOutboxAnomaliesQuery';
import { ListComputedOutboxQueueJobsHandler } from './ListComputedOutboxQueueJobsHandler';
import { ListComputedOutboxQueueJobsQuery } from './ListComputedOutboxQueueJobsQuery';

const context = (): IExecutionContext => ({
  actorId: ActorId.create('usrxxxxxxxxxxxxxxxxx')._unsafeUnwrap(),
});

describe('computed outbox queries', () => {
  it('treats refresh=1 as a forced overview sample', () => {
    expect(GetComputedOutboxOverviewQuery.create({ force: '1' })._unsafeUnwrap().force).toBe(true);
    expect(GetComputedOutboxOverviewQuery.create({ force: '0' })._unsafeUnwrap().force).toBe(false);
  });

  it('rejects anomaly list limits above the cap', () => {
    expect(ListComputedOutboxAnomaliesQuery.create({ limit: 101 }).isErr()).toBe(true);
  });

  it('projects scanned queue jobs in the handler', async () => {
    const jobs: ComputedOutboxQueueJob[] = [
      {
        taskId: 'cuo-a',
        baseId: 'bse123',
        cause: 'created',
        state: 'completed',
        attemptsMade: 1,
        createdAt: '2026-08-07T04:00:00.000Z',
        finishedAt: '2026-08-07T04:00:01.000Z',
        processingDurationMs: 5,
        outcome: 'deferred',
      },
      {
        taskId: 'cuo-a',
        baseId: 'bse123',
        cause: 'replay',
        state: 'delayed',
        attemptsMade: 0,
        createdAt: '2026-08-07T04:00:01.000Z',
        scheduledFor: '2026-08-07T04:00:02.000Z',
      },
      {
        taskId: 'cuo-b',
        baseId: 'bse123',
        cause: 'retry',
        state: 'failed',
        attemptsMade: 3,
        createdAt: '2026-08-07T04:01:00.000Z',
        finishedAt: '2026-08-07T04:02:00.000Z',
        failedReason: 'timeout',
        ledgerState: 'settled',
      },
    ];
    const scanQueueJobs = vi.fn().mockResolvedValue(ok({ jobs, scan: [] }));
    const handler = new ListComputedOutboxQueueJobsHandler({
      scanQueueJobs,
    } as unknown as IComputedOutboxAdmin);
    const query = ListComputedOutboxQueueJobsQuery.create({
      view: 'tasks',
      includeSettled: false,
      limit: 50,
      offset: 0,
    })._unsafeUnwrap();

    const result = await handler.handle(context(), query);
    expect(result._unsafeUnwrap().list.total).toBe(1);
    expect(result._unsafeUnwrap().list.jobs).toEqual([
      expect.objectContaining({ taskId: 'cuo-a', state: 'delayed', deliveryCount: 2 }),
    ]);
    expect(result._unsafeUnwrap().list.hiddenSettled).toBe(1);
  });

  it('rejects blank lineage task ids', () => {
    expect(GetComputedOutboxTaskLineageQuery.create({ taskId: '  ' }).isErr()).toBe(true);
    expect(GetComputedOutboxTaskLineageQuery.create({}).isErr()).toBe(true);
    expect(
      GetComputedOutboxTaskLineageQuery.create({ taskId: ' cuo123 ' })._unsafeUnwrap().taskId
    ).toBe('cuo123');
  });

  it('resolves task lineage through the admin port', async () => {
    const lineage: ComputedOutboxTaskLineage = {
      targetId: 'meta-fallback',
      storage: 'default',
      baseId: 'bse123',
      task: {
        taskId: 'cuo123',
        state: 'succeeded',
        baseId: 'bse123',
        seedTableId: 'tbl123',
        changeType: 'seed',
        runId: 'run123',
        originRunIds: ['run122'],
        stageDepth: 0,
        predecessorTaskId: null,
        attempts: 1,
        estimatedComplexity: 2,
        runTotalSteps: 2,
        runCompletedStepsBefore: 0,
        syncMaxLevel: 0,
        seedRecordCount: 2,
        sourceFieldIds: ['fld123'],
        affectedFieldIds: ['fld123'],
        affectedTableIds: ['tbl123'],
        sourceChangedAt: '2026-08-23T10:00:00.000Z',
        enqueuedAt: '2026-08-23T10:00:00.100Z',
        startedAt: '2026-08-23T10:00:01.000Z',
        completedAt: '2026-08-23T10:00:02.000Z',
        failedAt: null,
        durationMs: 1000,
        lastError: null,
        steps: [],
        edges: [],
      },
      runChain: [],
      fields: [{ fieldId: 'fld123', fieldName: 'Amount' }],
      tables: [{ tableId: 'tbl123', tableName: 'Orders' }],
      summary: {
        sourceChangedAt: '2026-08-23T10:00:00.000Z',
        convergedAt: '2026-08-23T10:00:02.000Z',
        endToEndMs: 2000,
        live: false,
        sourceFieldIds: ['fld123'],
      },
    };
    const getTaskLineage = vi.fn().mockResolvedValue(ok(lineage));
    const handler = new GetComputedOutboxTaskLineageHandler({
      getTaskLineage,
    } as unknown as IComputedOutboxAdmin);
    const query = GetComputedOutboxTaskLineageQuery.create({ taskId: 'cuo123' })._unsafeUnwrap();

    const result = await handler.handle(context(), query);
    expect(getTaskLineage).toHaveBeenCalledWith(expect.anything(), { taskId: 'cuo123' });
    expect(result._unsafeUnwrap().lineage.summary.endToEndMs).toBe(2000);
    expect(result._unsafeUnwrap().lineage.task.taskId).toBe('cuo123');
  });
});
