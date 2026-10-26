import { createHeadlessRuntime } from '@teable/v2-headless-runtime';
import { describe, expect, it } from 'vitest';

import { createHeadlessHttpApp } from './index';

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
      expect(await computed.json()).toEqual({ ok: true, data: { processed: 0 } });

      const realtime = await app.request('/runtime/flushRealtime', {
        method: 'POST',
        headers,
      });
      expect(realtime.status).toBe(200);
      expect(await realtime.json()).toEqual({ ok: true, data: {} });

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
});
