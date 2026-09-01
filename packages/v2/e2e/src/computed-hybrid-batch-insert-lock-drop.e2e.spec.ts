/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7018 — hybrid sequential batch inserts must not leave lookup/formula cells empty.
 *
 * Sanitized structure-equivalent of the circular-storm / hunter case:
 * - Two tables mutually two-way link
 * - Each table lookups the other, then stacks a formula on that lookup
 * - Production hybrid (seedTableOnly + external dispatch)
 * - Sequential createRecords of 400 rows in 4 batches of 100, with link cells filled
 * - A polling worker runs during the inserts so outbox dispatch contends with
 *   the next batch's inline compute for `v2:computed:{tableId}`
 *
 * 100-row batches exceed maxRecordLocks (50) and take exclusive table locks.
 *
 * Retained structural facts only (no customer ids/values):
 * - Reciprocal link + lookup + formula-on-lookup
 * - Sequential 100-row insert batches with links populated
 * - Hybrid inline compute overlapping an outbox worker
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
} from '../../adapter-table-repository-postgres/src';
import {
  createFieldOkResponseSchema,
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { getRandomString } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { createE2eTestContainer } from './shared/createE2eTestContainer';

type TestHarness = {
  testContainer: IV2NodeTestContainer;
  baseId: string;
  baseUrl: string;
  close(): Promise<void>;
};

const activeHarnesses = new Set<TestHarness>();

const createFieldId = () => `fld${getRandomString(16)}`;

const BATCH_SIZE = 100;
const BATCH_COUNT = 4;
const TOTAL_ROWS = BATCH_SIZE * BATCH_COUNT;

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

const createField = async (
  harness: TestHarness,
  tableId: string,
  field: Record<string, unknown>
) => {
  const { status, rawBody } = await postJson(harness, '/tables/createField', {
    baseId: harness.baseId,
    tableId,
    field,
  });
  expect([200, 201], JSON.stringify(rawBody)).toContain(status);
  const parsed = createFieldOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to create field: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.table;
};

const getTableById = async (harness: TestHarness, tableId: string) => {
  const response = await fetch(
    `${harness.baseUrl}/tables/get?baseId=${harness.baseId}&tableId=${tableId}`
  );
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(200);
  const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to get table: ${JSON.stringify(rawBody)}`);
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

const listRecordsWithoutDrain = async (
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

const parseArrayCell = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => cellText(entry)).join(',');
  }
  if (typeof value === 'object' && value && 'title' in value) {
    return String(value.title ?? '');
  }
  return String(value);
};

const waitForOutboxQuiesce = async (harness: TestHarness, rounds = 120) => {
  for (let i = 0; i < rounds; i += 1) {
    const counts = await sql<{ status: string; cnt: number }>`
      SELECT status, count(*)::int as cnt
      FROM computed_update_outbox
      GROUP BY status
    `.execute(harness.testContainer.db);

    const byStatus = new Map(counts.rows.map((row) => [row.status, Number(row.cnt)]));
    const pending = byStatus.get('pending') ?? 0;
    const processing = byStatus.get('processing') ?? 0;
    if (pending === 0 && processing === 0) {
      return;
    }
    if (pending > 0) {
      const { promise: delay, resolve: finishDelay } = Promise.withResolvers<void>();
      setTimeout(finishDelay, 300);
      await delay;
    }
    await harness.testContainer.processOutboxOnce();
  }

  const leftover = await sql<{ status: string; cnt: number; next_run_at: Date | null }>`
    SELECT status, count(*)::int as cnt, min(next_run_at) as next_run_at
    FROM computed_update_outbox
    GROUP BY status
  `.execute(harness.testContainer.db);
  throw new Error(`Outbox did not quiesce: ${JSON.stringify(leftover.rows)}`);
};

const itemName = (index: number) => `item-${String(index).padStart(3, '0')}`;
const hostName = (index: number) => `host-${String(index).padStart(3, '0')}`;

const tableLockKey = (tableId: string) => `v2:computed:${tableId}`;

type CircularSchema = {
  itemsTableId: string;
  hostsTableId: string;
  itemNameFieldId: string;
  hostNameFieldId: string;
  hostLinkFieldId: string;
  hostLookupFieldId: string;
  hostFormulaFieldId: string;
  itemLookupFieldId: string;
  itemFormulaFieldId: string;
};

const prepareCircularSchema = async (harness: TestHarness): Promise<CircularSchema> => {
  const itemNameFieldId = createFieldId();
  const hostNameFieldId = createFieldId();
  const hostLinkFieldId = createFieldId();
  const hostLookupFieldId = createFieldId();
  const hostFormulaFieldId = createFieldId();
  const itemLookupFieldId = createFieldId();
  const itemFormulaFieldId = createFieldId();

  const itemsTable = await createTable(harness, {
    baseId: harness.baseId,
    name: 'Items',
    fields: [{ type: 'singleLineText', id: itemNameFieldId, name: 'Name', isPrimary: true }],
    views: [{ type: 'grid' }],
  });

  const hostsTable = await createTable(harness, {
    baseId: harness.baseId,
    name: 'Hosts',
    fields: [
      { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: hostLinkFieldId,
        name: 'Item',
        options: {
          relationship: 'manyOne',
          foreignTableId: itemsTable.id,
          lookupFieldId: itemNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: hostLookupFieldId,
        name: 'ItemName',
        options: {
          linkFieldId: hostLinkFieldId,
          foreignTableId: itemsTable.id,
          lookupFieldId: itemNameFieldId,
        },
      },
      {
        type: 'formula',
        id: hostFormulaFieldId,
        name: 'HostLabel',
        options: {
          expression: `CONCATENATE("H-", {${hostLookupFieldId}})`,
        },
      },
    ],
    views: [{ type: 'grid' }],
  });

  const itemsAfterLink = await getTableById(harness, itemsTable.id);
  const itemLinkFieldId = itemsAfterLink.fields.find(
    (field) => field.type === 'link' && field.id !== itemNameFieldId
  )?.id;
  expect(itemLinkFieldId).toMatch(/^fld/);

  await createField(harness, itemsTable.id, {
    type: 'lookup',
    id: itemLookupFieldId,
    name: 'HostLabelFromHost',
    options: {
      linkFieldId: itemLinkFieldId,
      foreignTableId: hostsTable.id,
      lookupFieldId: hostFormulaFieldId,
    },
  });
  await createField(harness, itemsTable.id, {
    type: 'formula',
    id: itemFormulaFieldId,
    name: 'ItemLabel',
    options: {
      expression: `CONCATENATE("I-", {${itemLookupFieldId}})`,
    },
  });
  await waitForOutboxQuiesce(harness);

  return {
    itemsTableId: itemsTable.id,
    hostsTableId: hostsTable.id,
    itemNameFieldId,
    hostNameFieldId,
    hostLinkFieldId,
    hostLookupFieldId,
    hostFormulaFieldId,
    itemLookupFieldId,
    itemFormulaFieldId,
  };
};

const collectEmptyComputed = (
  rows: Array<{ fields: Record<string, unknown> }>,
  nameFieldId: string,
  lookupFieldId: string,
  formulaFieldId: string,
  expected: (name: string) => { lookup: string; formula: string }
) => {
  const empty: string[] = [];
  for (const row of rows) {
    const name = cellText(row.fields[nameFieldId]);
    const lookup = cellText(
      parseArrayCell(row.fields[lookupFieldId])[0] ?? row.fields[lookupFieldId]
    );
    const formula = cellText(row.fields[formulaFieldId]);
    const want = expected(name);
    if (lookup !== want.lookup || formula !== want.formula) {
      empty.push(`${name}: lookup=${lookup || '<empty>'} formula=${formula || '<empty>'}`);
    }
  }
  return empty;
};

describe('computed hybrid batch insert lock drop (e2e) T7018', () => {
  it('converges reciprocal lookup/formula after sequential 100-row hybrid inserts', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: {
          dispatchMode: 'external',
          syncPolicy: 'seedTableOnly',
        },
        outboxConfig: {
          maxConcurrentProcessingPerBase: 2,
          maxConcurrentProcessingPerSeedTable: 2,
        },
      },
    });

    const schema = await prepareCircularSchema(harness);

    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;

    let pumping = true;
    const pump = (async () => {
      while (pumping) {
        await worker.runOnce({ workerId: 't7018-pump', limit: 4 });
        const { promise: pause, resolve: finishPause } = Promise.withResolvers<void>();
        setTimeout(finishPause, 20);
        await pause;
      }
    })();

    try {
      for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
        const start = batch * BATCH_SIZE;
        const items = await createRecords(
          harness,
          schema.itemsTableId,
          Array.from({ length: BATCH_SIZE }, (_, offset) => {
            const index = start + offset;
            return { fields: { [schema.itemNameFieldId]: itemName(index) } };
          })
        );
        expect(items).toHaveLength(BATCH_SIZE);

        const hosts = await createRecords(
          harness,
          schema.hostsTableId,
          items.map((item, offset) => {
            const index = start + offset;
            return {
              fields: {
                [schema.hostNameFieldId]: hostName(index),
                [schema.hostLinkFieldId]: { id: item.id },
              },
            };
          })
        );
        expect(hosts).toHaveLength(BATCH_SIZE);
      }
    } finally {
      pumping = false;
      await pump;
    }

    await waitForOutboxQuiesce(harness);

    const hostRows = await listRecordsWithoutDrain(harness, schema.hostsTableId);
    const itemRows = await listRecordsWithoutDrain(harness, schema.itemsTableId);
    expect(hostRows).toHaveLength(TOTAL_ROWS);
    expect(itemRows).toHaveLength(TOTAL_ROWS);

    const emptyHosts = collectEmptyComputed(
      hostRows,
      schema.hostNameFieldId,
      schema.hostLookupFieldId,
      schema.hostFormulaFieldId,
      (name) => {
        const expectedItem = name.replace(/^host-/, 'item-');
        return { lookup: expectedItem, formula: `H-${expectedItem}` };
      }
    );
    const emptyItems = collectEmptyComputed(
      itemRows,
      schema.itemNameFieldId,
      schema.itemLookupFieldId,
      schema.itemFormulaFieldId,
      (name) => ({ lookup: `H-${name}`, formula: `I-H-${name}` })
    );

    expect(emptyHosts, emptyHosts.slice(0, 8).join('; ')).toEqual([]);
    expect(emptyItems, emptyItems.slice(0, 8).join('; ')).toEqual([]);

    const leftover = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_outbox
    `.execute(harness.testContainer.db);
    expect(Number(leftover.rows[0]?.cnt ?? 0)).toBe(0);

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 300_000);

  it('requeues host batch compute when the seed table lock is held', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: {
          dispatchMode: 'external',
          syncPolicy: 'seedTableOnly',
        },
      },
    });

    const schema = await prepareCircularSchema(harness);

    const items = await createRecords(
      harness,
      schema.itemsTableId,
      Array.from({ length: BATCH_SIZE }, (_, index) => ({
        fields: { [schema.itemNameFieldId]: itemName(index) },
      }))
    );
    await waitForOutboxQuiesce(harness);

    const hostLockKey = tableLockKey(schema.hostsTableId);
    let outboxDuringHold = 0;
    let emptyHostsDuringHold: string[] = [];

    await harness.testContainer.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(
        ('x' || substr(md5(${hostLockKey}), 1, 16))::bit(64)::bigint
      )`.execute(trx);

      const hosts = await createRecords(
        harness,
        schema.hostsTableId,
        items.map((item, index) => ({
          fields: {
            [schema.hostNameFieldId]: hostName(index),
            [schema.hostLinkFieldId]: { id: item.id },
          },
        }))
      );
      expect(hosts).toHaveLength(BATCH_SIZE);

      const pending = await sql<{ cnt: number }>`
        SELECT count(*)::int as cnt FROM computed_update_outbox
      `.execute(harness.testContainer.db);
      outboxDuringHold = Number(pending.rows[0]?.cnt ?? 0);

      const hostRowsDuringHold = await listRecordsWithoutDrain(harness, schema.hostsTableId);
      emptyHostsDuringHold = collectEmptyComputed(
        hostRowsDuringHold,
        schema.hostNameFieldId,
        schema.hostLookupFieldId,
        schema.hostFormulaFieldId,
        (name) => {
          const expectedItem = name.replace(/^host-/, 'item-');
          return { lookup: expectedItem, formula: `H-${expectedItem}` };
        }
      );

      await harness.testContainer.processOutboxOnce();
    });

    expect(
      emptyHostsDuringHold.length,
      'inline compute must not commit lookup/formula while the seed table lock is held'
    ).toBeGreaterThan(0);
    expect(
      outboxDuringHold,
      'lock miss must leave an outbox task, not drop the cascade'
    ).toBeGreaterThan(0);

    await waitForOutboxQuiesce(harness);

    const hostRows = await listRecordsWithoutDrain(harness, schema.hostsTableId);
    const itemRows = await listRecordsWithoutDrain(harness, schema.itemsTableId);
    expect(hostRows).toHaveLength(BATCH_SIZE);
    expect(itemRows).toHaveLength(BATCH_SIZE);

    const emptyHosts = collectEmptyComputed(
      hostRows,
      schema.hostNameFieldId,
      schema.hostLookupFieldId,
      schema.hostFormulaFieldId,
      (name) => {
        const expectedItem = name.replace(/^host-/, 'item-');
        return { lookup: expectedItem, formula: `H-${expectedItem}` };
      }
    );
    const emptyItems = collectEmptyComputed(
      itemRows,
      schema.itemNameFieldId,
      schema.itemLookupFieldId,
      schema.itemFormulaFieldId,
      (name) => ({ lookup: `H-${name}`, formula: `I-H-${name}` })
    );

    expect(emptyHosts, emptyHosts.slice(0, 8).join('; ')).toEqual([]);
    expect(emptyItems, emptyItems.slice(0, 8).join('; ')).toEqual([]);
  }, 180_000);
});
