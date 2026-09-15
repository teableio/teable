/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Dependency-frontier stage budget (BYODB OOM mitigation).
 *
 * Wide/deep computed plans must not execute as one transaction: with a stage
 * budget configured, the worker runs a level-ordered prefix per outbox task and
 * continues via a deferred-stage task committed atomically with the stage.
 * This spec forces stageMaxSteps=1 so a lookup + formula chain crosses several
 * stages, then asserts the values still converge and no dead letters appear.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
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

const createHarness = async (
  outboxConfig: Record<string, number> = { stageMaxSteps: 1 },
  fieldBackfillConfig?: { mode: 'async' }
): Promise<TestHarness> => {
  const testContainer = await createE2eTestContainer({
    dbMode: 'pglite',
    computedUpdate: {
      hybridConfig: {
        dispatchMode: 'external',
        // Full async so every stage runs through the outbox worker.
        syncPolicy: 'none',
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
  // Outbox drains run CPU-heavy PGlite work between HTTP requests. Keep the
  // test connection alive until close() rather than racing an idle timeout
  // against fetch reusing it after a long drain on a slower runner.
  server.keepAliveTimeout = 0;

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

const createField = async (
  harness: TestHarness,
  tableId: string,
  field: { id: string } & Record<string, unknown>
) => {
  const response = await fetch(`${harness.baseUrl}/tables/createField`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseId: harness.baseId, tableId, field }),
  });
  const rawBody: unknown = await response.json();
  expect(response.ok, JSON.stringify(rawBody)).toBe(true);
  return field.id;
};

const updateRecord = async (
  harness: TestHarness,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
) => {
  const response = await fetch(`${harness.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, recordId, fields }),
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(200);
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
    return String((value as { title?: unknown }).title ?? '');
  }
  return String(value);
};

/** Drain the outbox to empty, returning the total number of processed tasks. */
const drainOutbox = async (harness: TestHarness, rounds = 120): Promise<number> => {
  let totalProcessed = 0;
  for (let i = 0; i < rounds; i += 1) {
    const processed = await harness.testContainer.processOutboxOnce();
    totalProcessed += processed;
    if (processed > 0) continue;

    const counts = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt
      FROM computed_update_outbox
      WHERE status IN ('pending', 'processing')
    `.execute(harness.testContainer.db);
    if (Number(counts.rows[0]?.cnt ?? 0) === 0) {
      return totalProcessed;
    }
    // Requeued tasks schedule next_run_at slightly in the future.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Outbox did not quiesce under stage budget');
};

describe('computed stage budget continuation (e2e)', () => {
  it('batches async filtered rollup backfills across continuation tasks T7075', async () => {
    const harness = await createHarness({ fieldBackfillBatchSize: 2 }, { mode: 'async' });

    const sourceNameFieldId = createFieldId();
    const sourceAmountFieldId = createFieldId();
    const sourceKindFieldId = createFieldId();
    const hostNameFieldId = createFieldId();
    const hostLinkFieldId = createFieldId();
    const hostRollupFieldId = createFieldId();

    const sourceTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'AsyncRollupSources',
      fields: [
        {
          type: 'singleLineText',
          id: sourceNameFieldId,
          name: 'Name',
          isPrimary: true,
        },
        { type: 'number', id: sourceAmountFieldId, name: 'Amount' },
        { type: 'singleLineText', id: sourceKindFieldId, name: 'Kind' },
      ],
      views: [{ type: 'grid' }],
    });
    const hostTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'AsyncRollupHosts',
      fields: [
        { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: hostLinkFieldId,
          name: 'Lines',
          options: {
            relationship: 'oneMany',
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const expectedByHostId = new Map<string, number>();
    for (let index = 0; index < 5; index += 1) {
      const isDebit = index % 2 === 0;
      const amount = (index + 1) * 10;
      const source = await createRecord(harness, sourceTable.id, {
        [sourceNameFieldId]: `Line ${index + 1}`,
        [sourceAmountFieldId]: amount,
        [sourceKindFieldId]: isDebit ? 'debit' : 'credit',
      });
      const host = await createRecord(harness, hostTable.id, {
        [hostNameFieldId]: `Host ${index + 1}`,
        [hostLinkFieldId]: [{ id: source.id }],
      });
      expectedByHostId.set(host.id, isDebit ? amount : 0);
    }
    await drainOutbox(harness);

    await createField(harness, hostTable.id, {
      id: hostRollupFieldId,
      type: 'rollup',
      name: 'Debit total',
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: hostLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourceAmountFieldId,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: sourceKindFieldId, operator: 'is', value: 'debit' }],
        },
      },
    });

    const processed = await drainOutbox(harness);
    expect(processed).toBe(3);

    const records = await listRecords(harness, hostTable.id);
    for (const [hostId, expected] of expectedByHostId) {
      const row = records.find((record) => record.id === hostId);
      expect(row).toBeDefined();
      expect(row?.fields[hostRollupFieldId]).toBe(expected);
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('batches async lookup field backfills across continuation tasks', async () => {
    const harness = await createHarness({ fieldBackfillBatchSize: 2 }, { mode: 'async' });

    const parentNameFieldId = createFieldId();
    const childLinkFieldId = createFieldId();
    const childLookupFieldId = createFieldId();

    const parentTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'BackfillParents',
      fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const childTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'BackfillChildren',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: childLinkFieldId,
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: parentTable.id,
            lookupFieldId: parentNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const parent = await createRecord(harness, parentTable.id, {
      [parentNameFieldId]: 'Parent A',
    });
    const childIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const child = await createRecord(harness, childTable.id, {
        Title: `Child ${index + 1}`,
        [childLinkFieldId]: { id: parent.id },
      });
      childIds.push(child.id);
    }
    await drainOutbox(harness);

    await createField(harness, childTable.id, {
      id: childLookupFieldId,
      type: 'lookup',
      name: 'ParentName',
      options: {
        linkFieldId: childLinkFieldId,
        foreignTableId: parentTable.id,
        lookupFieldId: parentNameFieldId,
      },
    });

    const processed = await drainOutbox(harness);
    expect(processed).toBe(3);

    const records = await listRecords(harness, childTable.id);
    for (const childId of childIds) {
      const row = records.find((record) => record.id === childId);
      expect(row).toBeDefined();
      expect(
        cellText(
          parseArrayCell(row?.fields[childLookupFieldId])[0] ?? row?.fields[childLookupFieldId]
        )
      ).toBe('Parent A');
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it.each([0, 512])(
    'converges a lookup + formula chain split across multiple bounded stages (adaptive threshold: %s)',
    async (stageSmallRunComplexityThreshold) => {
      // Cross-table work must retain the configured cap at the default small-run threshold;
      // both paths must durably converge through the public HTTP write/read APIs.
      const harness = await createHarness({
        stageMaxSteps: 1,
        stageSmallRunComplexityThreshold,
      });

      const parentNameFieldId = createFieldId();
      const childLinkFieldId = createFieldId();
      const childLookupFieldId = createFieldId();
      const childL1FieldId = createFieldId();
      const childL2FieldId = createFieldId();

      const parentTable = await createTable(harness, {
        baseId: harness.baseId,
        name: 'Parents',
        fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const childTable = await createTable(harness, {
        baseId: harness.baseId,
        name: 'Children',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            id: childLinkFieldId,
            name: 'Parent',
            options: {
              relationship: 'manyOne',
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: childLookupFieldId,
            name: 'ParentName',
            options: {
              linkFieldId: childLinkFieldId,
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
            },
          },
          {
            type: 'formula',
            id: childL1FieldId,
            name: 'L1',
            options: { expression: `CONCATENATE({${childLookupFieldId}}, "-L1")` },
          },
          {
            type: 'formula',
            id: childL2FieldId,
            name: 'L2',
            options: { expression: `CONCATENATE({${childL1FieldId}}, "-L2")` },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const parent = await createRecord(harness, parentTable.id, {
        [parentNameFieldId]: 'Alpha',
      });
      const childA = await createRecord(harness, childTable.id, {
        Title: 'A',
        [childLinkFieldId]: { id: parent.id },
      });
      const childB = await createRecord(harness, childTable.id, {
        Title: 'B',
        [childLinkFieldId]: { id: parent.id },
      });

      await drainOutbox(harness);

      const assertChildren = async (expected: string) => {
        const records = await listRecords(harness, childTable.id);
        for (const childId of [childA.id, childB.id]) {
          const row = records.find((record) => record.id === childId);
          expect(row).toBeDefined();
          const lookup = cellText(
            parseArrayCell(row?.fields[childLookupFieldId])[0] ?? row?.fields[childLookupFieldId]
          );
          expect(lookup).toBe(expected);
          expect(cellText(row?.fields[childL1FieldId])).toBe(`${expected}-L1`);
          expect(cellText(row?.fields[childL2FieldId])).toBe(`${expected}-L1-L2`);
        }
      };

      await assertChildren('Alpha');

      await updateRecord(harness, parentTable.id, parent.id, {
        [parentNameFieldId]: 'Alpha-updated',
      });

      // stageMaxSteps=1 forces the seed task plus at least one deferred continuation.
      const processed = await drainOutbox(harness);
      expect(processed).toBeGreaterThanOrEqual(2);

      await assertChildren('Alpha-updated');

      const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
      expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
    },
    120_000
  );

  it('fills existing order formulas after staged source INSERT T7152', async () => {
    const harness = await createHarness({
      stageMaxSteps: 2,
      stageSmallRunComplexityThreshold: 0,
    });

    const detailNameFieldId = createFieldId();
    const detailProductNameFieldId = createFieldId();
    const detailOrderKeyFieldId = createFieldId();
    const orderKeyFieldId = createFieldId();
    const productNameFieldId = createFieldId();
    const productNameDisplayFieldId = createFieldId();
    const orderSummaryFieldId = createFieldId();

    const details = await createTable(harness, {
      baseId: harness.baseId,
      name: 'T7152 Order Details',
      fields: [
        {
          type: 'singleLineText',
          id: detailNameFieldId,
          name: 'product_label',
          isPrimary: true,
        },
        { type: 'singleLineText', id: detailOrderKeyFieldId, name: 'order_key' },
        {
          type: 'formula',
          id: detailProductNameFieldId,
          name: 'product_name',
          options: { expression: `CONCATENATE({${detailNameFieldId}})` },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const orders = await createTable(harness, {
      baseId: harness.baseId,
      name: 'T7152 Orders',
      fields: [
        { type: 'singleLineText', id: orderKeyFieldId, name: 'order_key', isPrimary: true },
        {
          type: 'conditionalLookup',
          id: productNameFieldId,
          name: 'product_name',
          options: {
            foreignTableId: details.id,
            lookupFieldId: detailProductNameFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: detailOrderKeyFieldId,
                    operator: 'is',
                    value: orderKeyFieldId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
        {
          type: 'formula',
          id: productNameDisplayFieldId,
          name: 'product_name_display',
          options: {
            expression: `IF(COUNTA({${productNameFieldId}}) > 0, ARRAYJOIN({${productNameFieldId}}, ", "), BLANK())`,
          },
        },
        {
          type: 'formula',
          id: orderSummaryFieldId,
          name: 'order_summary',
          options: {
            expression: `CONCATENATE({${productNameDisplayFieldId}}, "-summary")`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    // A second dependent table keeps each clamped dependency level above the
    // one-step floor, which migrates seeds to the ledger and masks the bug.
    const peerKeyFieldId = createFieldId();
    const peerLookupFieldId = createFieldId();
    const peerDisplayFieldId = createFieldId();
    const peer = await createTable(harness, {
      baseId: harness.baseId,
      name: 'T7152 Order Mirror',
      fields: [
        { type: 'singleLineText', id: peerKeyFieldId, name: 'order_key', isPrimary: true },
        {
          type: 'conditionalLookup',
          id: peerLookupFieldId,
          name: 'product_name',
          options: {
            foreignTableId: details.id,
            lookupFieldId: detailProductNameFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: detailOrderKeyFieldId,
                    operator: 'is',
                    value: peerKeyFieldId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
        {
          type: 'formula',
          id: peerDisplayFieldId,
          name: 'product_name_display',
          options: { expression: `ARRAYJOIN({${peerLookupFieldId}}, ", ")` },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const peerRecord = await createRecord(harness, peer.id, { [peerKeyFieldId]: '1001' });

    await createRecord(harness, details.id, {
      [detailNameFieldId]: 'Unrelated Product',
      [detailOrderKeyFieldId]: 'OTHER',
    });
    await drainOutbox(harness);
    const target = await createRecord(harness, orders.id, { [orderKeyFieldId]: '1001' });
    const unrelated = await createRecord(harness, orders.id, { [orderKeyFieldId]: 'OTHER' });
    await drainOutbox(harness);

    const before = await listRecords(harness, orders.id);
    const targetBefore = before.find((record) => record.id === target.id);
    const unrelatedBefore = before.find((record) => record.id === unrelated.id);
    expect(targetBefore).toBeDefined();
    expect(targetBefore?.fields[productNameFieldId] ?? null).toBeNull();
    expect(targetBefore?.fields[productNameDisplayFieldId] ?? null).toBeNull();
    expect(unrelatedBefore?.fields).toEqual({
      [orderKeyFieldId]: 'OTHER',
      [productNameFieldId]: ['Unrelated Product'],
      [productNameDisplayFieldId]: 'Unrelated Product',
      [orderSummaryFieldId]: 'Unrelated Product-summary',
    });

    // Both target lookups and then both displays run as multi-step levels.
    await createRecord(harness, details.id, {
      [detailNameFieldId]: 'Widget Alpha',
      [detailOrderKeyFieldId]: '1001',
    });
    await drainOutbox(harness);

    const after = await listRecords(harness, orders.id);
    const targetAfter = after.find((record) => record.id === target.id);
    expect(targetAfter?.fields[productNameFieldId]).toEqual(['Widget Alpha']);
    expect(targetAfter?.fields[productNameDisplayFieldId]).toBe('Widget Alpha');
    const peerAfter = (await listRecords(harness, peer.id)).find(
      (record) => record.id === peerRecord.id
    );
    expect(peerAfter?.fields[peerDisplayFieldId]).toBe('Widget Alpha');
    expect(targetAfter?.fields[orderSummaryFieldId]).toBe('Widget Alpha-summary');
    expect(after.find((record) => record.id === unrelated.id)?.fields).toEqual(
      unrelatedBefore?.fields
    );

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('hard-splits a wide same-level field fan across stages', async () => {
    // One table, five same-level formulas on the same source field: the planner
    // merges them into a single step, so only the field budget can split it.
    const harness = await createHarness({
      stageMaxSteps: 0,
      stageMaxFields: 2,
      stageMaxEdges: 0,
      stageMaxDirtyRecords: 0,
      // This case exercises STATIC field splitting; small-run adaptivity would
      // scale the 2-field budget past the whole five-field fan.
      stageSmallRunComplexityThreshold: 0,
    });

    const sourceFieldId = createFieldId();
    const formulaFieldIds = Array.from({ length: 5 }, () => createFieldId());

    const table = await createTable(harness, {
      baseId: harness.baseId,
      name: 'WideFan',
      fields: [
        { type: 'singleLineText', id: sourceFieldId, name: 'Source', isPrimary: true },
        ...formulaFieldIds.map((fieldId, index) => ({
          type: 'formula',
          id: fieldId,
          name: `F${index}`,
          options: { expression: `CONCATENATE({${sourceFieldId}}, "-F${index}")` },
        })),
      ],
      views: [{ type: 'grid' }],
    });

    const record = await createRecord(harness, table.id, { [sourceFieldId]: 'Seed' });
    await drainOutbox(harness);

    await updateRecord(harness, table.id, record.id, { [sourceFieldId]: 'Seed-updated' });

    // 5 fields at 2 per stage: at least the seed task plus two continuations.
    const processed = await drainOutbox(harness);
    expect(processed).toBeGreaterThanOrEqual(3);

    const rows = await listRecords(harness, table.id);
    const row = rows.find((entry) => entry.id === record.id);
    expect(row).toBeDefined();
    for (const [index, fieldId] of formulaFieldIds.entries()) {
      expect(cellText(row?.fields[fieldId])).toBe(`Seed-updated-F${index}`);
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('reaches targets only later edge chunks touch, across partial batches (AJ shape)', async () => {
    // Two parents share one queued update, so a partial batch retires the first
    // source while the second remains. A single parent can survive in the final
    // dirty temp table even if consumed-source preservation is broken.
    // Three link/lookup pairs exceed the two-edge budget; some children are
    // reachable only through a deferred edge and need the earlier source again.
    const harness = await createHarness({
      stageMaxSteps: 0,
      stageMaxFields: 0,
      stageMaxEdges: 2,
      stageMaxDirtyRecords: 2,
      // Otherwise small-run scaling turns two edges into eight: no deferred edge.
      stageSmallRunComplexityThreshold: 0,
    });

    const parentNameFieldId = createFieldId();
    const linkFieldIds = [createFieldId(), createFieldId(), createFieldId()];
    const lookupFieldIds = [createFieldId(), createFieldId(), createFieldId()];

    const parentTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'FanParents',
      fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const childTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'FanChildren',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        ...linkFieldIds.flatMap((linkFieldId, index) => [
          {
            type: 'link',
            id: linkFieldId,
            name: `Link${index}`,
            options: {
              relationship: 'manyOne',
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: lookupFieldIds[index],
            name: `Lookup${index}`,
            options: {
              linkFieldId,
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
            },
          },
        ]),
      ],
      views: [{ type: 'grid' }],
    });

    const parents = [];
    const allLinkChildren = [];
    const lastLinkChildren = [];
    for (const name of ['Fan', 'Other']) {
      const parent = await createRecord(harness, parentTable.id, {
        [parentNameFieldId]: name,
      });
      parents.push({ id: parent.id, expected: `${name}-updated` });
      // Per parent: children reached by every edge, and only by the last edge.
      for (let i = 0; i < 3; i += 1) {
        allLinkChildren.push({
          ...(await createRecord(harness, childTable.id, {
            Title: `${name}-All${i}`,
            [linkFieldIds[0]]: { id: parent.id },
            [linkFieldIds[1]]: { id: parent.id },
            [linkFieldIds[2]]: { id: parent.id },
          })),
          expected: `${name}-updated`,
        });
        lastLinkChildren.push({
          ...(await createRecord(harness, childTable.id, {
            Title: `${name}-Last${i}`,
            [linkFieldIds[2]]: { id: parent.id },
          })),
          expected: `${name}-updated`,
        });
      }
    }
    await drainOutbox(harness);

    const updateResponse = await fetch(`${harness.baseUrl}/tables/updateRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: parentTable.id,
        records: parents.map((parent) => ({
          id: parent.id,
          fields: { [parentNameFieldId]: parent.expected },
        })),
      }),
    });
    const updateBody = await updateResponse.json();
    expect(updateResponse.status, JSON.stringify(updateBody)).toBe(200);
    expect(updateBody.data.updatedCount).toBe(2);
    await drainOutbox(harness);

    const records = await listRecords(harness, childTable.id);
    for (const child of allLinkChildren) {
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      for (const lookupFieldId of lookupFieldIds) {
        const lookup = cellText(
          parseArrayCell(row?.fields[lookupFieldId])[0] ?? row?.fields[lookupFieldId]
        );
        expect(lookup, 'COMPUTED_DEFERRED_EDGE_VALUE').toBe(child.expected);
      }
    }
    // The rows only the deferred chunk's edge reaches must not be stale.
    for (const child of lastLinkChildren) {
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      const lookup = cellText(
        parseArrayCell(row?.fields[lookupFieldIds[2]])[0] ?? row?.fields[lookupFieldIds[2]]
      );
      expect(lookup, 'COMPUTED_DEFERRED_EDGE_VALUE').toBe(child.expected);
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
    // The stage ledger fully drains once the chain completes.
    const ledger = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_stage_ledger
    `.execute(harness.testContainer.db);
    expect(Number(ledger.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('clears lookups after a parent delete under active stage budgets', async () => {
    const harness = await createHarness({
      stageMaxSteps: 0,
      stageMaxFields: 0,
      stageMaxEdges: 2,
      stageMaxDirtyRecords: 2,
    });

    const parentNameFieldId = createFieldId();
    const linkFieldIds = [createFieldId(), createFieldId(), createFieldId()];
    const lookupFieldIds = [createFieldId(), createFieldId(), createFieldId()];

    const parentTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'DelParents',
      fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const childTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'DelChildren',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        ...linkFieldIds.flatMap((linkFieldId, index) => [
          {
            type: 'link',
            id: linkFieldId,
            name: `Link${index}`,
            options: {
              relationship: 'manyOne',
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: lookupFieldIds[index],
            name: `Lookup${index}`,
            options: {
              linkFieldId,
              foreignTableId: parentTable.id,
              lookupFieldId: parentNameFieldId,
            },
          },
        ]),
      ],
      views: [{ type: 'grid' }],
    });

    const parent = await createRecord(harness, parentTable.id, { [parentNameFieldId]: 'Fan' });
    const children = [];
    for (let i = 0; i < 3; i += 1) {
      children.push(
        await createRecord(harness, childTable.id, {
          Title: `C${i}`,
          [linkFieldIds[0]]: { id: parent.id },
          [linkFieldIds[1]]: { id: parent.id },
          [linkFieldIds[2]]: { id: parent.id },
        })
      );
    }
    await drainOutbox(harness);

    const deleteResponse = await fetch(`${harness.baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: parentTable.id, recordIds: [parent.id] }),
    });
    expect(deleteResponse.status).toBe(200);
    await drainOutbox(harness);

    const afterDelete = await listRecords(harness, childTable.id);
    const staleCells: string[] = [];
    for (const child of children) {
      const row = afterDelete.find((record) => record.id === child.id);
      for (const [index, lookupFieldId] of lookupFieldIds.entries()) {
        const lookup = cellText(
          parseArrayCell(row?.fields[lookupFieldId])[0] ?? row?.fields[lookupFieldId]
        );
        if (lookup !== '') staleCells.push(`${child.id}/lookup${index}=${lookup}`);
      }
    }
    expect(staleCells, 'stale lookups after parent delete').toEqual([]);
  }, 120_000);

  it('converges when a continuation carries only a seed-all table', async () => {
    // Low seed-all threshold turns the stage's dirty rows into seedAllTableIds and
    // seed narrowing drops the original seeds — the continuation must not be
    // mistaken for a schema-update "seed everything" run (which would seed the
    // wrong table and leave downstream fields stale).
    const harness = await createHarness({
      stageMaxSteps: 1,
      stageMaxFields: 0,
      stageMaxEdges: 0,
      stageMaxDirtyRecords: 0,
      stageSeedAllThreshold: 2,
      stageSmallRunComplexityThreshold: 0,
    });

    const parentNameFieldId = createFieldId();
    const childLinkFieldId = createFieldId();
    const childLookupFieldId = createFieldId();
    const childL1FieldId = createFieldId();

    const parentTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Parents',
      fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const childTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Children',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: childLinkFieldId,
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: parentTable.id,
            lookupFieldId: parentNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: childLookupFieldId,
          name: 'ParentName',
          options: {
            linkFieldId: childLinkFieldId,
            foreignTableId: parentTable.id,
            lookupFieldId: parentNameFieldId,
          },
        },
        {
          type: 'formula',
          id: childL1FieldId,
          name: 'L1',
          options: { expression: `CONCATENATE({${childLookupFieldId}}, "-L1")` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const parent = await createRecord(harness, parentTable.id, {
      [parentNameFieldId]: 'Root',
    });
    const children = [];
    for (let i = 0; i < 4; i += 1) {
      children.push(
        await createRecord(harness, childTable.id, {
          Title: `C${i}`,
          [childLinkFieldId]: { id: parent.id },
        })
      );
    }

    await drainOutbox(harness);

    await updateRecord(harness, parentTable.id, parent.id, {
      [parentNameFieldId]: 'Root-updated',
    });

    const processed = await drainOutbox(harness);
    expect(processed).toBeGreaterThanOrEqual(2);

    const records = await listRecords(harness, childTable.id);
    for (const child of children) {
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      const lookup = cellText(
        parseArrayCell(row?.fields[childLookupFieldId])[0] ?? row?.fields[childLookupFieldId]
      );
      expect(lookup).toBe('Root-updated');
      expect(cellText(row?.fields[childL1FieldId])).toBe('Root-updated-L1');
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('makes progress when a seed-all source table exceeds the dirty budget', async () => {
    // The continuation carries seedAllTableIds for a SOURCE table whose step lives
    // downstream: bounded seeding truncates, and propagation must still run so the
    // batch produces targets and exclusions — otherwise the continuation repeats
    // the same first rows forever without progress.
    const harness = await createHarness({
      stageMaxSteps: 1,
      stageMaxFields: 0,
      stageMaxEdges: 0,
      stageMaxDirtyRecords: 2,
      stageSeedAllThreshold: 2,
    });

    const parentNameFieldId = createFieldId();
    const midLinkFieldId = createFieldId();
    const midLookupFieldId = createFieldId();
    const leafLinkFieldId = createFieldId();
    const leafLookupFieldId = createFieldId();

    const parentTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Parents',
      fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const midTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Mids',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: midLinkFieldId,
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: parentTable.id,
            lookupFieldId: parentNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: midLookupFieldId,
          name: 'ParentName',
          options: {
            linkFieldId: midLinkFieldId,
            foreignTableId: parentTable.id,
            lookupFieldId: parentNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const leafTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Leaves',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: leafLinkFieldId,
          name: 'Mid',
          options: {
            relationship: 'manyOne',
            foreignTableId: midTable.id,
            lookupFieldId: midLookupFieldId,
          },
        },
        {
          type: 'lookup',
          id: leafLookupFieldId,
          name: 'MidParentName',
          options: {
            linkFieldId: leafLinkFieldId,
            foreignTableId: midTable.id,
            lookupFieldId: midLookupFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const parent = await createRecord(harness, parentTable.id, {
      [parentNameFieldId]: 'Origin',
    });
    const leaves = [];
    for (let i = 0; i < 4; i += 1) {
      const mid = await createRecord(harness, midTable.id, {
        Title: `M${i}`,
        [midLinkFieldId]: { id: parent.id },
      });
      leaves.push(
        await createRecord(harness, leafTable.id, {
          Title: `L${i}`,
          [leafLinkFieldId]: { id: mid.id },
        })
      );
    }

    await drainOutbox(harness);

    await updateRecord(harness, parentTable.id, parent.id, {
      [parentNameFieldId]: 'Origin-updated',
    });

    const processed = await drainOutbox(harness);
    expect(processed).toBeGreaterThanOrEqual(2);

    const records = await listRecords(harness, leafTable.id);
    for (const leaf of leaves) {
      const row = records.find((record) => record.id === leaf.id);
      expect(row).toBeDefined();
      const lookup = cellText(
        parseArrayCell(row?.fields[leafLookupFieldId])[0] ?? row?.fields[leafLookupFieldId]
      );
      expect(lookup).toBe('Origin-updated');
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('converges a self-referential link chain under the dirty budget', async () => {
    // Self-link lookups propagate generation by generation within one table; the
    // budgeted floor re-seeds processed batches as dirty so later generations are
    // still reachable instead of running unguarded.
    const harness = await createHarness({
      stageMaxSteps: 0,
      stageMaxFields: 0,
      stageMaxEdges: 0,
      stageMaxDirtyRecords: 2,
    });

    const nameFieldId = createFieldId();
    const table = await createTable(harness, {
      baseId: harness.baseId,
      name: 'SelfChain',
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const createField = async (field: { id: string } & Record<string, unknown>) => {
      const response = await fetch(`${harness.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseId: harness.baseId, tableId: table.id, field }),
      });
      const rawBody: unknown = await response.json();
      expect(response.ok, JSON.stringify(rawBody)).toBe(true);
      return String(field.id);
    };

    const selfLinkFieldId = await createField({
      id: createFieldId(),
      type: 'link',
      name: 'Parent',
      options: {
        relationship: 'manyOne',
        foreignTableId: table.id,
        lookupFieldId: nameFieldId,
      },
    });
    const parentNameLookupId = await createField({
      id: createFieldId(),
      type: 'lookup',
      name: 'ParentName',
      options: {
        linkFieldId: selfLinkFieldId,
        foreignTableId: table.id,
        lookupFieldId: nameFieldId,
      },
    });

    const root = await createRecord(harness, table.id, { [nameFieldId]: 'N0' });
    let parentId = root.id;
    const chain = [root];
    for (let i = 1; i <= 3; i += 1) {
      const record = await createRecord(harness, table.id, {
        [nameFieldId]: `N${i}`,
        [selfLinkFieldId]: { id: parentId },
      });
      chain.push(record);
      parentId = record.id;
    }

    await drainOutbox(harness);

    await updateRecord(harness, table.id, root.id, { [nameFieldId]: 'N0-updated' });
    await drainOutbox(harness);

    const records = await listRecords(harness, table.id);
    const lookupOf = (recordId: string) => {
      const row = records.find((record) => record.id === recordId);
      expect(row).toBeDefined();
      return cellText(
        parseArrayCell(row?.fields[parentNameLookupId])[0] ?? row?.fields[parentNameLookupId]
      );
    };
    // Only the direct child's lookup shows the changed name; deeper rows keep
    // their own parents' names, which must all still be consistent.
    expect(lookupOf(chain[1].id)).toBe('N0-updated');
    expect(lookupOf(chain[2].id)).toBe('N1');
    expect(lookupOf(chain[3].id)).toBe('N2');

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('converges a wide self-referential fan under consecutive propagation truncation', async () => {
    // One root with many self-linked children: a single generation wider than the
    // propagation pool forces consecutive truncated batches; the bounded frontier
    // prefix must keep re-seeding until every child's lookup lands.
    const harness = await createHarness({
      stageMaxSteps: 0,
      stageMaxFields: 0,
      stageMaxEdges: 0,
      stageMaxDirtyRecords: 2,
    });

    const nameFieldId = createFieldId();
    const table = await createTable(harness, {
      baseId: harness.baseId,
      name: 'WideSelfFan',
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const createField = async (field: { id: string } & Record<string, unknown>) => {
      const response = await fetch(`${harness.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseId: harness.baseId, tableId: table.id, field }),
      });
      const rawBody: unknown = await response.json();
      expect(response.ok, JSON.stringify(rawBody)).toBe(true);
      return String(field.id);
    };

    const selfLinkFieldId = await createField({
      id: createFieldId(),
      type: 'link',
      name: 'Parent',
      options: {
        relationship: 'manyOne',
        foreignTableId: table.id,
        lookupFieldId: nameFieldId,
      },
    });
    const parentNameLookupId = await createField({
      id: createFieldId(),
      type: 'lookup',
      name: 'ParentName',
      options: {
        linkFieldId: selfLinkFieldId,
        foreignTableId: table.id,
        lookupFieldId: nameFieldId,
      },
    });

    const root = await createRecord(harness, table.id, { [nameFieldId]: 'Hub' });
    const children = [];
    for (let i = 0; i < 6; i += 1) {
      children.push(
        await createRecord(harness, table.id, {
          [nameFieldId]: `Child${i}`,
          [selfLinkFieldId]: { id: root.id },
        })
      );
    }

    await drainOutbox(harness);

    await updateRecord(harness, table.id, root.id, { [nameFieldId]: 'Hub-updated' });
    const processed = await drainOutbox(harness);
    // Width 6 against a 2-row pool: several truncated batches are required.
    expect(processed).toBeGreaterThanOrEqual(3);

    const records = await listRecords(harness, table.id);
    for (const child of children) {
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      const lookup = cellText(
        parseArrayCell(row?.fields[parentNameLookupId])[0] ?? row?.fields[parentNameLookupId]
      );
      expect(lookup).toBe('Hub-updated');
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);

  it('converges under a tiny dirty-record budget via shrink-and-continue', async () => {
    // Static staging off: only the runtime dirty budget drives the stage cuts.
    // seedInlineLimit forces the exclusion ledger / frontier queue onto the
    // per-row spill path (computed_update_outbox_seed) instead of payload JSON.
    const harness = await createHarness({
      stageMaxSteps: 0,
      stageMaxFields: 0,
      stageMaxEdges: 0,
      stageMaxDirtyRecords: 2,
      seedInlineLimit: 2,
    });

    const parentNameFieldId = createFieldId();
    const childLinkFieldId = createFieldId();
    const childLookupFieldId = createFieldId();
    const childL1FieldId = createFieldId();

    const parentTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Parents',
      fields: [{ type: 'singleLineText', id: parentNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const childTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Children',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: childLinkFieldId,
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: parentTable.id,
            lookupFieldId: parentNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: childLookupFieldId,
          name: 'ParentName',
          options: {
            linkFieldId: childLinkFieldId,
            foreignTableId: parentTable.id,
            lookupFieldId: parentNameFieldId,
          },
        },
        {
          type: 'formula',
          id: childL1FieldId,
          name: 'L1',
          options: { expression: `CONCATENATE({${childLookupFieldId}}, "-L1")` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const parent = await createRecord(harness, parentTable.id, {
      [parentNameFieldId]: 'Base',
    });
    // Fan-out (4 children) exceeds the dirty budget (2) in a single propagation hop,
    // exercising the shrink loop down to the unguarded single-step floor.
    const children = [];
    for (let i = 0; i < 4; i += 1) {
      children.push(
        await createRecord(harness, childTable.id, {
          Title: `C${i}`,
          [childLinkFieldId]: { id: parent.id },
        })
      );
    }

    await drainOutbox(harness);

    await updateRecord(harness, parentTable.id, parent.id, {
      [parentNameFieldId]: 'Base-updated',
    });

    const processed = await drainOutbox(harness);
    expect(processed).toBeGreaterThanOrEqual(2);

    const records = await listRecords(harness, childTable.id);
    for (const child of children) {
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      const lookup = cellText(
        parseArrayCell(row?.fields[childLookupFieldId])[0] ?? row?.fields[childLookupFieldId]
      );
      expect(lookup).toBe('Base-updated');
      expect(cellText(row?.fields[childL1FieldId])).toBe('Base-updated-L1');
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);
});
