/* eslint-disable @typescript-eslint/naming-convention */
import { writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
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
    dbMode: process.env.FRONTIER_DATABASE_URL ? 'postgres' : 'pglite',
    ...(process.env.FRONTIER_DATABASE_URL
      ? { connectionString: process.env.FRONTIER_DATABASE_URL }
      : {}),
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

const work = (harness: TestHarness, tableId: string) => {
  const plans = harness.testContainer.spyLogger.getComputedPlans();
  const stats = harness.testContainer.spyLogger.getEntriesByMessage('computed:dirtyStats');
  let candidateRows = 0;
  for (const stat of stats) {
    const tables = stat.context?.affectedTables;
    if (!Array.isArray(tables)) continue;
    for (const table of tables) {
      if (
        typeof table === 'object' &&
        table !== null &&
        'tableId' in table &&
        table.tableId === tableId &&
        'recordCount' in table
      ) {
        candidateRows += Number(table.recordCount);
      }
    }
  }
  return {
    candidateRows,
    executedPlans: plans.length,
    downstreamSteps: plans.reduce(
      (total, plan) => total + plan.steps.filter((step) => step.tableId === tableId).length,
      0
    ),
  };
};

describe('stage-final actual value frontier through the production worker', () => {
  it.each([false, true])(
    'preserves mixed-row values and versions (tiny dirty budget=%s)',
    async (tinyBudget) => {
      const harness = await createHarness({
        stageMaxSteps: 1,
        stageSmallRunComplexityThreshold: 0,
        ...(tinyBudget ? { stageMaxDirtyRecords: 3, seedInlineLimit: 2 } : {}),
      });
      const rootCount = Number(process.env.FRONTIER_ROOTS ?? 8);
      const fanout = Number(process.env.FRONTIER_FANOUT ?? 8);
      expect(rootCount * fanout).toBeLessThanOrEqual(1000);
      const title = createFieldId();
      const amount = createFieldId();
      const rounded = createFieldId();
      const link = createFieldId();
      const lookup = createFieldId();
      const total = createFieldId();
      const source = await createTable(harness, {
        baseId: harness.baseId,
        name: 'Frontier sources',
        fields: [
          { id: title, name: 'Name', type: 'singleLineText', isPrimary: true },
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
        name: 'Frontier targets',
        fields: [
          { name: 'Title', type: 'singleLineText', isPrimary: true },
          {
            id: link,
            name: 'Source',
            type: 'link',
            options: { relationship: 'manyOne', foreignTableId: source.id, lookupFieldId: title },
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
      const rootByChild = new Map<string, number>();
      const rootIds: string[] = [];
      for (let root = 0; root < rootCount; root++) {
        const record = await createRecord(harness, source.id, {
          [title]: `Root ${root}`,
          [amount]: root === 0 ? 1.8 : 1.1,
        });
        rootIds.push(record.id);
        for (let child = 0; child < fanout; child++) {
          const row = await createRecord(harness, target.id, {
            Title: `${root}/${child}`,
            [link]: { id: record.id },
          });
          rootByChild.set(row.id, root);
        }
      }
      await drain(harness);
      const initialRows = await listRecords(harness, target.id);
      expect(initialRows).toHaveLength(rootCount * fanout);
      for (const row of initialRows)
        expect(row.fields[total]).toBe(rootByChild.get(row.id) === 0 ? 20 : 10);
      const samples = [];
      const repetitions = Number(process.env.FRONTIER_SAMPLES ?? 1);
      for (let repetition = 0; repetition < repetitions; repetition++) {
        if (repetition > 0) {
          const reset = await fetch(`${harness.baseUrl}/tables/updateRecords`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              tableId: source.id,
              records: rootIds.map((id, index) => ({
                id,
                fields: { [amount]: index === 0 ? 1.8 : 1.1 },
              })),
            }),
          });
          expect(reset.status, await reset.text()).toBe(200);
          await drain(harness);
        }
        for (const [scenario, nextAmount, expectedValue] of [
          ['mixed', 1.2, 10],
          ['unchanged', 1.3, 10],
          ['all-changed', 2.1, 20],
        ] as const) {
          const before = await versions(harness, target.id);
          harness.testContainer.spyLogger.clear();
          const started = performance.now();
          const response = await fetch(`${harness.baseUrl}/tables/updateRecords`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              tableId: source.id,
              recordIds: rootIds,
              fields: { [amount]: nextAmount },
            }),
          });
          const body = await response.json();
          expect(response.status, JSON.stringify(body)).toBe(200);
          const tasks = await drain(harness);
          const elapsedMs = performance.now() - started;
          const after = await versions(harness, target.id);
          const rows = await listRecords(harness, target.id);
          expect(rows).toHaveLength(rootCount * fanout);
          let changedVersions = 0;
          for (const row of rows) {
            expect(row.fields[total]).toBe(expectedValue);
            const cell = row.fields[lookup];
            const parsed =
              typeof cell === 'string' && cell.startsWith('[') ? JSON.parse(cell) : cell;
            expect(Number(Array.isArray(parsed) ? parsed[0] : parsed)).toBe(expectedValue / 10);
            const expectedChange =
              scenario === 'all-changed' || (scenario === 'mixed' && rootByChild.get(row.id) === 0);
            if (expectedChange) {
              expect(after.get(row.id)).toBe(before.get(row.id)! + 2);
              changedVersions++;
            } else expect(after.get(row.id)).toBe(before.get(row.id));
          }
          const metrics = work(harness, target.id);
          samples.push({
            repetition,
            elapsedMs,
            scenario,
            tasks,
            ...metrics,
            changedVersions,
            records: rows.length,
            versionHistogram: Object.fromEntries(
              [...new Set(after.values())]
                .sort((a, b) => a - b)
                .map((version) => [
                  version,
                  [...after.values()].filter((value) => value === version).length,
                ])
            ),
          });
          if (scenario === 'mixed' && process.env.FRONTIER_EXPECT_BASELINE !== '1') {
            expect(metrics.candidateRows).toBeGreaterThan(0);
            expect(metrics.candidateRows).toBeLessThan(rootCount * fanout);
          }
        }
      }
      const dead = await sql<{
        count: number;
      }>`SELECT COUNT(*)::integer AS count FROM computed_update_dead_letter`.execute(
        harness.testContainer.db
      );
      expect(dead.rows[0].count).toBe(0);
      if (process.env.FRONTIER_ARTIFACT_PATH)
        writeFileSync(
          `${process.env.FRONTIER_ARTIFACT_PATH}${tinyBudget ? '-tiny' : ''}.json`,
          JSON.stringify(
            {
              rootCount,
              fanout,
              tinyBudget,
              engine: process.env.FRONTIER_DATABASE_URL ? 'postgres' : 'pglite',
              baseline: process.env.FRONTIER_EXPECT_BASELINE === '1',
              samples,
            },
            null,
            2
          )
        );
    },
    120_000
  );
});
