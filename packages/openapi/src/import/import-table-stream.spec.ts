import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axios } from '../axios';
import { importTableFromFileStream } from './import-table-stream';
import { SUPPORTEDTYPE } from './types';

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

describe('importTableFromFileStream', () => {
  const originalCommon = axios.defaults.headers.common;

  afterEach(() => {
    vi.unstubAllGlobals();
    axios.defaults.headers.common = originalCommon;
  });

  it('reports real row progress and resolves the final done event', async () => {
    const onProgress = vi.fn();
    axios.defaults.headers.common = new AxiosHeaders();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"id":"progress","phase":"preparing","sheetIndex":0,"sheetCount":1,"batchIndex":-1,"totalCount":4,"processedCount":0,"importedCount":0,"sheetTotalCount":4,"sheetProcessedCount":0,"batchProcessedCount":0}\n',
            'data: {"id":"progress","phase":"importing","sheetIndex":0,"sheetCount":1,"batchIndex":0,"totalCount":4,"processedCount":2,"importedCount":2,"sheetTotalCount":4,"sheetProcessedCount":2,"batchProcessedCount":2}\n',
            'data: {"id":"progress","phase":"importing","sheetIndex":0,"sheetCount":1,"batchIndex":1,"totalCount":4,"processedCount":4,"importedCount":4,"sheetTotalCount":4,"sheetProcessedCount":4,"batchProcessedCount":2}\n',
            'data: {"id":"done","totalCount":4,"processedCount":4,"importedCount":4,"data":{"tables":[{"id":"tbl1"}],"tableId":"tbl1"}}',
          ])
        )
    );

    const result = await importTableFromFileStream(
      'bse0000000000000000',
      {
        attachmentUrl: 'https://example.com/file.xlsx',
        fileType: SUPPORTEDTYPE.EXCEL,
        worksheets: {},
        tz: 'UTC',
      },
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(result.done).toMatchObject({
      id: 'done',
      totalCount: 4,
      processedCount: 4,
      importedCount: 4,
      data: { tableId: 'tbl1' },
    });
    expect(result.errors).toEqual([]);
  });
});
