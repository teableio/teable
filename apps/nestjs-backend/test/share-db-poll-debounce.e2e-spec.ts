import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, IdPrefix, ViewType } from '@teable/core';
import { createRecords as apiCreateRecords } from '@teable/openapi';
import type { Connection, Query } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { ShareDbAdapter } from '../src/share-db/share-db.adapter';
import { ShareDbService } from '../src/share-db/share-db.service';
import { initApp, createTable, permanentDeleteTable } from './utils/init-app';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForQueryReady = (query: Query<unknown>, timeout = 5000): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (query.ready) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('Query ready timeout')), timeout);
    query.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

describe('ShareDB query pollDebounce (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let cookie: string;
  let port: string;
  let shareDbService: ShareDbService;
  let adapter: ShareDbAdapter;
  let originalPollDebounce: number;
  const baseId = globalThis.testConfig.baseId;

  const burstSize = 8;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);
    adapter = app.get(ShareDbAdapter);
    originalPollDebounce = adapter.pollDebounce;

    const table = await createTable(baseId, {
      name: 'poll-debounce-test-table',
      views: [{ type: ViewType.Grid, name: 'default-view' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    adapter.pollDebounce = originalPollDebounce;
    await permanentDeleteTable(baseId, tableId);
    await app.close();
  });

  it('exposes pollDebounce on the backend db read by QueryEmitter', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((shareDbService as any).db).toBe(adapter);
    expect(typeof adapter.pollDebounce).toBe('number');
    expect(adapter.pollDebounce).toBeGreaterThan(0);
  });

  // Subscribes a fresh query (QueryEmitter snapshots pollDebounce at subscribe
  // time), fires burstSize sequential record creations, then counts how many
  // times the adapter polled this collection.
  const countPollsForBurst = async (pollDebounceMs: number): Promise<number> => {
    adapter.pollDebounce = pollDebounceMs;
    const connection: Connection = shareDbService.connect(undefined, {
      url: `ws://localhost:${port}/socket`,
      headers: { cookie },
    });
    const collection = `${IdPrefix.Record}_${tableId}`;
    const query = connection.createSubscribeQuery(collection, {});

    try {
      await waitForQueryReady(query);
      const spy = vi.spyOn(adapter, 'queryPoll');

      for (let i = 0; i < burstSize; i++) {
        await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: {} }],
        });
      }
      // Wait past the debounce window so the trailing poll lands
      await sleep(pollDebounceMs * 1.5 + 1500);

      const polls = spy.mock.calls.filter(([c]) => c === collection).length;
      spy.mockRestore();
      return polls;
    } finally {
      query.destroy();
      connection.close();
    }
  };

  it('coalesces an op burst into fewer polls when pollDebounce is on', async () => {
    const pollsWithoutDebounce = await countPollsForBurst(0);
    const pollsWithDebounce = await countPollsForBurst(3000);

    // Without debounce each create op polls (minus natural in-flight coalescing)
    expect(pollsWithoutDebounce).toBeGreaterThanOrEqual(4);
    // With debounce: one leading poll + coalesced trailing polls
    expect(pollsWithDebounce).toBeLessThanOrEqual(3);
    expect(pollsWithDebounce).toBeLessThan(pollsWithoutDebounce);
  }, 60000);
});
