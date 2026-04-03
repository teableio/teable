import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axios } from '../axios';
import { deleteSelectionStream } from './delete-stream';

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

describe('deleteSelectionStream', () => {
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
            'data: {"id":"progress","phase":"preparing","batchIndex":-1,"totalCount":3,"deletedCount":0,"batchDeletedCount":0}\n',
            'data: {"id":"progress","phase":"deleting","batchIndex":0,"totalCount":3,"deletedCount":2,"batchDeletedCount":2}\n',
            'data: {"id":"done","totalCount":3,"deletedCount":3,"data":{"deletedCount":3,"deletedRecordIds":["rec1","rec2","rec3"]}}',
          ])
        )
    );

    const result = await deleteSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [[0, 2]],
        type: 'rows',
      },
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ ids: ['rec1', 'rec2', 'rec3'] });
    expect(result.done).toMatchObject({
      id: 'done',
      totalCount: 3,
      deletedCount: 3,
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
            'data: {"id":"progress","phase":"deleting","batchIndex":0,"totalCount":3,"deletedCount":1,"batchDeletedCount":1}\n',
            'data: {"id":"error","phase":"deleting","batchIndex":1,"totalCount":3,"deletedCount":1,"recordIds":["rec2"],"message":"delete failed","code":"unexpected"}\n',
            'data: {"id":"done","totalCount":3,"deletedCount":2,"data":{"deletedCount":2,"deletedRecordIds":["rec1","rec3"]}}',
          ])
        )
    );

    const result = await deleteSelectionStream(
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
        message: 'delete failed',
      })
    );
    expect(result.data).toEqual({ ids: ['rec1', 'rec3'] });
    expect(result.errors).toHaveLength(1);
  });

  it('reassembles data lines split across network chunks', async () => {
    const onProgress = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"id":"prog',
            'ress","phase":"deleting","batchIndex":0,"totalCount":2,"deletedCount":1,"batchDeletedCount":1}\n',
            'data: {"id":"done","totalCount":2,"deletedCount":2,"data":{"deletedCount":2,"deletedRecordIds":["rec1","rec2"]}}',
          ])
        )
    );

    const result = await deleteSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [[0, 1]],
        type: 'rows',
      },
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'progress',
        batchIndex: 0,
        deletedCount: 1,
      })
    );
    expect(result.data).toEqual({ ids: ['rec1', 'rec2'] });
  });

  it('throws when the stream ends with only error events', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"id":"error","phase":"preparing","batchIndex":-1,"totalCount":0,"deletedCount":0,"recordIds":[],"message":"delete failed","code":"unexpected"}',
          ])
        )
    );

    await expect(
      deleteSelectionStream('tbl0000000000000000', {
        ranges: [[0, 0]],
        type: 'rows',
      })
    ).rejects.toThrow('delete failed');
  });

  it('reuses the current undo/redo window id header for fetch-based streaming requests', async () => {
    const common = new AxiosHeaders();
    common.set('X-Window-Id', 'win_stream_same_window');
    axios.defaults.headers.common = common as never;

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSSEStreamResponse([
          'data: {"id":"done","totalCount":1,"deletedCount":1,"data":{"deletedCount":1,"deletedRecordIds":["rec1"]}}',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    await deleteSelectionStream('tbl0000000000000000', {
      ranges: [[0, 0]],
      type: 'rows',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Window-Id': 'win_stream_same_window',
        }),
      })
    );
  });
});
