/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { getRandomString } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { afterEach, expect, it } from 'vitest';

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
  outboxConfig: Record<string, number> = { stageMaxSteps: 1 },
  fieldBackfillConfig?: { mode: 'async' }
): Promise<TestHarness> => {
  const testContainer = await createE2eTestContainer({
    dbMode: 'pglite',
    computedUpdate: {
      hybridConfig: {
        dispatchMode: 'external',
        // Compute the source table synchronously; downstream tables use the worker.
        syncPolicy: 'seedTableOnly',
      },
      outboxConfig,
      fieldBackfillConfig,
    },
  });

  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => testContainer.container,
    })
  );

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address() as AddressInfo;
  const harness: TestHarness = {
    testContainer,
    baseId: testContainer.baseId.toString(),
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
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

const createTable = async (harness: TestHarness, payload: Record<string, unknown>) => {
  const response = await fetch(`${harness.baseUrl}/tables/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(201);
  const parsed = createTableOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.table;
};

const createRecord = async (
  harness: TestHarness,
  tableId: string,
  fields: Record<string, unknown>
) => {
  const response = await fetch(`${harness.baseUrl}/tables/createRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, fields }),
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(201);
  const parsed = createRecordOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to create record: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.record;
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

const drain = async (harness: TestHarness) => {
  let tasks = 0;
  for (let attempt = 0; attempt < 120; attempt++) {
    const processed = await harness.testContainer.processOutboxOnce();
    tasks += processed;
    const pending = await sql<{ count: number }>`SELECT COUNT(*)::integer AS count
      FROM computed_update_outbox WHERE status IN ('pending', 'processing')`.execute(
      harness.testContainer.db
    );
    if (pending.rows[0].count === 0) return tasks;
    if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Frontier worker did not quiesce');
};

const versions = async (harness: TestHarness, tableId: string) => {
  const result = await sql<{ __id: string; __version: number }>`SELECT __id, __version
    FROM ${sql.table(`${harness.baseId}.${tableId}`)}`.execute(harness.testContainer.db);
  return new Map(result.rows.map((row) => [row.__id, row.__version]));
};

const numericCell = (value: unknown): number => {
  const parsed = typeof value === 'string' && value.startsWith('[') ? JSON.parse(value) : value;
  return Number(Array.isArray(parsed) ? parsed[0] : parsed);
};

it('preserves changes computed in a synchronous prefix before asynchronous frontier pruning', async () => {
  const harness = await createHarness({ stageMaxSteps: 1, stageSmallRunComplexityThreshold: 0 });
  const name = createFieldId();
  const amount = createFieldId();
  const rounded = createFieldId();
  const link = createFieldId();
  const lookup = createFieldId();
  const total = createFieldId();
  const source = await createTable(harness, {
    baseId: harness.baseId,
    name: 'Hybrid frontier sources',
    fields: [
      { id: name, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: amount, name: 'Amount', type: 'number' },
      {
        id: rounded,
        name: 'Rounded',
        type: 'formula',
        options: { expression: `ROUND({${amount}}, 0)` },
      },
    ],
    views: [{ type: 'grid' }],
  });
  const target = await createTable(harness, {
    baseId: harness.baseId,
    name: 'Hybrid frontier targets',
    fields: [
      { name: 'Title', type: 'singleLineText', isPrimary: true },
      {
        id: link,
        name: 'Source',
        type: 'link',
        options: { relationship: 'manyOne', foreignTableId: source.id, lookupFieldId: name },
      },
      {
        id: lookup,
        name: 'Rounded lookup',
        type: 'lookup',
        options: { linkFieldId: link, foreignTableId: source.id, lookupFieldId: rounded },
      },
      {
        id: total,
        name: 'Total',
        type: 'formula',
        options: { expression: `SUM({${lookup}}) * 10` },
      },
    ],
    views: [{ type: 'grid' }],
  });
  const rootIds: string[] = [];
  const rootByChild = new Map<string, number>();
  for (let root = 0; root < 2; root++) {
    const row = await createRecord(harness, source.id, {
      [name]: `Root ${root}`,
      [amount]: root === 0 ? 1.8 : 1.1,
    });
    rootIds.push(row.id);
    for (let index = 0; index < 3; index++) {
      const child = await createRecord(harness, target.id, {
        Title: `${root}/${index}`,
        [link]: { id: row.id },
      });
      rootByChild.set(child.id, root);
    }
  }
  await drain(harness);
  const before = await versions(harness, target.id);
  const initial = await listRecords(harness, target.id);
  expect(initial).toHaveLength(6);
  for (const row of initial)
    expect(row.fields[total]).toBe(rootByChild.get(row.id) === 0 ? 20 : 10);

  // Multi-record updateRecords deliberately uses plan-free async seeds. Two
  // single-record commands exercise the production hybrid synchronous prefix.
  for (const recordId of rootIds) {
    const response = await fetch(`${harness.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: source.id, recordId, fields: { [amount]: 1.2 } }),
    });
    expect(response.status, await response.text()).toBe(200);
  }

  // Prove this exercised the hybrid boundary: ROUND is already persisted, while
  // the changed root's child formula still holds its old result before draining.
  const syncRoots = await listRecords(harness, source.id);
  expect(syncRoots).toHaveLength(2);
  for (const root of syncRoots) expect(root.fields[rounded]).toBe(1);
  const queued = await sql<{ count: number }>`SELECT COUNT(*)::integer AS count
    FROM computed_update_outbox WHERE status IN ('pending','processing')`.execute(
    harness.testContainer.db
  );
  expect(queued.rows[0].count).toBeGreaterThan(0);
  const waiting = await listRecords(harness, target.id);
  for (const row of waiting)
    expect(row.fields[total]).toBe(rootByChild.get(row.id) === 0 ? 20 : 10);

  expect(await drain(harness)).toBeGreaterThan(0);
  const after = await versions(harness, target.id);
  const final = await listRecords(harness, target.id);
  expect(final).toHaveLength(6);
  for (const row of final) {
    expect(numericCell(row.fields[lookup])).toBe(1);
    expect(row.fields[total]).toBe(10);
    if (rootByChild.get(row.id) === 0) expect(after.get(row.id)).toBe(before.get(row.id)! + 2);
    else expect(after.get(row.id)).toBe(before.get(row.id));
  }
  const remaining = await sql<{ pending: number; dead: number }>`SELECT
    (SELECT COUNT(*)::integer FROM computed_update_outbox) AS pending,
    (SELECT COUNT(*)::integer FROM computed_update_dead_letter) AS dead`.execute(
    harness.testContainer.db
  );
  expect(remaining.rows).toEqual([{ pending: 0, dead: 0 }]);
}, 120_000);
