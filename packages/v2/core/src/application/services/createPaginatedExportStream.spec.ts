import { describe, expect, it, vi } from 'vitest';

import { createPaginatedExportStream } from './createPaginatedExportStream';

describe('createPaginatedExportStream', () => {
  it('pulls one page at a time and stops after the first empty page', async () => {
    const firstPage = [{ id: 'record-1' }] as const;
    const getPage = vi
      .fn<(offset: number, limit: number) => Promise<readonly { id: string }[]>>()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([]);
    const iterator = createPaginatedExportStream({ pageSize: 100, getPage })[
      Symbol.asyncIterator
    ]();

    expect(getPage).not.toHaveBeenCalled();

    await expect(iterator.next()).resolves.toEqual({
      value: firstPage,
      done: false,
    });
    expect(getPage).toHaveBeenCalledTimes(1);

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(getPage).toHaveBeenCalledTimes(2);

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  it('preserves order and advances by the returned record count', async () => {
    const pages = [[{ id: 'record-1' }, { id: 'record-2' }], [{ id: 'record-3' }], []] as const;
    const getPage = vi.fn(async (offset: number, limit: number) => {
      const pageByOffset: Record<number, readonly { id: string }[]> = {
        0: pages[0],
        2: pages[1],
        3: pages[2],
      };
      expect(limit).toBe(2);
      return pageByOffset[offset] ?? [];
    });
    const received: Array<readonly { id: string }[]> = [];

    const stream = createPaginatedExportStream({ pageSize: 2, getPage });
    for await (const page of stream) {
      received.push(page);
    }

    expect(received).toEqual([pages[0], pages[1]]);
    expect(getPage.mock.calls).toEqual([
      [0, 2],
      [2, 2],
      [3, 2],
    ]);
  });

  it('does not pull another page after the consumer returns', async () => {
    const getPage = vi.fn(async () => [{ id: 'record-1' }] as const);
    const iterator = createPaginatedExportStream({ pageSize: 1, getPage })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: [{ id: 'record-1' }],
      done: false,
    });
    await expect(iterator.return?.()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });

    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it('rejects an in-flight pull after its query settles when aborted', async () => {
    const controller = new AbortController();
    const abortReason = new Error('export cancelled');
    const pageResult = Promise.withResolvers<readonly { id: string }[]>();
    const getPage = vi.fn(() => pageResult.promise);
    const iterator = createPaginatedExportStream({
      pageSize: 10,
      getPage,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const pendingPage = iterator.next();

    controller.abort(abortReason);
    pageResult.resolve([{ id: 'record-1' }]);

    await expect(pendingPage).rejects.toBe(abortReason);
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it('checks cancellation before every page query', async () => {
    const initialController = new AbortController();
    const initialAbortReason = new Error('cancelled before export');
    initialController.abort(initialAbortReason);
    const neverCalled = vi.fn(async () => []);
    const initiallyAbortedIterator = createPaginatedExportStream({
      pageSize: 10,
      getPage: neverCalled,
      signal: initialController.signal,
    })[Symbol.asyncIterator]();

    await expect(initiallyAbortedIterator.next()).rejects.toBe(initialAbortReason);
    expect(neverCalled).not.toHaveBeenCalled();

    const laterController = new AbortController();
    const laterAbortReason = new Error('cancelled after first page');
    const firstPage = [{ id: 'record-1' }] as const;
    const getPage = vi.fn(async () => firstPage);
    const iterator = createPaginatedExportStream({
      pageSize: 10,
      getPage,
      signal: laterController.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: firstPage,
      done: false,
    });
    laterController.abort(laterAbortReason);
    await expect(iterator.next()).rejects.toBe(laterAbortReason);
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it('propagates the page query failure unchanged', async () => {
    const queryFailure = new Error('query failed');
    const getPage = vi.fn(async () => {
      throw queryFailure;
    });
    const iterator = createPaginatedExportStream({ pageSize: 50, getPage })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBe(queryFailure);
    expect(getPage).toHaveBeenCalledWith(0, 50);
  });
});
