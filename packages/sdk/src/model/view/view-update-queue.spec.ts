import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueViewUpdate } from './view-update-queue';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('enqueueViewUpdate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the next update of a view only after the previous one settled', async () => {
    const first = deferred<string>();
    const sendFirst = vi.fn(() => first.promise);
    const sendSecond = vi.fn(() => Promise.resolve('second'));

    const firstResult = enqueueViewUpdate('viwA', sendFirst);
    const secondResult = enqueueViewUpdate('viwA', sendSecond);
    await flush();

    expect(sendFirst).toHaveBeenCalledTimes(1);
    expect(sendSecond).not.toHaveBeenCalled();

    first.resolve('first');
    await expect(firstResult).resolves.toBe('first');
    await expect(secondResult).resolves.toBe('second');
    expect(sendSecond).toHaveBeenCalledTimes(1);
  });

  it('still sends the next update when the previous one failed', async () => {
    const failed = enqueueViewUpdate('viwB', () => Promise.reject(new Error('conflict')));
    const next = enqueueViewUpdate('viwB', () => Promise.resolve('next'));

    await expect(failed).rejects.toThrow('conflict');
    await expect(next).resolves.toBe('next');
  });

  it('does not hold updates of other views', async () => {
    const pending = deferred<void>();
    void enqueueViewUpdate('viwC', () => pending.promise);
    const sendOther = vi.fn(() => Promise.resolve('other'));

    await expect(enqueueViewUpdate('viwD', sendOther)).resolves.toBe('other');
    pending.resolve();
  });

  it('stops waiting for a previous update that never settles', async () => {
    vi.useFakeTimers();
    void enqueueViewUpdate('viwE', () => new Promise<void>(() => undefined));
    const sendNext = vi.fn(() => Promise.resolve('next'));
    const next = enqueueViewUpdate('viwE', sendNext);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(sendNext).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toBe('next');
  });
});
