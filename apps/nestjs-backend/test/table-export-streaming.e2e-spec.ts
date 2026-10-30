import { once } from 'node:events';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, SortFunc } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import axios from 'axios';
import Papa from 'papaparse';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ExportOpenApiService,
  type ITableCsvExport,
} from '../src/features/export/open-api/export-open-api.service';
import { RecordOpenApiV2Service } from '../src/features/record/open-api/record-open-api-v2.service';
import { RecordService } from '../src/features/record/record.service';
import { createRecords, createTable, initApp, permanentDeleteTable } from './utils/init-app';

const rowCount = 2507;
const text = `synthetic, "quoted"\r\n下一行🙂 ${'x'.repeat(1024)}`;
const baseId = globalThis.testConfig.baseId;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// T8188 / Y3629: real HTTP sockets and database queries, no production/customer fixture data.
// Deterministic bounded-buffer and macrotask fairness coverage lives in the companion unit spec.
describe('CSV export streaming over HTTP', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let table: ITableFullVo;
  const requests = new Set<ClientRequest>();
  const responses = new Set<IncomingMessage>();
  const preparedExports: ITableCsvExport[] = [];

  function startExport() {
    const response = deferred<IncomingMessage>();
    const url = axios.getUri({
      url: `${appUrl}/api/export/${table.id}`,
      params: { orderBy: [{ fieldId: table.fields[0].id, order: SortFunc.Asc }] },
    });
    const request = httpRequest(url, { headers: { cookie, connection: 'close' } }, (incoming) => {
      responses.add(incoming);
      incoming.once('close', () => responses.delete(incoming));
      // Keep errors from a deliberate socket disconnect owned by this test.
      incoming.on('error', () => undefined);
      response.resolve(incoming);
    });
    requests.add(request);
    request.once('close', () => requests.delete(request));
    request.on('error', response.reject);
    request.end();
    return { request, response: response.promise };
  }

  beforeAll(async () => {
    ({ app, appUrl, cookie } = await initApp());
    table = await createTable(baseId, {
      name: 'CSV streaming regression',
      fields: [
        { name: 'Sequence', type: FieldType.SingleLineText },
        { name: 'Text', type: FieldType.LongText },
      ],
      records: [],
    });
    for (let skip = 0; skip < rowCount; skip += 200) {
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: Array.from({ length: Math.min(200, rowCount - skip) }, (_, index) => ({
          fields: { Sequence: String(skip + index).padStart(5, '0'), Text: text },
        })),
      });
    }
  }, 120000);

  afterEach(async () => {
    for (const response of responses) response.destroy();
    for (const request of requests) request.destroy();
    for (const prepared of preparedExports) prepared.stream.destroy();
    preparedExports.length = 0;
    vi.restoreAllMocks();
    await nextTurn();
  });

  afterAll(async () => {
    if (table) await permanentDeleteTable(baseId, table.id);
    await app?.close();
  });

  it('delivers every row and valid CSV bytes to a deliberately slow HTTP consumer', async () => {
    const { response } = startExport();
    const incoming = await response;
    expect(incoming.statusCode).toBe(200);
    expect(incoming.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(incoming.headers['content-disposition']).toBe(
      `attachment; filename=${encodeURIComponent(table.name)}.csv`
    );
    const chunks: Buffer[] = [];
    // Stream iteration reads in bounded chunks; yielding here gives the remote producer
    // repeated opportunities to outrun a client instead of buffering through axios.
    for await (const chunk of incoming) {
      chunks.push(Buffer.from(chunk));
      await nextTurn();
    }
    const bytes = Buffer.concat(chunks);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = Papa.parse<string[]>(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    expect(csv.errors).toEqual([]);
    expect(csv.data[0]).toEqual(['Sequence', 'Text']);
    expect(csv.data).toHaveLength(rowCount + 1);
    for (let index = 0; index < rowCount; index++) {
      expect(csv.data[index + 1]).toEqual([String(index).padStart(5, '0'), text]);
    }
  }, 30000);

  it('stops the real export after the client disconnects during an in-flight page query', async () => {
    const service = app.get(ExportOpenApiService);
    const prepare = service.prepareCsvExport.bind(service);
    let producerSettled = false;
    vi.spyOn(service, 'prepareCsvExport').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      preparedExports.push(prepared);
      const run = prepared.run;
      return {
        ...prepared,
        run: async () => {
          try {
            await run();
          } finally {
            producerSettled = true;
          }
        },
      };
    });
    const queryEntered = deferred();
    const releaseQuery = deferred();
    let pages = 0;
    // The barrier surrounds, but never substitutes for, the real record query.
    const records = (
      process.env.FORCE_V2_ALL !== 'false'
        ? app.get(RecordOpenApiV2Service)
        : app.get(RecordService)
    ) as Pick<RecordOpenApiV2Service, 'getRecords'>;
    const getRecords = records.getRecords.bind(records);
    const querySpy = vi.spyOn(records, 'getRecords');
    querySpy.mockImplementation(async (id, query) => {
      if (id === table.id) {
        pages++;
        if (pages === 2) {
          queryEntered.resolve();
          await releaseQuery.promise;
        }
      }
      return getRecords(id, query);
    });
    const { request, response } = startExport();
    try {
      const incoming = await response;
      expect(incoming.statusCode).toBe(200);
      incoming.resume();
      await queryEntered.promise;
      const closed = once(incoming, 'close');
      incoming.destroy();
      request.destroy();
      await closed;
      // Observe server-side cancellation before allowing the real query to return.
      await vi.waitFor(() => expect(preparedExports[0].stream.destroyed).toBe(true), {
        timeout: 2000,
        interval: 10,
      });
      releaseQuery.resolve();
      await vi.waitFor(() => expect(producerSettled).toBe(true), {
        timeout: 2000,
        interval: 10,
      });
      await nextTurn();
      expect(pages).toBe(2);
    } finally {
      releaseQuery.resolve();
    }
  }, 15000);

  it('stops before reading records when the client disconnects during export preparation', async () => {
    const service = app.get(ExportOpenApiService);
    const prepare = service.prepareCsvExport.bind(service);
    const preparedReady = deferred();
    const releasePreparation = deferred();
    const serverClosed = deferred();
    const exportCsv = service.exportCsvFromTable.bind(service);
    vi.spyOn(service, 'exportCsvFromTable').mockImplementation(async (response, ...args) => {
      response.once('close', serverClosed.resolve);
      return exportCsv(response, ...args);
    });
    vi.spyOn(service, 'prepareCsvExport').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      preparedExports.push(prepared);
      preparedReady.resolve();
      await releasePreparation.promise;
      return prepared;
    });
    const records = app.get(RecordOpenApiV2Service);
    const querySpy = vi.spyOn(records, 'getRecords');
    const { request, response } = startExport();
    response.catch(() => undefined);
    try {
      await preparedReady.promise;
      const closed = deferred();
      request.once('close', closed.resolve);
      request.destroy();
      await closed.promise;
      await serverClosed.promise;
      releasePreparation.resolve();
      await vi.waitFor(() => expect(preparedExports[0].stream.destroyed).toBe(true), {
        timeout: 2000,
        interval: 10,
      });
      expect(querySpy).not.toHaveBeenCalled();
    } finally {
      releasePreparation.resolve();
    }
  }, 15000);

  it('serves health checks while four real CSV clients pause their downloads', async () => {
    const service = app.get(ExportOpenApiService);
    const prepare = service.prepareCsvExport.bind(service);
    let activeExports = 0;
    vi.spyOn(service, 'prepareCsvExport').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      preparedExports.push(prepared);
      const run = prepared.run;
      return {
        ...prepared,
        run: async () => {
          activeExports++;
          try {
            await run();
          } finally {
            activeExports--;
          }
        },
      };
    });
    const clients = Array.from({ length: 4 }, () => startExport());
    const incoming = await Promise.all(clients.map((client) => client.response));
    incoming.forEach((response) => {
      expect(response.statusCode).toBe(200);
      response.pause();
    });
    await vi.waitFor(() => expect(activeExports).toBe(4), { timeout: 2000, interval: 10 });
    // Timeout is an acceptance bound, not an event-loop-delay microbenchmark.
    const health = await axios.get(`${appUrl}/health`, { timeout: 2000 });
    expect(health.status).toBe(200);
    expect(health.data.status).toBe('ok');
    expect(activeExports).toBe(4);
    expect(incoming.every((response) => !response.readableEnded)).toBe(true);
  }, 15000);
});
