/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T8079 — a computed table-exclusive cascade must not starve behind an
 * uninterrupted stream of shared covering locks.
 *
 * Sanitized, structure-equivalent shape of the loadtest finding:
 * - One table with a number column and a formula over it
 * - 100 records created in one call: the seed set exceeds maxRecordLocks (50),
 *   so its computed plan needs the exclusive `v2:computed:<tableId>` advisory key
 * - A request-path session holds the shared covering key of the same table for
 *   the whole creation, which is exactly what a small computed update does for
 *   the lifetime of its transaction
 * - The inline attempt therefore misses the exclusive key and leaves an outbox
 *   seed task, whose worker attempt faces the same shared holder
 *
 * Retained structural facts only (no customer ids, names or values):
 * - exclusive table key requested while a shared covering key stays held
 * - 100 seeds > maxRecordLocks so the exclusive fallback (not per-record keys) applies
 * - outbox task age drives the lock mode of the next worker attempt
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { getRandomString } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
} from '../../adapter-table-repository-postgres/src';

import { createE2eTestContainer } from './shared/createE2eTestContainer';

type TestHarness = {
  testContainer: IV2NodeTestContainer;
  baseId: string;
  baseUrl: string;
  close(): Promise<void>;
};

const activeHarnesses = new Set<TestHarness>();

const createFieldId = () => `fld${getRandomString(16)}`;

const SEED_ROWS = 100;

const createHarness = async (
  options: Parameters<typeof createE2eTestContainer>[0] = {}
): Promise<TestHarness> => {
  const testContainer = await createE2eTestContainer({
    dbMode: 'postgres',
    ...options,
  });

  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => testContainer.container,
    })
  );

  const {
    promise: serverReady,
    resolve: signalServerReady,
    reject: failServerReady,
  } = Promise.withResolvers<Server>();
  const listeningServer = app.listen(0, '127.0.0.1', () => signalServerReady(listeningServer));
  listeningServer.once('error', failServerReady);
  const server = await serverReady;
  server.keepAliveTimeout = 0;

  const address = server.address() as AddressInfo;
  const harness: TestHarness = {
    testContainer,
    baseId: testContainer.baseId.toString(),
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      const { promise: closed, resolve, reject } = Promise.withResolvers<void>();
      server.close((error) => (error ? reject(error) : resolve()));
      await closed;
      await testContainer.dispose();
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
};

afterEach(async () => {
  while (activeHarnesses.size > 0) {
    const harnesses = [...activeHarnesses];
    const harness = harnesses[harnesses.length - 1];
    if (!harness) break;
    await harness.close();
  }
});

const postJson = async (harness: TestHarness, path: string, payload: Record<string, unknown>) => {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const rawBody = await response.json();
  return { status: response.status, rawBody };
};

const createTable = async (harness: TestHarness, payload: Record<string, unknown>) => {
  const { status, rawBody } = await postJson(harness, '/tables/create', payload);
  expect(status, JSON.stringify(rawBody)).toBe(201);
  const parsed = createTableOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.table;
};

const createRecords = async (
  harness: TestHarness,
  tableId: string,
  records: Array<{ fields: Record<string, unknown> }>
) => {
  const { status, rawBody } = await postJson(harness, '/tables/createRecords', {
    tableId,
    records,
  });
  expect(status, JSON.stringify(rawBody)).toBe(201);
  const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to create records: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.records;
};

const listRecords = async (
  harness: TestHarness,
  tableId: string
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> => {
  const params = new URLSearchParams({ tableId, limit: '1000' });
  const response = await fetch(`${harness.baseUrl}/tables/listRecords?${params.toString()}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(200);
  const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to list records: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.records;
};

const delay = async (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
};

const tableLockKey = (tableId: string) => `v2:computed:${tableId}`;

const lockBigInt = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const holdSharedTableLock = async (harness: TestHarness, tableId: string) => {
  const acquired = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const held = harness.testContainer.db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock_shared(${lockBigInt(tableLockKey(tableId))})`.execute(
      trx
    );
    acquired.resolve();
    await release.promise;
  });
  await acquired.promise;
  return async () => {
    release.resolve();
    await held;
  };
};

const waitingAdvisoryLockCount = async (harness: TestHarness): Promise<number> => {
  const result = await sql<{ cnt: number }>`
    SELECT count(*)::int as cnt
    FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted
  `.execute(harness.testContainer.db);
  return Number(result.rows[0]?.cnt ?? 0);
};

const trySharedTableLock = async (harness: TestHarness, tableId: string): Promise<boolean> =>
  harness.testContainer.db.transaction().execute(async (trx) => {
    const result = await sql<{ locked: boolean }>`
      SELECT pg_try_advisory_xact_lock_shared(${lockBigInt(tableLockKey(tableId))}) as locked
    `.execute(trx);
    return result.rows[0]?.locked === true;
  });

const outboxState = async (harness: TestHarness) => {
  const result = await sql<{ status: string; cnt: number; attempts: number | null }>`
    SELECT status, count(*)::int as cnt, max(attempts)::int as attempts
    FROM computed_update_outbox
    GROUP BY status
  `.execute(harness.testContainer.db);
  const byStatus = new Map(result.rows.map((row) => [row.status, row]));
  return {
    pending: Number(byStatus.get('pending')?.cnt ?? 0),
    processing: Number(byStatus.get('processing')?.cnt ?? 0),
    maxAttempts: Number(byStatus.get('pending')?.attempts ?? 0),
  };
};

const deadLetterCount = async (harness: TestHarness): Promise<number> => {
  const result = await sql<{ cnt: number }>`
    SELECT count(*)::int as cnt FROM computed_update_dead_letter
  `.execute(harness.testContainer.db);
  return Number(result.rows[0]?.cnt ?? 0);
};

const prepareLedger = async (harness: TestHarness) => {
  const nameFieldId = createFieldId();
  const amountFieldId = createFieldId();
  const doubledFieldId = createFieldId();

  const table = await createTable(harness, {
    baseId: harness.baseId,
    name: 'T8079 Ledger',
    fields: [
      { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
      { type: 'number', id: amountFieldId, name: 'Amount' },
      {
        type: 'formula',
        id: doubledFieldId,
        name: 'Doubled',
        options: { expression: `{${amountFieldId}} * 2` },
      },
    ],
    views: [{ type: 'grid' }],
  });

  return { tableId: table.id, nameFieldId, amountFieldId, doubledFieldId };
};

const seedRows = Array.from({ length: SEED_ROWS }, (_, index) => index + 1);

const insertSeeds = async (
  harness: TestHarness,
  tableId: string,
  nameFieldId: string,
  amountFieldId: string
) =>
  createRecords(
    harness,
    tableId,
    seedRows.map((amount) => ({
      fields: { [nameFieldId]: `row-${amount}`, [amountFieldId]: amount },
    }))
  );

const expectConverged = async (harness: TestHarness, tableId: string, doubledFieldId: string) => {
  const rows = await listRecords(harness, tableId);
  expect(rows).toHaveLength(SEED_ROWS);
  const doubled = rows
    .map((row) => Number(row.fields[doubledFieldId]))
    .sort((left, right) => left - right);
  expect(doubled).toEqual(seedRows.map((amount) => amount * 2).sort((left, right) => left - right));
};

const drainOutbox = async (harness: TestHarness, worker: ComputedUpdateWorker) => {
  for (let round = 0; round < 20; round += 1) {
    const state = await outboxState(harness);
    if (state.pending === 0 && state.processing === 0) return;
    await worker.runOnce({ workerId: 't8079-drain', limit: 4 });
  }
};

describe('[C14][S19] computed lock starvation escalation (e2e) T8079', () => {
  it('queues a starving table-exclusive cascade instead of requeueing until the outbox ages out', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'seedTableOnly' },
        outboxConfig: {
          maxConcurrentProcessingPerBase: 2,
          maxConcurrentProcessingPerSeedTable: 2,
          // A retry inside the test window cannot explain convergence.
          lockUnavailableRetryDelayMs: 60_000,
          lockStarvationEscalationAgeMs: 100,
          // Wide enough that the queued waiter is observable on a loaded runner;
          // the holder is released as soon as the assertions below pass.
          lockStarvationEscalationWaitMs: 10_000,
        },
      },
    });

    const schema = await prepareLedger(harness);
    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;
    await drainOutbox(harness, worker);
    expect(await outboxState(harness)).toEqual({ pending: 0, processing: 0, maxAttempts: 0 });

    const releaseHolder = await holdSharedTableLock(harness, schema.tableId);
    let runOnce: Promise<unknown> | undefined;
    try {
      await insertSeeds(harness, schema.tableId, schema.nameFieldId, schema.amountFieldId);

      const afterInsert = await outboxState(harness);
      expect(
        afterInsert.pending,
        'a 100-seed cascade must be parked in the outbox when the exclusive table key is held'
      ).toBeGreaterThan(0);

      // The task is now older than the escalation age, so its next attempt asks
      // for the key in the lock queue instead of taking a try-lock.
      await delay(200);
      runOnce = worker.runOnce({ workerId: 't8079-pump', limit: 4 });

      let waiting = 0;
      for (let attempt = 0; attempt < 200 && waiting === 0; attempt += 1) {
        waiting = await waitingAdvisoryLockCount(harness);
        if (waiting === 0) await delay(50);
      }
      expect(
        waiting,
        'the escalated worker attempt must be queued on the computed advisory key'
      ).toBeGreaterThan(0);

      // PostgreSQL grants a queued exclusive waiter ahead of later shared
      // requests: a new request-path shared covering lock must not jump ahead.
      expect(
        await trySharedTableLock(harness, schema.tableId),
        'a new shared covering lock must not overtake the queued exclusive waiter'
      ).toBe(false);
    } finally {
      await releaseHolder();
    }

    const processed = await runOnce;
    expect(processed).toBeDefined();

    await expectConverged(harness, schema.tableId, schema.doubledFieldId);
    expect(await outboxState(harness)).toEqual({ pending: 0, processing: 0, maxAttempts: 0 });
    expect(await deadLetterCount(harness)).toBe(0);
  }, 180_000);

  it('bounds the escalated wait and requeues without consuming a retry attempt', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'seedTableOnly' },
        outboxConfig: {
          maxConcurrentProcessingPerBase: 2,
          maxConcurrentProcessingPerSeedTable: 2,
          lockUnavailableRetryDelayMs: 50,
          lockStarvationEscalationAgeMs: 100,
          lockStarvationEscalationWaitMs: 250,
        },
      },
    });

    const schema = await prepareLedger(harness);
    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;
    await drainOutbox(harness, worker);

    const releaseHolder = await holdSharedTableLock(harness, schema.tableId);
    try {
      await insertSeeds(harness, schema.tableId, schema.nameFieldId, schema.amountFieldId);
      await delay(200);
      const startedAt = Date.now();
      const settled = await worker.runOnce({ workerId: 't8079-bounded', limit: 4 });
      const elapsedMs = Date.now() - startedAt;
      expect(settled.isOk()).toBe(true);
      // A try-lock miss returns immediately; a waiting acquire occupies the
      // configured 250 ms bound. The upper bound is generous for runner load but
      // still rejects the 5 s code default.
      expect(
        elapsedMs,
        'the escalated acquire must occupy the wait window, not fail immediately'
      ).toBeGreaterThanOrEqual(200);
      expect(
        elapsedMs,
        'the escalated acquire must give up at the configured lock_timeout, not a longer default'
      ).toBeLessThan(4_000);

      const parked = await outboxState(harness);
      expect(parked.pending, 'the lock miss must stay pending, not dead-letter').toBeGreaterThan(0);
      expect(parked.maxAttempts, 'a lock miss must not consume a retry attempt').toBe(0);
      expect(await deadLetterCount(harness)).toBe(0);
    } finally {
      await releaseHolder();
    }

    await delay(100);
    const retried = await worker.runOnce({ workerId: 't8079-bounded', limit: 4 });
    expect(retried.isOk()).toBe(true);
    await expectConverged(harness, schema.tableId, schema.doubledFieldId);
    expect(await outboxState(harness)).toEqual({ pending: 0, processing: 0, maxAttempts: 0 });
  }, 180_000);

  it('treats a statement timeout during the lock wait as lock contention, not a failed attempt', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'seedTableOnly' },
        outboxConfig: {
          maxConcurrentProcessingPerBase: 2,
          maxConcurrentProcessingPerSeedTable: 2,
          lockUnavailableRetryDelayMs: 50,
          // The task budget fires before the lock bound, which must not spend a
          // retry attempt on ordinary contention.
          taskStatementTimeoutMs: 150,
          lockStarvationEscalationAgeMs: 100,
          lockStarvationEscalationWaitMs: 5_000,
        },
      },
    });

    const schema = await prepareLedger(harness);
    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;
    await drainOutbox(harness, worker);

    const releaseHolder = await holdSharedTableLock(harness, schema.tableId);
    try {
      await insertSeeds(harness, schema.tableId, schema.nameFieldId, schema.amountFieldId);
      await delay(200);
      const bounded = await worker.runOnce({ workerId: 't8079-statement-timeout', limit: 4 });
      expect(bounded.isOk()).toBe(true);

      const parked = await outboxState(harness);
      expect(parked.pending).toBeGreaterThan(0);
      expect(
        parked.maxAttempts,
        'a lock-phase statement timeout must not consume a retry attempt'
      ).toBe(0);
      expect(await deadLetterCount(harness)).toBe(0);
    } finally {
      await releaseHolder();
    }

    await delay(100);
    const retried = await worker.runOnce({ workerId: 't8079-statement-timeout', limit: 4 });
    expect(retried.isOk()).toBe(true);
    await expectConverged(harness, schema.tableId, schema.doubledFieldId);
    expect(await outboxState(harness)).toEqual({ pending: 0, processing: 0, maxAttempts: 0 });
  }, 180_000);
});
