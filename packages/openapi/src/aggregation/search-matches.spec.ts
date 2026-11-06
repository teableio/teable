import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SortFunc } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { axios } from '../axios';
import { getShareViewSearchMatches } from '../share/view-search-matches';
import { getSearchMatches, type ISearchMatchesRo } from './get-search-matches';

// Exercise axios's real HTTP serialization against a receiver with a bounded URL,
// rather than inspecting the client call configuration before it is serialized.
describe('search-matches HTTP transport', () => {
  it.each([
    ['table', '/api/table/tbl0000000000000000/aggregation/search-matches', getSearchMatches],
    ['share', '/api/share/shr0000000000000000/view/search-matches', getShareViewSearchMatches],
  ] as const)(
    'sends a full %s highlight page as JSON without expanding the URL',
    async (kind, path, get) => {
      const selectedRecordIds = Array.from(
        { length: 1000 },
        (_, index) => `rec${String(index).padStart(16, '0')}`
      );
      const projection = Array.from(
        { length: 49 },
        (_, index) => `fld${String(index).padStart(16, '0')}`
      );
      const query: ISearchMatchesRo = {
        search: ['needle-late', projection.join(','), false],
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: projection[0], operator: 'contains', value: 'needle-late' }],
        },
        orderBy: [{ fieldId: projection[0], order: SortFunc.Asc }],
        groupBy: [{ fieldId: projection[1], order: SortFunc.Desc }],
        selectedRecordIds,
        projection,
        take: 1000,
        skip: 0,
        ...(kind === 'table' ? { viewId: 'viw0000000000000000', ignoreViewQuery: true } : {}),
      };
      let received:
        | { method?: string; url?: string; contentType?: string; body: string }
        | undefined;
      const server = createServer(async (request, response) => {
        // Model the gateway boundary that rejected the old selectedRecordIds URL.
        if ((request.url?.length ?? 0) > 4096) {
          response.writeHead(414).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        received = {
          method: request.method,
          url: request.url,
          contentType: request.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ matches: [], scannedRecordCount: 0, nextSkip: null, hasMore: false })
        );
      });
      const { baseURL, adapter, proxy } = axios.defaults;
      try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const { port } = server.address() as AddressInfo;
        axios.defaults.baseURL = `http://127.0.0.1:${port}/api`;
        axios.defaults.adapter = 'http';
        axios.defaults.proxy = false;

        const response = await get(
          kind === 'table' ? 'tbl0000000000000000' : 'shr0000000000000000',
          query
        );

        expect(response.status).toBe(200);
        expect(received?.method).toBe('POST');
        expect(received?.url).toBe(path);
        expect(received?.contentType).toContain('application/json');
        expect(JSON.parse(received!.body)).toEqual(query);
      } finally {
        axios.defaults.baseURL = baseURL;
        axios.defaults.adapter = adapter;
        axios.defaults.proxy = proxy;
        if (server.listening) {
          const closed = once(server, 'close');
          server.close();
          await closed;
        }
      }
    }
  );
});
