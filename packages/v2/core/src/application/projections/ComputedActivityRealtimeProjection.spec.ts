import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ComputedActivityBatchChanged } from '../../domain/computed/events/ComputedActivityBatchChanged';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { ComputedActivityRealtimeProjection } from './ComputedActivityRealtimeProjection';

const createEvent = (generation: number) => {
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

  it('creates first-generation table and field documents', async () => {
    const ensure = vi.fn().mockResolvedValue(ok(undefined));
    const applyChange = vi.fn().mockResolvedValue(ok(undefined));
    const projection = new ComputedActivityRealtimeProjection({
      ensure,
      applyChange,
      delete: vi.fn(),
    } as never);

    const result = await projection.handle(context, createEvent(1));

    expect(result.isOk()).toBe(true);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(applyChange).not.toHaveBeenCalled();
    const docIds = ensure.mock.calls.map((call) => String(call[1]));
    expect(docIds.some((id) => id.includes('cmp_tblTestTable123456/table'))).toBe(true);
    expect(docIds.some((id) => id.includes('cmp_tblTestTable123456/fldFormula1'))).toBe(true);
    const fieldCall = ensure.mock.calls.find((call) =>
      String(call[1]).includes('cmp_tblTestTable123456/fldFormula1')
    );
    expect(fieldCall?.[2]).toMatchObject({
      activeTaskCount: 1,
      processingTaskCount: 1,
      batchProgress: { total: 1, completed: 0 },
    });
  });

  it('publishes later generations at the preceding ShareDB version', async () => {
    const ensure = vi.fn().mockResolvedValue(ok(undefined));
    const applyChange = vi.fn().mockResolvedValue(ok(undefined));
    const projection = new ComputedActivityRealtimeProjection({
      ensure,
      applyChange,
      delete: vi.fn(),
    } as never);

    const result = await projection.handle(context, createEvent(2));

    expect(result.isOk()).toBe(true);
    expect(ensure).not.toHaveBeenCalled();
    expect(applyChange).toHaveBeenCalledTimes(2);
    expect(applyChange.mock.calls.every((call) => call[3]?.version === 1)).toBe(true);
  });

  it('publishes independent table and field documents concurrently', async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;
    const ensure = vi.fn().mockImplementation(async () => {
      activeTasks += 1;
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      activeTasks -= 1;
      return ok(undefined);
    });
    const projection = new ComputedActivityRealtimeProjection({
      ensure,
      applyChange: vi.fn().mockResolvedValue(ok(undefined)),
      delete: vi.fn(),
    } as never);

    const result = await projection.handle(context, createEvent(1));

    expect(result.isOk()).toBe(true);
    expect(maxActiveTasks).toBe(2);
  });

  it('processes field documents but reports a table publication failure', async () => {
    const tableError = domainError.infrastructure({ message: 'table publish failed' });
    const ensure = vi
      .fn()
      .mockImplementation(async (_context, docId) =>
        String(docId).includes('/table') ? err(tableError) : ok(undefined)
      );
    const projection = new ComputedActivityRealtimeProjection({
      ensure,
      applyChange: vi.fn().mockResolvedValue(ok(undefined)),
      delete: vi.fn(),
    } as never);

    const result = await projection.handle(context, createEvent(1));

    expect(result.isErr()).toBe(true);
    expect(ensure).toHaveBeenCalledTimes(2);
  });
});
