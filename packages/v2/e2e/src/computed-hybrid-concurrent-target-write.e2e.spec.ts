/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T6300 — hybrid dual-worker concurrent writeback must not leave stale formulas.
 *
 * Sanitized structure-equivalent of the perf-lab race:
 * - Parent table (users) with a text source field
 * - Child table (orders) with status, link, lookup of parent text, and a same-table
 *   formula chain that reads the stored lookup column
 * - Hybrid outbox with per-base concurrency >= 2
 * - Concurrent parent update + child update processed by two workers in parallel
 *
 * Retained structural facts only (no customer ids/values):
 * - Cross-table lookup + multi-level same-table formulas on the child
 * - Different seed tables whose computed write targets overlap
 * - Dual workers claiming distinct seed tasks for the same base
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
} from '../../adapter-table-repository-postgres/src';
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

const listRecordsWithoutDrain = async (
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

const waitForOutboxQuiesce = async (harness: TestHarness, rounds = 80) => {
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

    // Lock-unavailable requeues schedule next_run_at a few hundred ms in the future.
    // Sleep so claimBatch can pick them up instead of exiting while status=pending.
    if (pending > 0) {
      await new Promise((resolve) => setTimeout(resolve, 300));
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

describe('computed hybrid concurrent target writeback (e2e) T6300', () => {
  it('converges lookup + formula chain after dual-worker parent/child updates', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: {
          dispatchMode: 'external',
          // Force full async so parent and child seeds become concurrent outbox tasks.
          syncPolicy: 'none',
        },
        outboxConfig: {
          maxConcurrentProcessingPerBase: 2,
          maxConcurrentProcessingPerSeedTable: 2,
        },
      },
    });

    const parentNameFieldId = createFieldId();
    const childStatusFieldId = createFieldId();
    const childLinkFieldId = createFieldId();
    const childLookupFieldId = createFieldId();
    const profileSeedFieldId = createFieldId();
    const profileL2FieldId = createFieldId();
    const profileL3FieldId = createFieldId();
    const orderCardFieldId = createFieldId();

    const parentTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Parents',
      fields: [
        { type: 'singleLineText', id: parentNameFieldId, name: 'FirstName', isPrimary: true },
      ],
      views: [{ type: 'grid' }],
    });

    const childTable = await createTable(harness, {
      baseId: harness.baseId,
      name: 'Children',
      fields: [
        { type: 'singleLineText', id: childStatusFieldId, name: 'Status', isPrimary: true },
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
          id: profileSeedFieldId,
          name: 'ProfileSeed',
          options: {
            expression: `{${childLookupFieldId}}`,
          },
        },
        {
          type: 'formula',
          id: profileL2FieldId,
          name: 'ProfileL2',
          options: {
            expression: `CONCATENATE({${profileSeedFieldId}}, "-L2")`,
          },
        },
        {
          type: 'formula',
          id: profileL3FieldId,
          name: 'ProfileL3',
          options: {
            expression: `CONCATENATE({${profileL2FieldId}}, "-L3")`,
          },
        },
        {
          type: 'formula',
          id: orderCardFieldId,
          name: 'OrderCard',
          options: {
            expression: `CONCATENATE({${childStatusFieldId}}, "|", {${profileL3FieldId}})`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const parent = await createRecord(harness, parentTable.id, {
      [parentNameFieldId]: 'First-020',
    });
    const child = await createRecord(harness, childTable.id, {
      [childStatusFieldId]: 'Open',
      [childLinkFieldId]: { id: parent.id },
    });

    await waitForOutboxQuiesce(harness);

    const baseline = await listRecordsWithoutDrain(harness, childTable.id);
    const baselineChild = baseline.find((record) => record.id === child.id);
    expect(baselineChild).toBeDefined();
    expect(
      cellText(
        parseArrayCell(baselineChild?.fields[childLookupFieldId])[0] ??
          baselineChild?.fields[childLookupFieldId]
      )
    ).toContain('First-020');
    expect(cellText(baselineChild?.fields[orderCardFieldId])).toContain('Open|First-020');

    // Enqueue two independent seed tasks that both write the child computed columns.
    await updateRecord(harness, parentTable.id, parent.id, {
      [parentNameFieldId]: 'First-020-updated',
    });
    await updateRecord(harness, childTable.id, child.id, {
      [childStatusFieldId]: 'Paid',
    });

    const pendingBefore = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt
      FROM computed_update_outbox
      WHERE status = 'pending'
    `.execute(harness.testContainer.db);
    expect(Number(pendingBefore.rows[0]?.cnt ?? 0)).toBeGreaterThanOrEqual(2);

    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;

    // Dual workers claim distinct seed-table tasks under base concurrency=2.
    const [first, second] = await Promise.all([
      worker.runOnce({ workerId: 't6300-worker-a', limit: 1 }),
      worker.runOnce({ workerId: 't6300-worker-b', limit: 1 }),
    ]);
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);

    await waitForOutboxQuiesce(harness);

    const expectedCard = 'Paid|First-020-updated-L2-L3';
    const expectedLookup = 'First-020-updated';

    const assertConverged = async () => {
      const records = await listRecordsWithoutDrain(harness, childTable.id);
      const row = records.find((record) => record.id === child.id);
      expect(row).toBeDefined();
      const lookup = cellText(
        parseArrayCell(row?.fields[childLookupFieldId])[0] ?? row?.fields[childLookupFieldId]
      );
      const seed = cellText(row?.fields[profileSeedFieldId]);
      const l2 = cellText(row?.fields[profileL2FieldId]);
      const l3 = cellText(row?.fields[profileL3FieldId]);
      const card = cellText(row?.fields[orderCardFieldId]);

      expect(lookup).toBe(expectedLookup);
      expect(seed).toBe(expectedLookup);
      expect(l2).toBe(`${expectedLookup}-L2`);
      expect(l3).toBe(`${expectedLookup}-L2-L3`);
      expect(card).toBe(expectedCard);
    };

    await assertConverged();

    // Stability window: values must not regress after outbox is empty.
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await assertConverged();
    }

    const dead = await sql<{ cnt: number }>`
      SELECT count(*)::int as cnt FROM computed_update_dead_letter
    `.execute(harness.testContainer.db);
    expect(Number(dead.rows[0]?.cnt ?? 0)).toBe(0);
  }, 120_000);
});
