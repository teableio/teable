import type { DomainError, IExecutionContext } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BufferedTableQueryObservationPublisher } from './bufferedTableQueryObservationPublisher';
import { TableQueryObservationWindow, TableQueryShape } from './domain';

const context = {} as IExecutionContext;
const windowStart = new Date('2026-08-27T12:00:00.000Z');

const observation = (input: {
  readonly tableId: string;
  readonly requestCount?: number;
  readonly slowCount?: number;
  readonly durationMs?: number;
  readonly dbDurationMs?: number;
}): TableQueryObservationWindow => {
  const requestCount = input.requestCount ?? 1;
  const durationMs = input.durationMs ?? 10;
  const shape = TableQueryShape.create({
    queryKind: 'recordList',
    executionShape: {
      durationMs,
      dbDurationMs: input.dbDurationMs,
      timedOut: false,
      resultCountBucket: 'small',
    },
  })._unsafeUnwrap();
  return TableQueryObservationWindow.create({
    baseId: 'bse-buffer',
    tableId: input.tableId,
    windowStart,
    windowSizeSeconds: 300,
    shape,
    requestCount,
    slowCount: input.slowCount ?? 0,
    timeoutCount: 0,
    dbErrorCount: 0,
    totalDurationMs: durationMs,
    maxDurationMs: durationMs,
    totalDbDurationMs: input.dbDurationMs,
    maxDbDurationMs: input.dbDurationMs,
  })._unsafeUnwrap();
};

describe('BufferedTableQueryObservationPublisher', () => {
  let publisher: BufferedTableQueryObservationPublisher | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    publisher?.stop();
    publisher = undefined;
    vi.useRealTimers();
  });

  it('delays flush and coalesces equal durable-window keys', async () => {
    const recordBatch = vi.fn().mockResolvedValue(ok(undefined));
    publisher = new BufferedTableQueryObservationPublisher(
      { recordBatch },
      { writerId: 'writer-a' }
    );

    publisher.publish(
      context,
      observation({
        tableId: 'tbl-a',
        requestCount: 2,
        slowCount: 1,
        durationMs: 20,
        dbDurationMs: 4,
      })
    );
    publisher.publish(
      context,
      observation({
        tableId: 'tbl-a',
        requestCount: 3,
        slowCount: 2,
        durationMs: 40,
        dbDurationMs: 12,
      })
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(recordBatch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(recordBatch).toHaveBeenCalledOnce();
    const [, batch] = recordBatch.mock.calls[0] ?? [];
    expect(batch.writerId).toBe('writer-a');
    expect(batch.observations).toHaveLength(1);
    expect(batch.observations[0]?.snapshot()).toMatchObject({
      requestCount: 5,
      slowCount: 3,
      totalDurationMs: 60,
      maxDurationMs: 40,
      totalDbDurationMs: 16,
      maxDbDurationMs: 12,
    });
  });

  it('allows only one recordBatch call in flight', async () => {
    let releaseFirst!: (result: Result<void, DomainError>) => void;
    const recordBatch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Result<void, DomainError>>((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockResolvedValue(ok(undefined));
    publisher = new BufferedTableQueryObservationPublisher(
      { recordBatch },
      { writerId: 'writer-a', batchSize: 1 }
    );

    publisher.publish(context, observation({ tableId: 'tbl-a' }));
    const firstFlush = publisher.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(recordBatch).toHaveBeenCalledOnce();

    publisher.publish(context, observation({ tableId: 'tbl-b' }));
    const secondFlush = publisher.flush();
    expect(secondFlush).not.toBe(firstFlush);
    expect(recordBatch).toHaveBeenCalledOnce();

    releaseFirst(ok(undefined));
    await Promise.all([firstFlush, secondFlush]);

    expect(recordBatch).toHaveBeenCalledTimes(2);
  });

  it('evicts the coldest key when the pending-key bound is reached', async () => {
    const recordBatch = vi.fn().mockResolvedValue(ok(undefined));
    publisher = new BufferedTableQueryObservationPublisher(
      { recordBatch },
      { writerId: 'writer-a', maxPendingKeys: 2 }
    );

    publisher.publish(context, observation({ tableId: 'tbl-hot', requestCount: 10 }));
    publisher.publish(context, observation({ tableId: 'tbl-cold-old' }));
    publisher.publish(context, observation({ tableId: 'tbl-cold-new' }));
    await publisher.flush();

    const [, batch] = recordBatch.mock.calls[0] ?? [];
    expect(batch.observations.map((item: TableQueryObservationWindow) => item.tableId())).toEqual([
      'tbl-hot',
      'tbl-cold-new',
    ]);
  });

  it('extends an in-flight flush to observations published before it settles', async () => {
    let releaseFirst!: (result: Result<void, DomainError>) => void;
    const recordBatch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Result<void, DomainError>>((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockResolvedValue(ok(undefined));
    publisher = new BufferedTableQueryObservationPublisher(
      { recordBatch },
      { writerId: 'writer-a', batchSize: 1 }
    );

    publisher.publish(context, observation({ tableId: 'tbl-a' }));
    const firstFlush = publisher.flush();
    await Promise.resolve();
    await Promise.resolve();
    const coveringFlush = publisher.flush();

    releaseFirst(ok(undefined));
    queueMicrotask(() => publisher?.publish(context, observation({ tableId: 'tbl-b' })));
    await Promise.all([firstFlush, coveringFlush]);

    expect(recordBatch).toHaveBeenCalledTimes(2);
  });

  it('drops a failed batch instead of retrying or merging it later', async () => {
    const recordBatch = vi
      .fn()
      .mockResolvedValueOnce(err({ message: 'unavailable' } as DomainError))
      .mockResolvedValue(ok(undefined));
    publisher = new BufferedTableQueryObservationPublisher(
      { recordBatch },
      { writerId: 'writer-a' }
    );

    publisher.publish(context, observation({ tableId: 'tbl-a' }));
    await publisher.flush();
    publisher.publish(context, observation({ tableId: 'tbl-a' }));
    await publisher.flush();

    expect(recordBatch).toHaveBeenCalledTimes(2);
    expect(recordBatch.mock.calls[0]?.[1].observations[0].requestCount()).toBe(1);
    expect(recordBatch.mock.calls[1]?.[1].observations[0].requestCount()).toBe(1);
  });

  it('drops the pending tail on stop without waiting for the in-flight batch', async () => {
    let releaseFirst!: (result: Result<void, DomainError>) => void;
    const recordBatch = vi.fn(
      () =>
        new Promise<Result<void, DomainError>>((resolve) => {
          releaseFirst = resolve;
        })
    );
    publisher = new BufferedTableQueryObservationPublisher(
      { recordBatch },
      { writerId: 'writer-a', batchSize: 1 }
    );

    publisher.publish(context, observation({ tableId: 'tbl-a' }));
    const flush = publisher.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(recordBatch).toHaveBeenCalledOnce();

    publisher.publish(context, observation({ tableId: 'tbl-b' }));
    publisher.stop();
    releaseFirst(ok(undefined));
    await flush;
    await publisher.flush();

    expect(recordBatch).toHaveBeenCalledOnce();
  });
});
