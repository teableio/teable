import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ComputedActivityBatchChanged } from '../../domain/computed/events/ComputedActivityBatchChanged';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { ComputedActivityRealtimeProjection } from './ComputedActivityRealtimeProjection';

const createEvent = (generation: number, extraTableId?: string) => {
  const baseId = BaseId.create('bseTestBase123456')._unsafeUnwrap();
  return ComputedActivityBatchChanged.create({
    baseId,
    fields: [
      {
        fieldId: 'fldFormula1',
        tableId: 'tblTestTable123456',
        baseId: baseId.toString(),
        status: 'running',
        activeTaskCount: 1,
        processingTaskCount: 1,
        generation,
        estimatedComplexity: 10,
        estimatedDirtyRecords: 2,
        hasAllTargetRecords: false,
        updatedAt: new Date().toISOString(),
      },
      ...(extraTableId
        ? [
            {
              fieldId: 'fldFormula2',
              tableId: extraTableId,
              baseId: baseId.toString(),
              status: 'queued',
              activeTaskCount: 0,
              processingTaskCount: 0,
              generation,
              estimatedComplexity: 4,
              estimatedDirtyRecords: 1,
              hasAllTargetRecords: false,
              updatedAt: new Date().toISOString(),
            },
          ]
        : []),
    ],
    tables: [
      {
        tableId: 'tblTestTable123456',
        baseId: baseId.toString(),
        status: 'calculating',
        calculatingFieldCount: 1,
        queuedFieldCount: 0,
        estimatedComplexity: 10,
        recentCompletions: [],
        generation,
        updatedAt: new Date().toISOString(),
        computeMode: 'server',
      },
    ],
  });
};

describe('ComputedActivityRealtimeProjection', () => {
  const context = { actorId: ActorId.create('usrTest')._unsafeUnwrap() };

  it('notifies each affected table once, including field-only tables', async () => {
    const notifyTableComputeActivity = vi.fn().mockResolvedValue(ok(undefined));
    const projection = new ComputedActivityRealtimeProjection({
      notifyTableComputeActivity,
    } as never);

    const result = await projection.handle(context, createEvent(3, 'tblSecondTable123456'));

    expect(result.isOk()).toBe(true);
    expect(notifyTableComputeActivity).toHaveBeenCalledTimes(2);
    expect(notifyTableComputeActivity.mock.calls.map((call) => call[1])).toEqual([
      'tblTestTable123456',
      'tblSecondTable123456',
    ]);
    expect(notifyTableComputeActivity.mock.calls[0][0]).toBe(context);
  });

  it('reports a notification failure', async () => {
    const notifyError = domainError.infrastructure({ message: 'notify failed' });
    const notifyTableComputeActivity = vi.fn().mockResolvedValue(err(notifyError));
    const projection = new ComputedActivityRealtimeProjection({
      notifyTableComputeActivity,
    } as never);

    const result = await projection.handle(context, createEvent(1));

    expect(result.isErr()).toBe(true);
    expect(notifyTableComputeActivity).toHaveBeenCalledTimes(1);
  });
});
