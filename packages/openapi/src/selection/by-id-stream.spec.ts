import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearSelectionByIdStream } from './clear-by-id-stream';
import { deleteSelectionByIdStream } from './delete-by-id-stream';
import { pasteSelectionByIdStream } from './paste-by-id-stream';

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

describe('selection by id stream wrappers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends clear-by-id stream requests with selection ids instead of ranges', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSSEStreamResponse([
          'data: {"id":"done","totalCount":2,"processedCount":2,"clearedCount":2,"data":{"clearedCount":2,"clearedRecordIds":["recA","recB"]}}',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await clearSelectionByIdStream('tbl0000000000000000', {
      selection: {
        recordIds: ['rec00000000000000'],
        fieldIds: ['fld00000000000000'],
      },
    });

    expect(result.done.clearedCount).toBe(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      selection: {
        recordIds: ['rec00000000000000'],
        fieldIds: ['fld00000000000000'],
      },
    });
  });

  it('sends paste-by-id stream requests with all-records exclusions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSSEStreamResponse([
          'data: {"id":"done","totalCount":3,"processedCount":3,"updatedCount":3,"createdCount":0,"data":{"updatedCount":3,"createdCount":0,"createdRecordIds":[]}}',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await pasteSelectionByIdStream('tbl0000000000000000', {
      selection: {
        allRecords: true,
        excludedRecordIds: ['rec00000000000001'],
        fieldIds: ['fld00000000000000'],
      },
      content: [['A']],
    });

    expect(result.done.updatedCount).toBe(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      selection: {
        allRecords: true,
        excludedRecordIds: ['rec00000000000001'],
        fieldIds: ['fld00000000000000'],
      },
      content: [['A']],
    });
  });

  it('returns deleted ids from delete-by-id stream done data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"id":"done","totalCount":1,"deletedCount":1,"data":{"deletedCount":1,"deletedRecordIds":["rec00000000000000"]}}',
          ])
        )
    );

    const result = await deleteSelectionByIdStream('tbl0000000000000000', {
      selection: {
        recordIds: ['rec00000000000000'],
      },
    });

    expect(result.data).toEqual({ ids: ['rec00000000000000'] });
    expect(result.errors).toEqual([]);
  });
});
