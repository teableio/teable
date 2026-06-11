import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axios } from '../axios';
import { clearSelectionStream } from './clear-stream';

const createSSEStreamResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
};

describe('clearSelectionStream', () => {
  const originalCommon = axios.defaults.headers.common;

  afterEach(() => {
    vi.unstubAllGlobals();
    axios.defaults.headers.common = originalCommon;
  });

  it('reports progress and resolves the final done event', async () => {
    const onProgress = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"id":"progress","phase":"preparing","batchIndex":-1,"totalCount":3,"processedCount":0,"clearedCount":0,"batchProcessedCount":0,"batchClearedCount":0}\n',
            'data: {"id":"progress","phase":"clearing","batchIndex":0,"totalCount":3,"processedCount":2,"clearedCount":2,"batchProcessedCount":2,"batchClearedCount":2}\n',
            'data: {"id":"done","totalCount":3,"processedCount":3,"clearedCount":3,"data":{"clearedCount":3,"clearedRecordIds":["rec1","rec2","rec3"]}}',
          ])
        )
    );

    const result = await clearSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [
          [0, 0],
          [0, 2],
        ],
      },
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(result.data).toBeNull();
    expect(result.done).toMatchObject({
      id: 'done',
      totalCount: 3,
      processedCount: 3,
      clearedCount: 3,
    });
    expect(result.errors).toEqual([]);
  });

  it('collects chunk errors and still resolves once a done event arrives', async () => {
    const onError = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"id":"progress","phase":"clearing","batchIndex":0,"totalCount":3,"processedCount":1,"clearedCount":1,"batchProcessedCount":1,"batchClearedCount":1}\n',
            'data: {"id":"error","phase":"clearing","batchIndex":1,"totalCount":3,"processedCount":1,"clearedCount":1,"recordIds":["rec2"],"message":"clear failed","code":"unexpected"}\n',
            'data: {"id":"done","totalCount":3,"processedCount":2,"clearedCount":2,"data":{"clearedCount":2,"clearedRecordIds":["rec1","rec3"]}}',
          ])
        )
    );

    const result = await clearSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [
          [0, 0],
          [0, 2],
        ],
      },
      { onError }
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'error',
        batchIndex: 1,
        message: 'clear failed',
        recordIds: ['rec2'],
      })
    );
    expect(result.done.data.clearedRecordIds).toEqual(['rec1', 'rec3']);
    expect(result.errors).toHaveLength(1);
  });

  it('uses patch defaults and keeps the current undo/redo window id header', async () => {
    const common = new AxiosHeaders();
    common.set('X-Window-Id', 'win_stream_clear');
    axios.defaults.headers.common = common as never;
    axios.defaults.headers.patch = {
      'X-Patch': 'patch-default',
    } as never;

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSSEStreamResponse([
          'data: {"id":"done","totalCount":1,"processedCount":1,"clearedCount":1,"data":{"clearedCount":1,"clearedRecordIds":["rec1"]}}',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    await clearSelectionStream('tbl0000000000000000', {
      ranges: [[0, 0]],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'X-Window-Id': 'win_stream_clear',
          'X-Patch': 'patch-default',
          'Content-Type': 'application/json',
        }),
      })
    );
  });
});
