import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axios } from '../axios';
import { pasteSelectionStream } from './paste-stream';

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

describe('pasteSelectionStream', () => {
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
            'data: {"id":"progress","phase":"preparing","batchIndex":-1,"totalCount":3,"processedCount":0,"updatedCount":0,"createdCount":0,"batchProcessedCount":0}\n',
            'data: {"id":"progress","phase":"pasting","batchIndex":0,"totalCount":3,"processedCount":2,"updatedCount":1,"createdCount":1,"batchProcessedCount":2}\n',
            'data: {"id":"done","totalCount":3,"processedCount":3,"updatedCount":1,"createdCount":2,"data":{"updatedCount":1,"createdCount":2,"createdRecordIds":["rec1","rec2"]}}',
          ])
        )
    );

    const result = await pasteSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['A'], ['B'], ['C']],
      },
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(result.data).toBeNull();
    expect(result.done).toMatchObject({
      id: 'done',
      totalCount: 3,
      processedCount: 3,
      createdCount: 2,
      updatedCount: 1,
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
            'data: {"id":"progress","phase":"pasting","batchIndex":0,"totalCount":3,"processedCount":1,"updatedCount":1,"createdCount":0,"batchProcessedCount":1}\n',
            'data: {"id":"error","phase":"pasting","batchIndex":1,"totalCount":3,"processedCount":1,"updatedCount":1,"createdCount":0,"recordIds":["rec2"],"message":"paste failed","code":"unexpected"}\n',
            'data: {"id":"done","totalCount":3,"processedCount":2,"updatedCount":1,"createdCount":1,"data":{"updatedCount":1,"createdCount":1,"createdRecordIds":["rec3"]}}',
          ])
        )
    );

    const result = await pasteSelectionStream(
      'tbl0000000000000000',
      {
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['A'], ['B'], ['C']],
      },
      { onError }
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'error',
        batchIndex: 1,
        message: 'paste failed',
        recordIds: ['rec2'],
      })
    );
    expect(result.done.data.createdRecordIds).toEqual(['rec3']);
    expect(result.errors).toHaveLength(1);
  });

  it('uses patch defaults and keeps the current undo/redo window id header', async () => {
    const common = new AxiosHeaders();
    common.set('X-Window-Id', 'win_stream_paste');
    axios.defaults.headers.common = common as never;
    axios.defaults.headers.patch = {
      'X-Patch': 'patch-default',
    } as never;

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSSEStreamResponse([
          'data: {"id":"done","totalCount":1,"processedCount":1,"updatedCount":0,"createdCount":1,"data":{"updatedCount":0,"createdCount":1,"createdRecordIds":["rec1"]}}',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    await pasteSelectionStream('tbl0000000000000000', {
      ranges: [[0, 0]],
      content: [['A']],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'X-Window-Id': 'win_stream_paste',
          'X-Patch': 'patch-default',
          'Content-Type': 'application/json',
        }),
      })
    );
  });
});
