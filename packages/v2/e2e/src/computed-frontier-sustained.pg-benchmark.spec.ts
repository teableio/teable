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
import { afterEach, expect, it } from 'vitest';

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
  outboxConfig: Record<string, number> = { stageMaxSteps: 1 },
  fieldBackfillConfig?: { mode: 'async' }
): Promise<TestHarness> => {
  const testContainer = await createE2eTestContainer({
    dbMode: 'postgres',
    ...(process.env.FRONTIER_SUSTAIN_DATABASE_URL
      ? { connectionString: process.env.FRONTIER_SUSTAIN_DATABASE_URL }
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

const enabled = process.env.FRONTIER_SUSTAIN_RUN === '1';
const concurrency = Number(process.env.FRONTIER_SUSTAIN_CONCURRENCY ?? 4);
const durationMs = Number(process.env.FRONTIER_SUSTAIN_SECONDS ?? 60) * 1000;
const profiles = (
  process.env.FRONTIER_SUSTAIN_PROFILES ?? 'terminal,unchanged,mixed,allchanged'
).split(',');
const rootCount = 8;
const fanout = 8;

type Chain = {
  harness: TestHarness;
  sourceId: string;
  targetId?: string;
  amount: string;
  rounded: string;
  lookup: string;
  total: string;
  roots: string[];
  childRoot: Map<string, number>;
};

const snapshotVersions = async (chain: Chain) => {
  const target = chain.targetId ?? chain.sourceId;
  const result = await sql<{ id: string; version: number }>`SELECT __id AS id, __version AS version
    FROM ${sql.table(`${chain.harness.baseId}.${target}`)}`.execute(chain.harness.testContainer.db);
  return new Map(result.rows.map((row) => [row.id, row.version]));
};

const drainConcurrent = async (harness: TestHarness) => {
  const worker = harness.testContainer.container.resolve(
    v2RecordRepositoryPostgresTokens.computedUpdateWorker
  ) as ComputedUpdateWorker;
  let tasks = 0;
  for (let round = 0; round < 1000; round++) {
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        worker.runOnce({ workerId: `frontier-sustain-${index}`, limit: 1 })
      )
    );
    for (const result of results) tasks += result._unsafeUnwrap();
    const pending = await sql<{
      count: number;
    }>`SELECT COUNT(*)::integer AS count FROM computed_update_outbox
      WHERE status IN ('pending','processing')`.execute(harness.testContainer.db);
    if (pending.rows[0].count === 0) return tasks;
    if (results.every((result) => result._unsafeUnwrap() === 0))
      await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Concurrent worker did not drain');
};

const stats = async (harness: TestHarness) => {
  await sql`SELECT pg_stat_clear_snapshot()`.execute(harness.testContainer.db);
  const tables = await sql`SELECT relname, n_live_tup, n_dead_tup, n_tup_ins, n_tup_del,
    vacuum_count, autovacuum_count, last_autovacuum,
    pg_total_relation_size(relid)::text AS total_bytes
    FROM pg_stat_user_tables WHERE relname IN ('computed_update_change_frontier', 'computed_update_stage_ledger')
    ORDER BY relname`.execute(harness.testContainer.db);
  const actual =
    await sql`SELECT COUNT(*)::integer AS rows FROM computed_update_change_frontier`.execute(
      harness.testContainer.db
    );
  return { tables: tables.rows, actualFrontierRows: actual.rows };
};

const setupChain = async (harness: TestHarness, profile: string, index: number): Promise<Chain> => {
  const name = createFieldId(),
    amount = createFieldId(),
    rounded = createFieldId();
  const link = createFieldId(),
    lookup = createFieldId(),
    total = createFieldId();
  const source = await createTable(harness, {
    baseId: harness.baseId,
    name: `Sustain source ${index}`,
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
  const target =
    profile === 'terminal'
      ? undefined
      : await createTable(harness, {
          baseId: harness.baseId,
          name: `Sustain target ${index}`,
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
              name: 'Lookup',
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
  const roots: string[] = [],
    childRoot = new Map<string, number>();
  for (let root = 0; root < rootCount; root++) {
    const row = await createRecord(harness, source.id, { [name]: `Root ${root}`, [amount]: 1.1 });
    roots.push(row.id);
    if (target)
      for (let child = 0; child < fanout; child++) {
        const record = await createRecord(harness, target.id, {
          Title: `${root}/${child}`,
          [link]: { id: row.id },
        });
        childRoot.set(record.id, root);
      }
  }
  return {
    harness,
    sourceId: source.id,
    targetId: target?.id,
    amount,
    rounded,
    lookup,
    total,
    roots,
    childRoot,
  };
};

const input = (profile: string, epoch: number, root: number) =>
  profile === 'unchanged' || profile === 'terminal' || (profile === 'mixed' && root !== 0)
    ? epoch % 2
      ? 1.2
      : 1.1
    : epoch % 2
      ? 2.1
      : 1.1;

const mutate = async (chain: Chain, profile: string, epoch: number) => {
  const response = await fetch(`${chain.harness.baseUrl}/tables/updateRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tableId: chain.sourceId,
      records: chain.roots.map((id, root) => ({
        id,
        fields: { [chain.amount]: input(profile, epoch, root) },
      })),
    }),
  });
  expect(response.status, await response.text()).toBe(200);
};

it.skipIf(!enabled)(
  'sustains parallel independent chains and captures frontier maintenance costs',
  async () => {
    if (!process.env.FRONTIER_SUSTAIN_DATABASE_URL)
      throw new Error('Native dedicated benchmark database URL is required');
    const artifacts = [];
    for (const profile of profiles) {
      if (!['terminal', 'unchanged', 'mixed', 'allchanged'].includes(profile))
        throw new Error(`Unknown profile ${profile}`);
      const harness = await createHarness({
        stageMaxSteps: 1,
        stageSmallRunComplexityThreshold: 0,
        maxConcurrentProcessingPerBase: concurrency,
        maxConcurrentProcessingPerSeedTable: 1,
      });
      const chains: Chain[] = [];
      for (let index = 0; index < concurrency; index++)
        chains.push(await setupChain(harness, profile, index));
      await drainConcurrent(harness);
      for (let warmup = 1; warmup <= 2; warmup++) {
        await Promise.all(chains.map((chain) => mutate(chain, profile, warmup)));
        await drainConcurrent(harness);
      }
      // Exclude delayed setup/warmup statistics flushes from the counter window.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const beforeVersions = await Promise.all(chains.map(snapshotVersions));
      const beforeStats = await stats(harness);
      const lsn = await sql<{
        lsn: string;
      }>`SELECT pg_current_wal_insert_lsn()::text AS lsn`.execute(harness.testContainer.db);
      const buckets = new Map<number, number>();
      const rawFirst64: number[] = [];
      let cohorts = 0,
        tasks = 0,
        candidateRows = 0,
        downstreamCandidateRows = 0;
      const targetIds = new Set(chains.map((chain) => chain.targetId).filter(Boolean));
      const started = performance.now();
      while (performance.now() - started < durationMs) {
        const cohortStarted = performance.now();
        harness.testContainer.spyLogger.clear();
        await Promise.all(chains.map((chain) => mutate(chain, profile, cohorts + 3)));
        tasks += await drainConcurrent(harness);
        const elapsed = performance.now() - cohortStarted;
        const bucket = Math.ceil(elapsed);
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
        if (rawFirst64.length < 64) rawFirst64.push(elapsed);
        for (const entry of harness.testContainer.spyLogger.getEntriesByMessage(
          'computed:dirtyStats'
        )) {
          const tables = entry.context?.affectedTables;
          if (Array.isArray(tables))
            for (const table of tables) {
              if (typeof table === 'object' && table !== null && 'recordCount' in table) {
                candidateRows += Number(table.recordCount);
                if ('tableId' in table && targetIds.has(String(table.tableId)))
                  downstreamCandidateRows += Number(table.recordCount);
              }
            }
        }
        cohorts++;
      }
      const measuredMs = performance.now() - started;
      const wal = await sql<{
        bytes: string;
      }>`SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${lsn.rows[0].lsn}::pg_lsn)::text AS bytes`.execute(
        harness.testContainer.db
      );
      // PG statistics are asynchronous; allow backend flush before reading them.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const afterStats = await stats(harness);
      const correctness = [];
      for (let index = 0; index < chains.length; index++) {
        const chain = chains[index];
        const roots = await listRecords(harness, chain.sourceId);
        expect(roots).toHaveLength(rootCount);
        for (const row of roots) {
          const root = chain.roots.indexOf(row.id);
          const expected = input(profile, cohorts + 2, root);
          expect(row.fields[chain.amount]).toBe(expected);
          expect(row.fields[chain.rounded]).toBe(Math.round(expected));
        }
        const afterVersions = await snapshotVersions(chain);
        const rows = chain.targetId ? await listRecords(harness, chain.targetId) : roots;
        expect(rows).toHaveLength(chain.targetId ? rootCount * fanout : rootCount);
        for (const row of rows) {
          const root = chain.targetId ? chain.childRoot.get(row.id)! : chain.roots.indexOf(row.id);
          const changes = profile === 'allchanged' || (profile === 'mixed' && root === 0);
          const expectedDelta = chain.targetId ? (changes ? 2 * cohorts : 0) : cohorts;
          expect(afterVersions.get(row.id)! - beforeVersions[index].get(row.id)!).toBe(
            expectedDelta
          );
          if (chain.targetId) {
            const expected = Math.round(input(profile, cohorts + 2, root));
            const cell = row.fields[chain.lookup];
            const parsed =
              typeof cell === 'string' && cell.startsWith('[') ? JSON.parse(cell) : cell;
            expect(Number(Array.isArray(parsed) ? parsed[0] : parsed)).toBe(expected);
            expect(row.fields[chain.total]).toBe(expected * 10);
          }
        }
        correctness.push({ recordsVerified: rows.length, exactVersionsVerified: true });
      }
      const queues = await sql<{ pending: number; dead: number }>`SELECT
      (SELECT COUNT(*)::integer FROM computed_update_outbox) AS pending,
      (SELECT COUNT(*)::integer FROM computed_update_dead_letter) AS dead`.execute(
        harness.testContainer.db
      );
      expect(queues.rows).toEqual([{ pending: 0, dead: 0 }]);
      const histogram = [...buckets].sort(([a], [b]) => a - b);
      const percentile = (fraction: number) => {
        let count = 0;
        for (const [ms, frequency] of histogram) {
          count += frequency;
          if (count >= Math.ceil(cohorts * fraction)) return ms;
        }
        return 0;
      };
      artifacts.push({
        profile,
        mode: process.env.FRONTIER_SUSTAIN_LABEL ?? 'unspecified',
        concurrency,
        parallelWorkerIds: concurrency,
        rootCount,
        fanout: profile === 'terminal' ? 0 : fanout,
        durationMs: measuredMs,
        warmupCohortsExcluded: 2,
        cohorts,
        requests: cohorts * concurrency,
        requestsPerSecond: (cohorts * concurrency * 1000) / measuredMs,
        tasks,
        candidateRows,
        downstreamCandidateRows,
        latencySemantics:
          'cohort start through concurrent HTTP mutation and parallel worker quiescence barrier; all requests share completion; 1ms histogram ceiling resolution',
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        histogramMs: histogram,
        rawFirst64CohortMs: rawFirst64,
        walBytes: wal.rows[0].bytes,
        beforeStats,
        afterStats,
        correctness,
        queues: queues.rows,
        vacuumCaveat:
          'Inspect counter deltas; zero autovacuum delta means this run does not validate autovacuum behavior.',
      });
      if (process.env.FRONTIER_SUSTAIN_ARTIFACT)
        writeFileSync(process.env.FRONTIER_SUSTAIN_ARTIFACT, JSON.stringify(artifacts, null, 2));
      await harness.close();
    }
  },
  3_600_000
);
