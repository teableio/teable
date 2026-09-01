/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T6629 — v2 computed propagation must converge when a wide foreign-table
 * cascade and a narrow host-record cascade write the same row's formula chain.
 *
 * Sanitized structure-equivalent of the perf-lab regression
 * `lookup/customer-update-user-update-order-4k-depth5`:
 * - Users table with 10 single-line text attribute fields.
 * - Orders table with a Status value field, a manyOne link to Users, one lookup
 *   per attribute, and a five-level formula chain whose seed concatenates
 *   Status with every lookup (so a Status-only update re-derives the chain).
 * - One User fans out to more orders than the computed lock planner's
 *   per-record limit, so the User cascade plans an exclusive table lock while
 *   the single-Order cascade plans a shared table covering lock plus a
 *   per-record key. Before T6637 those two namespaces never collided, both
 *   cascades wrote the target order's formula chain concurrently, and a stage
 *   that read a pre-cascade lookup snapshot could commit after the fresh write
 *   — permanently baking stale formula cells (16 cells checked, 5 formula
 *   cells stuck, never reconverging).
 *
 * Retained structural facts only (no customer ids/values):
 * - Cross-table lookup fanout wider than maxRecordLocks + single-row host update
 * - Status feeds the first formula level, so both cascades write the same chain
 * - Dual workers draining the outbox while update rounds keep landing
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
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

const updateRecord = async (
  harness: TestHarness,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
) => {
  const { status, rawBody } = await postJson(harness, '/tables/updateRecord', {
    tableId,
    recordId,
    fields,
  });
  expect(status, JSON.stringify(rawBody)).toBe(200);
  const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to update record: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.record;
};

const listRecords = async (
  harness: TestHarness,
  tableId: string
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> => {
  const params = new URLSearchParams({ tableId });
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

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => cellText(entry)).join(',');
  }
  if (typeof value === 'object' && value && 'title' in value) {
    return String((value as { title?: unknown }).title ?? '');
  }
  return String(value);
};

const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const ATTRIBUTE_COUNT = 10;
const ORDER_FANOUT = 80; // > default maxRecordLocks (50): user cascade plans exclusive table lock
const UPDATE_ROUNDS = 8;

const attributeName = (index: number) => `Attr${String(index).padStart(2, '0')}`;
const seedAttributeValue = (index: number) => `seed-attr-${index}`;
const roundAttributeValue = (round: number) => `user-attr-01-r${round}`;
const roundStatusValue = (round: number) => `status-r${round}`;

const expectedFormulaValues = (title: string, status: string, lookups: string[]) => {
  const seed = [status, ...lookups].join('|');
  const l2 = `${seed}|L2`;
  const l3 = `${l2}|L3`;
  const l4 = `${l3}|L4`;
  const card = `ORDER ${title}|${l4}|L5`;
  return { seed, l2, l3, l4, card };
};

describe('computed fanout overlap convergence (e2e) T6629', () => {
  it('converges the shared formula chain after overlapping wide/narrow cascades', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: {
          dispatchMode: 'external',
          // Force full async so user and order seeds become concurrent outbox tasks.
          syncPolicy: 'none',
        },
        outboxConfig: {
          maxConcurrentProcessingPerBase: 2,
          maxConcurrentProcessingPerSeedTable: 2,
        },
      },
    });

    const userTitleFieldId = createFieldId();
    const attributeFieldIds = Array.from({ length: ATTRIBUTE_COUNT }, () => createFieldId());
    const orderTitleFieldId = createFieldId();
    const orderStatusFieldId = createFieldId();
    const orderLinkFieldId = createFieldId();
    const lookupFieldIds = Array.from({ length: ATTRIBUTE_COUNT }, () => createFieldId());
    const seedFieldId = createFieldId();
    const l2FieldId = createFieldId();
    const l3FieldId = createFieldId();
    const l4FieldId = createFieldId();
    const cardFieldId = createFieldId();

    const usersTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Users',
      fields: [
        { type: 'singleLineText', id: userTitleFieldId, name: 'Title', isPrimary: true },
        ...attributeFieldIds.map((id, index) => ({
          type: 'singleLineText',
          id,
          name: attributeName(index + 1),
        })),
      ],
      views: [{ type: 'grid' }],
    });

    const ordersTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Orders',
      fields: [
        { type: 'singleLineText', id: orderTitleFieldId, name: 'Title', isPrimary: true },
        { type: 'singleLineText', id: orderStatusFieldId, name: 'Status' },
        {
          type: 'link',
          id: orderLinkFieldId,
          name: 'User',
          options: {
            relationship: 'manyOne',
            foreignTableId: usersTable.id,
            lookupFieldId: userTitleFieldId,
          },
        },
        ...lookupFieldIds.map((id, index) => ({
          type: 'lookup',
          id,
          name: `User${attributeName(index + 1)}`,
          options: {
            linkFieldId: orderLinkFieldId,
            foreignTableId: usersTable.id,
            lookupFieldId: attributeFieldIds[index],
          },
        })),
        {
          type: 'formula',
          id: seedFieldId,
          name: 'ProfileSeed',
          options: {
            expression: `CONCATENATE({${orderStatusFieldId}}${lookupFieldIds
              .map((id) => `, "|", {${id}}`)
              .join('')})`,
          },
        },
        {
          type: 'formula',
          id: l2FieldId,
          name: 'ProfileL2',
          options: { expression: `CONCATENATE({${seedFieldId}}, "|L2")` },
        },
        {
          type: 'formula',
          id: l3FieldId,
          name: 'ProfileL3',
          options: { expression: `CONCATENATE({${l2FieldId}}, "|L3")` },
        },
        {
          type: 'formula',
          id: l4FieldId,
          name: 'ProfileL4',
          options: { expression: `CONCATENATE({${l3FieldId}}, "|L4")` },
        },
        {
          type: 'formula',
          id: cardFieldId,
          name: 'OrderCard',
          options: {
            expression: `CONCATENATE("ORDER ", {${orderTitleFieldId}}, "|", {${l4FieldId}}, "|L5")`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const [user] = await createRecords(harness, usersTable.id, [
      {
        fields: {
          [userTitleFieldId]: 'User-001',
          ...Object.fromEntries(
            attributeFieldIds.map((id, index) => [id, seedAttributeValue(index + 1)])
          ),
        },
      },
    ]);

    const orders = await createRecords(
      harness,
      ordersTable.id,
      Array.from({ length: ORDER_FANOUT }, (_, index) => ({
        fields: {
          [orderTitleFieldId]: `Order ${index + 1}`,
          [orderStatusFieldId]: 'Open',
          [orderLinkFieldId]: { id: user.id },
        },
      }))
    );
    const targetOrder = orders[Math.floor(ORDER_FANOUT / 2)];
    const siblingOrders = [orders[0], orders[ORDER_FANOUT - 1]];

    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;

    const outboxCounts = async () => {
      const counts = await sql<{ status: string; cnt: number }>`
        SELECT status, count(*)::int as cnt
        FROM computed_update_outbox
        GROUP BY status
      `.execute(harness.testContainer.db);
      const byStatus = new Map(counts.rows.map((row) => [row.status, Number(row.cnt)]));
      return {
        pending: byStatus.get('pending') ?? 0,
        processing: byStatus.get('processing') ?? 0,
      };
    };

    const pumpBothWorkers = async () => {
      const [first, second] = await Promise.all([
        worker.runOnce({ workerId: 't6629-worker-a', limit: 4 }),
        worker.runOnce({ workerId: 't6629-worker-b', limit: 4 }),
      ]);
      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);
    };

    const waitForOutboxQuiesce = async (rounds = 200) => {
      for (let i = 0; i < rounds; i += 1) {
        const { pending, processing } = await outboxCounts();
        if (pending === 0 && processing === 0) {
          return;
        }
        // Lock-unavailable requeues schedule next_run_at slightly in the future;
        // sleep so the next claim can pick them up.
        if (pending > 0) {
          await sleep(100);
        }
        await pumpBothWorkers();
      }
      const leftover = await sql<{ status: string; cnt: number }>`
        SELECT status, count(*)::int as cnt
        FROM computed_update_outbox
        GROUP BY status
      `.execute(harness.testContainer.db);
      throw new Error(`Outbox did not quiesce: ${JSON.stringify(leftover.rows)}`);
    };

    await waitForOutboxQuiesce();

    const assertOrderConverged = async (
      orderId: string,
      title: string,
      status: string,
      round: number
    ) => {
      const records = await listRecords(harness, ordersTable.id);
      const row = records.find((record) => record.id === orderId);
      expect(row, `order ${title} must exist`).toBeDefined();
      const lookups = lookupFieldIds.map((id, index) => {
        const expected = index === 0 ? roundAttributeValue(round) : seedAttributeValue(index + 1);
        const actual = cellText(row?.fields[id]);
        expect(actual, `${title} lookup ${attributeName(index + 1)}`).toBe(expected);
        return expected;
      });
      const expected = expectedFormulaValues(title, status, lookups);
      expect(cellText(row?.fields[orderStatusFieldId]), `${title} status`).toBe(status);
      expect(cellText(row?.fields[seedFieldId]), `${title} profile_seed`).toBe(expected.seed);
      expect(cellText(row?.fields[l2FieldId]), `${title} profile_l2`).toBe(expected.l2);
      expect(cellText(row?.fields[l3FieldId]), `${title} profile_l3`).toBe(expected.l3);
      expect(cellText(row?.fields[l4FieldId]), `${title} profile_l4`).toBe(expected.l4);
      expect(cellText(row?.fields[cardFieldId]), `${title} order_card`).toBe(expected.card);
    };

    // Overlapping update rounds: each round enqueues a wide user cascade
    // (80 orders, batch-shard locks) and a narrow order cascade (1 record).
    // Workers drain continuously while later rounds keep landing.
    for (let round = 1; round <= UPDATE_ROUNDS; round += 1) {
      await updateRecord(harness, usersTable.id, user.id, {
        [attributeFieldIds[0]]: roundAttributeValue(round),
      });
      await updateRecord(harness, ordersTable.id, targetOrder.id, {
        [orderStatusFieldId]: roundStatusValue(round),
        // Resend the unchanged link id, mirroring the perf case payload.
        [orderLinkFieldId]: { id: user.id },
      });
      await pumpBothWorkers();
    }

    await waitForOutboxQuiesce();

    // Final state must reflect the last round everywhere, and every intermediate
    // round must have converged on its own values by the time it drained.
    await assertOrderConverged(
      targetOrder.id,
      cellText(targetOrder.fields[orderTitleFieldId]),
      roundStatusValue(UPDATE_ROUNDS),
      UPDATE_ROUNDS
    );
    for (const sibling of siblingOrders) {
      await assertOrderConverged(
        sibling.id,
        cellText(sibling.fields[orderTitleFieldId]),
        'Open',
        UPDATE_ROUNDS
      );
    }

    // Stability window: values must not regress after the outbox is empty.
    for (let i = 0; i < 5; i += 1) {
      await sleep(50);
      await assertOrderConverged(
        targetOrder.id,
        cellText(targetOrder.fields[orderTitleFieldId]),
        roundStatusValue(UPDATE_ROUNDS),
        UPDATE_ROUNDS
      );
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 300_000);
});
