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

  it('converges a lookup + formula chain split across multiple bounded stages', async () => {
    // Disable small-run scaling so stageMaxSteps=1 actually splits; production
    // explicit-seed updates may now probe multiple levels in one abort-mode stage.
    const harness = await createHarness({
      stageMaxSteps: 1,
      stageSmallRunComplexityThreshold: 0,
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
    // AJ-shaped lifecycle: one parent field fans out through THREE separate
    // link/lookup pairs (3 edges into 3 lookup fields) under stageMaxEdges=2,
    // so the plan chunks; stageMaxDirtyRecords=2 forces floor partial batches,
    // migrating and retiring the parent seed through the ledger frontier.
    // Half the children are reachable ONLY via the third link — the edge that
    // runs in the deferred chunk. Without consumed-source preservation the
    // deferred chunk would have no parent seeds left and those rows would stay
    // stale forever.
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

    const parent = await createRecord(harness, parentTable.id, {
      [parentNameFieldId]: 'Fan',
    });
    // 3 children linked via ALL links; 3 linked ONLY via the last link.
    const allLinkChildren = [];
    for (let i = 0; i < 3; i += 1) {
      allLinkChildren.push(
        await createRecord(harness, childTable.id, {
          Title: `All${i}`,
          [linkFieldIds[0]]: { id: parent.id },
          [linkFieldIds[1]]: { id: parent.id },
          [linkFieldIds[2]]: { id: parent.id },
        })
      );
    }
    const lastLinkChildren = [];
    for (let i = 0; i < 3; i += 1) {
      lastLinkChildren.push(
        await createRecord(harness, childTable.id, {
          Title: `Last${i}`,
          [linkFieldIds[2]]: { id: parent.id },
        })
      );
    }

    await drainOutbox(harness);

    await updateRecord(harness, parentTable.id, parent.id, {
      [parentNameFieldId]: 'Fan-updated',
    });

    // Chunked edges + floor partial batches: several tasks must run.
    const processed = await drainOutbox(harness);
    expect(processed).toBeGreaterThanOrEqual(2);

    const records = await listRecords(harness, childTable.id);
    for (const child of allLinkChildren) {
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      for (const lookupFieldId of lookupFieldIds) {
        const lookup = cellText(
          parseArrayCell(row?.fields[lookupFieldId])[0] ?? row?.fields[lookupFieldId]
        );
        expect(lookup).toBe('Fan-updated');
      }
    }
    // The rows only the deferred chunk's edge reaches must not be stale.
    for (const child of lastLinkChildren) {
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      const lookup = cellText(
        parseArrayCell(row?.fields[lookupFieldIds[2]])[0] ?? row?.fields[lookupFieldIds[2]]
      );
      expect(lookup).toBe('Fan-updated');
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
