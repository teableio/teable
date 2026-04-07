import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axios } from '../axios';
import { duplicateSelectionStream } from './duplicate-stream';

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

describe('duplicateSelectionStream', () => {
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
            'data: {"id":"progress","phase":"preparing","batchIndex":-1,"totalCount":3,"duplicatedCount":0,"batchDuplicatedCount":0}\n',
            'data: {"id":"progress","phase":"duplicating","batchIndex":0,"totalCount":3,"duplicatedCount":2,"batchDuplicatedCount":2}\n',
            'data: {"id":"done","totalCount":3,"duplicatedCount":3,"data":{"duplicatedCount":3,"duplicatedRecordIds":["rec1","rec2","rec3"]}}',
          ])
        )
    );

    const result = await duplicateSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [[0, 2]],
        type: 'rows',
      },
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(result.done).toMatchObject({
      id: 'done',
      totalCount: 3,
      duplicatedCount: 3,
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
            'data: {"id":"progress","phase":"duplicating","batchIndex":0,"totalCount":3,"duplicatedCount":1,"batchDuplicatedCount":1}\n',
            'data: {"id":"error","phase":"duplicating","batchIndex":1,"totalCount":3,"duplicatedCount":1,"recordIds":["rec2"],"message":"duplicate failed","code":"unexpected"}\n',
            'data: {"id":"done","totalCount":3,"duplicatedCount":2,"data":{"duplicatedCount":2,"duplicatedRecordIds":["rec1","rec3"]}}',
          ])
        )
    );

    const result = await duplicateSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [[0, 0]],
        type: 'rows',
      },
      {
        onError,
      }
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'error',
        batchIndex: 1,
        recordIds: ['rec2'],
        message: 'duplicate failed',
      })
    );
    expect(result.done.data.duplicatedRecordIds).toEqual(['rec1', 'rec3']);
    expect(result.errors).toHaveLength(1);
  });

  it('throws when the stream ends with only error events', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"id":"error","phase":"preparing","batchIndex":-1,"totalCount":0,"duplicatedCount":0,"recordIds":[],"message":"duplicate failed","code":"unexpected"}',
          ])
        )
    );

    await expect(
      duplicateSelectionStream('tbl0000000000000000', {
        ranges: [[0, 0]],
        type: 'rows',
      })
    ).rejects.toThrow('duplicate failed');
  });

  it('reuses the current undo/redo window id header for fetch-based streaming requests', async () => {
    const common = new AxiosHeaders();
    common.set('X-Window-Id', 'win_stream_duplicate');
    axios.defaults.headers.common = common as never;

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSSEStreamResponse([
          'data: {"id":"done","totalCount":1,"duplicatedCount":1,"data":{"duplicatedCount":1,"duplicatedRecordIds":["rec1"]}}',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    await duplicateSelectionStream('tbl0000000000000000', {
      ranges: [[0, 0]],
      type: 'rows',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Window-Id': 'win_stream_duplicate',
        }),
      })
    );
  });
});
