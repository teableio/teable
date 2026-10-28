import { createServer } from 'node:http';

import { createHeadlessRuntime } from '@teable/v2-headless-runtime';
import { describe, expect, it } from 'vitest';

import { createHeadlessHttpApp } from './index';

const jsonActorHeaders = (actor: string): Headers => {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-teable-actor', actor);
  return headers;
};

describe('createHeadlessHttpApp', () => {
  it('serves the v2 contract and maps the actor header into the execution context', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);

    try {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      headers.set('x-teable-actor', 'usr_http');

      const created = await app.request('/bases/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'HTTP base' }),
      });
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as { ok: boolean };
      expect(createdBody.ok).toBe(true);

      const listed = await app.request('/bases/list?limit=10', { headers });
      expect(listed.status).toBe(200);
      const listedBody = (await listed.json()) as {
        ok: boolean;
        data?: { bases?: Array<{ name: string }> };
      };
      expect(listedBody.ok).toBe(true);
      expect(listedBody.data?.bases?.map((base) => base.name)).toContain('HTTP base');
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('bypasses identity for health and ready and rejects identity without fallback', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime, {
      resolveIdentity: async () => ({ status: 'rejected', statusCode: 401 }),
    });
    try {
      expect((await app.request('/health')).status).toBe(200);
      expect((await app.request('/ready')).status).toBe(200);
      const rejected = await app.request('/bases/list', {
        headers: new Headers([['x-teable-actor', 'usr_header_should_not_fallback']]),
      });
      expect(rejected.status).toBe(401);
      expect(await rejected.json()).toEqual({
        ok: false,
        error: { code: 'identity.rejected', message: 'Identity rejected', tags: ['forbidden'] },
      });
      const missingHeaders = new Headers([['x-teable-actor', 'usr_http']]);
      const missing = await app.request('/missing', { headers: missingHeaders });
      expect(missing.status).toBe(401);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('rejects identity resolver configuration conflicts', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    try {
      expect(() =>
        createHeadlessHttpApp(runtime, {
          resolveActorId: () => 'usr_actor',
          resolveIdentity: () => ({ status: 'accepted', actorId: 'usr_identity' }),
        })
      ).toThrow(/either resolveIdentity or resolveActorId/);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('imports inline CSV records through the HTTP contract', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    const headers = jsonActorHeaders('usr_import');

    try {
      const baseResponse = await app.request('/bases/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Import base' }),
      });
      const baseBody = (await baseResponse.json()) as { data: { base: { id: string } } };
      const tableResponse = await app.request('/tables/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          baseId: baseBody.data.base.id,
          name: 'Imported rows',
          fields: [
            { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
            { id: 'fldAmount', name: 'Amount', type: 'number' },
          ],
        }),
      });
      const tableBody = (await tableResponse.json()) as { data: { table: { id: string } } };

      const imported = await app.request('/tables/importRecords', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tableId: tableBody.data.table.id,
          fileType: 'csv',
          csvData: 'Name,Amount\nAlpha,12\nBeta,34\n',
          sourceColumnMap: { fldName: 0, fldAmount: 1 },
          options: { skipFirstNLines: 1 },
        }),
      });
      expect(imported.status).toBe(200);

      const listed = await app.request(
        `/tables/listRecords?tableId=${tableBody.data.table.id}&fieldKeyType=id`,
        { headers }
      );
      const listedBody = (await listed.json()) as {
        data: { records: Array<{ fields: Record<string, unknown> }> };
      };
      expect(listedBody.data.records.map(({ fields }) => fields)).toEqual([
        { fldName: 'Alpha', fldAmount: 12 },
        { fldName: 'Beta', fldAmount: 34 },
      ]);
      const background = await app.request('/runtime/flushBackground', {
        method: 'POST',
        headers,
      });
      expect((await background.json()) as unknown).toMatchObject({
        ok: true,
        data: {
          state: 'no_claimable_work',
          available: false,
          durablePending: 0,
          deadLetter: 0,
        },
      });
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('serializes concurrent PGlite HTTP commands through the public bus', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    const headers = jsonActorHeaders('usr_concurrent');

    try {
      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          app.request('/bases/create', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: `Concurrent ${index}` }),
          })
        )
      );
      expect(responses.map(({ status }) => status)).toEqual([201, 201, 201, 201]);

      const listed = await app.request('/bases/list?limit=10', { headers });
      const body = (await listed.json()) as { data: { bases: Array<{ name: string }> } };
      expect(
        body.data.bases.map(({ name }) => name).filter((name) => name.startsWith('Concurrent'))
      ).toHaveLength(4);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('keeps serving after a failed command on the serialized queue', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    const headers = jsonActorHeaders('usr_failure');
    try {
      const failed = await app.request('/tables/updateRecord', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tableId: `tbl${'0'.repeat(16)}`,
          recordId: `rec${'0'.repeat(16)}`,
          fieldKeyType: 'id',
          fields: { fldN: 1 },
        }),
      });
      expect(failed.status).toBeGreaterThanOrEqual(400);
      const listed = await app.request('/bases/list?limit=1', { headers });
      expect(listed.status).toBe(200);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('rejects loopback CSV URLs without reaching the source server', async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.end('Name\nShould not be fetched\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server address');

    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    const headers = jsonActorHeaders('usr_ssrf');
    try {
      const base = await app.request('/bases/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'SSRF base' }),
      });
      const baseBody = (await base.json()) as { data: { base: { id: string } } };
      const table = await app.request('/tables/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          baseId: baseBody.data.base.id,
          name: 'SSRF table',
          fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true }],
        }),
      });
      const tableBody = (await table.json()) as { data: { table: { id: string } } };
      const imported = await app.request('/tables/importRecords', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tableId: tableBody.data.table.id,
          fileType: 'csv',
          url: `http://127.0.0.1:${address.port}/source.csv`,
          sourceColumnMap: { fldName: 0 },
          options: { skipFirstNLines: 1 },
        }),
      });
      expect(imported.status).toBe(504);
      const body = (await imported.json()) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('csv.source_interrupted');
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('127.0.0.1');
      expect(serialized).not.toContain('source.csv');
      expect(serialized).not.toMatch(/ECONN|ENOTFOUND|fetch failed|transport/i);
      expect(hits).toBe(0);
    } finally {
      await runtime.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 30_000);

  it('rejects an empty actor with the contract error envelope', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);

    try {
      const headers = new Headers();
      headers.set('x-teable-actor', '');

      const rejected = await app.request('/bases/list', { headers });
      expect(rejected.status).toBe(400);
      expect(rejected.headers.get('content-type')).toContain('application/json');
      expect(await rejected.json()).toEqual({
        ok: false,
        error: {
          code: 'validation.actor.invalid',
          message: 'Invalid actor',
          tags: ['validation'],
        },
      });
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('drains the computed queue and realtime projections over HTTP', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);

    try {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      headers.set('x-teable-actor', 'usr_agent');

      const computed = await app.request('/runtime/flushComputed', {
        method: 'POST',
        headers,
      });
      expect(computed.status).toBe(200);
      expect(computed.headers.get('content-type')).toContain('application/json');
      expect(await computed.json()).toEqual({
        ok: true,
        data: {
          processed: 0,
          state: 'no_claimable_work',
          pending: 0,
          scheduled: 0,
          processing: 0,
          paused: 0,
          deadLetter: 0,
          nextRunAt: null,
          drained: true,
        },
      });

      const realtime = await app.request('/runtime/flushRealtime', {
        method: 'POST',
        headers,
      });
      expect(realtime.status).toBe(200);
      expect(await realtime.json()).toEqual({
        ok: true,
        data: { state: 'settled', failedTasks: 0 },
      });

      const background = await app.request('/runtime/flushBackground', {
        method: 'POST',
        headers,
      });
      expect(background.status).toBe(200);
      expect(await background.json()).toEqual({
        ok: true,
        data: {
          processed: 0,
          state: 'no_claimable_work',
          available: false,
          failedTasks: 0,
          durablePending: 0,
          scheduled: 0,
          processing: 0,
          deadLetter: 0,
          nextRunAt: null,
        },
      });

      const anonymous = new Headers();
      anonymous.set('x-teable-actor', '');
      const rejected = await app.request('/runtime/flushComputed', {
        method: 'POST',
        headers: anonymous,
      });
      expect(rejected.status).toBe(400);
      expect(rejected.headers.get('content-type')).toContain('application/json');
      expect(await rejected.json()).toEqual({
        ok: false,
        error: {
          code: 'validation.actor.invalid',
          message: 'Invalid actor',
          tags: ['validation'],
        },
      });
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('answers an unknown route with a JSON 404 instead of an identity rejection', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    try {
      const missing = await app.request('/missing', { headers: jsonActorHeaders('usr_http') });

      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain('application/json');
      expect(await missing.json()).toEqual({
        ok: false,
        error: { code: 'route.not_found', message: 'Route not found', tags: ['not_found'] },
      });
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('rejects a request without any identity header unless a default actor is configured', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    const compatible = createHeadlessHttpApp(runtime, { defaultActorId: 'system' });
    try {
      const rejected = await app.request('/bases/list');
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get('content-type')).toContain('application/json');
      expect(await rejected.json()).toEqual({
        ok: false,
        error: { code: 'identity.rejected', message: 'Identity rejected', tags: ['forbidden'] },
      });

      const local = await compatible.request('/bases/list');
      expect(local.status).toBe(200);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('answers resolver exceptions with a fixed internal error envelope', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime, {
      resolveActorId: () => {
        throw new Error('resolver exploded at /secret/path');
      },
    });
    try {
      const failed = await app.request('/bases/list', {
        headers: jsonActorHeaders('usr_http'),
      });
      const body = (await failed.json()) as {
        ok: boolean;
        error: { code: string; message: string; tags: ReadonlyArray<string> };
      };

      expect(failed.status).toBe(500);
      expect(body).toEqual({
        ok: false,
        error: {
          code: 'runtime.internal_error',
          message: 'Internal runtime error',
          tags: ['unexpected'],
        },
      });
      expect(JSON.stringify(body)).not.toContain('secret');
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('propagates the identity rejection status code', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime, {
      resolveIdentity: async () => ({ status: 'rejected', statusCode: 429 }),
    });
    try {
      const limited = await app.request('/bases/list', {
        headers: jsonActorHeaders('usr_http'),
      });

      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({
        ok: false,
        error: { code: 'identity.rejected', message: 'Identity rejected', tags: ['forbidden'] },
      });
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('reports not ready after the runtime closes while health stays live', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    await runtime.close();

    const ready = await app.request('/ready');
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      ok: false,
      error: { code: 'runtime.not_ready', message: 'Runtime is not ready', tags: ['unavailable'] },
    });

    expect((await app.request('/health')).status).toBe(200);
  }, 30_000);

  it('keeps the 404 contract after a successful request', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);
    try {
      const created = await app.request('/bases/create', {
        method: 'POST',
        headers: jsonActorHeaders('usr_http'),
        body: JSON.stringify({ name: 'HTTP base' }),
      });
      expect(created.status).toBe(201);

      const missing = await app.request('/still-missing', {
        headers: jsonActorHeaders('usr_http'),
      });
      expect(missing.status).toBe(404);
      const body = (await missing.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('route.not_found');
    } finally {
      await runtime.close();
    }
  }, 30_000);
});
