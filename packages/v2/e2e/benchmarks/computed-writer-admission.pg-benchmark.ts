/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Opt-in, real PostgreSQL + Redis benchmark. Run only via ci-computed-writer-benchmark.sh.
 * Both revisions receive these exact fixture bytes; runtime classes come from the revision.
 * HTTP latency includes contention with real BullMQ handler/admission/worker execution.
 * This isolates the v2 HTTP router and host computed handler, excluding Nest authentication,
 * network ingress, BYODB routing discovery and production deployment topology.
 */
import { writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { loadPg, registerV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { getRandomString } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { expect, it } from 'vitest';
// oxlint-disable-next-line teable/no-legacy-core-import
import type * as BullMq from '../../../../apps/nestjs-backend/node_modules/bullmq';
// oxlint-disable-next-line teable/no-legacy-core-import
import type * as WriterModule from '../../../../apps/nestjs-backend/src/features/v2/computed-outbox-trigger/computed-writer-handle';
import { createE2eTestContainer } from '../src/shared/createE2eTestContainer';

const enabled = process.env.COMPUTED_WRITER_BENCH_RUN === '1';
const delay = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};
const fieldId = () => `fld${getRandomString(16)}`;
const rootCount = 8;
const requestsPerChain = 40;
const workerConcurrency = 8;
const poolMax = 4;
const convergenceTimeoutMs = 180_000;

type BaseFixture = {
  runtime: IV2NodeTestContainer;
  server: Server;
  url: string;
  label: string;
  base: 'heavy' | 'small';
  fanout: number;
  sourceId: string;
  targetId: string;
  amount: string;
  doubled: string;
  lookup: string;
  total: string;
  roots: string[];
  children: Map<string, number>;
  latenciesMs: number[];
};

const post = async (url: string, operation: string, payload: Record<string, unknown>) => {
  const response = await fetch(`${url}/tables/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(`${operation}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const setup = async (
  runtime: IV2NodeTestContainer,
  base: 'heavy' | 'small',
  chain: number,
  fanout: number
): Promise<BaseFixture> => {
  const label = `${base}-${chain}`;
  const app = express();
  app.use(createV2ExpressRouter({ createContainer: () => runtime.container }));
  const listeningResult = Promise.withResolvers<Server>();
  const listening = app.listen(0, '127.0.0.1', () => listeningResult.resolve(listening));
  listening.once('error', listeningResult.reject);
  const server = await listeningResult.promise;
  server.keepAliveTimeout = 0;
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // All resources are tracked before fixture creation so errors still close the server.
  servers.push(server);
  const name = fieldId(),
    amount = fieldId(),
    doubled = fieldId();
  const link = fieldId(),
    lookup = fieldId(),
    total = fieldId();
  const source = createTableOkResponseSchema.parse(
    await post(url, 'create', {
      baseId: runtime.baseId.toString(),
      name: `${label} source`,
      fields: [
        { id: name, name: 'Name', type: 'singleLineText', isPrimary: true },
        { id: amount, name: 'Amount', type: 'number' },
        {
          id: doubled,
          name: 'Doubled',
          type: 'formula',
          options: { expression: `{${amount}} * 2` },
        },
      ],
      views: [{ type: 'grid' }],
    })
  ).data.table;
  const target = createTableOkResponseSchema.parse(
    await post(url, 'create', {
      baseId: runtime.baseId.toString(),
      name: `${label} target`,
      fields: [
        { name: 'Title', type: 'singleLineText', isPrimary: true },
        {
          id: link,
          name: 'Source',
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: source.id,
            lookupFieldId: name,
          },
        },
        {
          id: lookup,
          name: 'Lookup',
          type: 'lookup',
          options: {
            linkFieldId: link,
            foreignTableId: source.id,
            lookupFieldId: doubled,
          },
        },
        {
          id: total,
          name: 'Total',
          type: 'formula',
          options: { expression: `SUM({${lookup}}) * 10` },
        },
      ],
      views: [{ type: 'grid' }],
    })
  ).data.table;
  const roots = createRecordsOkResponseSchema
    .parse(
      await post(url, 'createRecords', {
        tableId: source.id,
        records: Array.from({ length: rootCount }, (_, index) => ({
          fields: { [name]: `root-${index}`, [amount]: index + 1 },
        })),
      })
    )
    .data.records.map((record) => record.id);
  const children = new Map<string, number>();
  for (let root = 0; root < rootCount; root++) {
    const records = createRecordsOkResponseSchema.parse(
      await post(url, 'createRecords', {
        tableId: target.id,
        records: Array.from({ length: fanout }, (_, index) => ({
          fields: { Title: `${root}/${index}`, [link]: { id: roots[root] } },
        })),
      })
    ).data.records;
    for (const record of records) children.set(record.id, root);
  }
  return {
    runtime,
    server,
    url,
    label,
    base,
    fanout,
    sourceId: source.id,
    targetId: target.id,
    amount,
    doubled,
    lookup,
    total,
    roots,
    children,
    latenciesMs: [],
  };
};

const servers: Server[] = [];

const readStored = async (fixture: BaseFixture, tableId: string, fieldIds: string[]) => {
  const table = await sql<{ db_table_name: string }>`SELECT db_table_name FROM table_meta
    WHERE id = ${tableId}`.execute(fixture.runtime.db);
  const fields = await fixture.runtime.db
    .selectFrom('field')
    .select(['id', 'db_field_name'])
    .where('id', 'in', fieldIds)
    .execute();
  const columns = new Map(fields.map((field) => [field.id, field.db_field_name]));
  return sql<{ id: string; [key: string]: unknown }>`SELECT __id AS id,
    ${sql.join(fieldIds.map((id) => sql`${sql.ref(columns.get(id)!)} AS ${sql.id(id)}`))}
    FROM ${sql.table(table.rows[0].db_table_name)}`.execute(fixture.runtime.db);
};

const totals = async (fixture: BaseFixture, epoch: number) => {
  const source = await readStored(fixture, fixture.sourceId, [fixture.amount, fixture.doubled]);
  const target = await readStored(fixture, fixture.targetId, [fixture.lookup, fixture.total]);
  let mismatches = 0;
  for (const row of source.rows) {
    const root = fixture.roots.indexOf(row.id);
    const amount = epoch * 100 + root + 1;
    if (
      root < 0 ||
      Number(row[fixture.amount]) !== amount ||
      Number(row[fixture.doubled]) !== amount * 2
    )
      mismatches++;
  }
  for (const row of target.rows) {
    const root = fixture.children.get(row.id);
    const expected = epoch * 100 + (root ?? -1) + 1;
    const raw = row[fixture.lookup];
    const lookup = typeof raw === 'string' && raw.startsWith('[') ? JSON.parse(raw) : raw;
    if (
      root === undefined ||
      Number(Array.isArray(lookup) ? lookup[0] : lookup) !== expected * 2 ||
      Number(row[fixture.total]) !== expected * 20
    )
      mismatches++;
  }
  const expectedTotal =
    fixture.fanout * 20 * (rootCount * epoch * 100 + (rootCount * (rootCount + 1)) / 2);
  const actualTotal = target.rows.reduce((sum, row) => sum + Number(row[fixture.total]), 0);
  return {
    base: fixture.base,
    chain: fixture.label,
    sourceRecords: source.rows.length,
    targetRecords: target.rows.length,
    expectedSourceRecords: rootCount,
    expectedTargetRecords: rootCount * fixture.fanout,
    mismatches,
    expectedTotal,
    actualTotal,
  };
};

const quantile = (samples: number[], fraction: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};

it.skipIf(!enabled)(
  'compares two bases sharing a writer through external production scheduling',
  async () => {
    if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Remote Actions benchmark only');
    const connectionString = process.env.COMPUTED_WRITER_BENCH_DATABASE_URL;
    const redisUrl = process.env.COMPUTED_WRITER_BENCH_REDIS_URL;
    const artifact = process.env.COMPUTED_WRITER_BENCH_ARTIFACT;
    if (!connectionString || !redisUrl || !artifact)
      throw new Error('Dedicated PG, Redis and artifact required');
    const endpoint = new URL(connectionString);
    if (!endpoint.pathname.startsWith('/computed_writer_bench_'))
      throw new Error('Dedicated benchmark DB required');

    // This fixture lives outside normal e2e TS/test discovery. Resolve host-only dependencies
    // from this revision's backend install; only the paired CI runner installs that closure.
    const backendRequire = createRequire(
      new URL('../../../../apps/nestjs-backend/package.json', import.meta.url)
    );
    const { Queue, Worker } = backendRequire('bullmq') as typeof BullMq;
    const { ComputedOutboxWakeupHandler } = await import(
      // oxlint-disable-next-line teable/no-legacy-core-import
      '../../../../apps/nestjs-backend/src/features/v2/computed-outbox-trigger/computed-outbox-wakeup.handler'
    );
    const { ComputedOutboxBaseAdmissionService } = await import(
      // oxlint-disable-next-line teable/no-legacy-core-import
      '../../../../apps/nestjs-backend/src/features/v2/computed-outbox-trigger/computed-outbox-base-admission.service'
    );
    const { ComputedOutboxTriggerMetrics } = await import(
      // oxlint-disable-next-line teable/no-legacy-core-import
      '../../../../apps/nestjs-backend/src/features/v2/computed-outbox-trigger/computed-outbox-trigger.metrics'
    );
    const { BullMqComputedOutboxWakeupPublisher } = await import(
      // oxlint-disable-next-line teable/no-legacy-core-import
      '../../../../apps/nestjs-backend/src/features/v2/computed-outbox-trigger/bullmq-computed-outbox-wakeup.publisher'
    );
    const { COMPUTED_OUTBOX_WAKEUP_QUEUE } = await import(
      // oxlint-disable-next-line teable/no-legacy-core-import
      '../../../../apps/nestjs-backend/src/features/v2/computed-outbox-trigger/constants'
    );
    const { createRoleAwareWakeupPublisher } = await import(
      // oxlint-disable-next-line teable/no-legacy-core-import
      '../../../../apps/nestjs-backend/src/features/v2/computed-outbox-trigger/computed-outbox-wakeup-producer.module'
    );
    // Develop has no writer admission. Load only the candidate's own production factory.
    const writerModule: typeof WriterModule | undefined =
      process.env.COMPUTED_WRITER_BENCH_LABEL === 'candidate'
        ? await import(
            /* @vite-ignore */ backendRequire.resolve(
              './src/features/v2/computed-outbox-trigger/computed-writer-handle.ts'
            )
          )
        : undefined;
    const pg = await loadPg();
    const pool = new pg.Pool({ connectionString, max: poolMax, connectionTimeoutMillis: 30_000 });
    const writer = writerModule?.createComputedWriterHandle(pool, connectionString);
    const redis = new URL(redisUrl);
    const connection = {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      maxRetriesPerRequest: null,
    };
    const prefix = `computed-writer-bench-${getRandomString(12)}`;
    // Admission and queue locators use the same isolated namespace.
    process.env.BACKEND_QUEUE_PREFIX = prefix;
    const queue = new Queue(COMPUTED_OUTBOX_WAKEUP_QUEUE, { connection, prefix });
    const metrics = new ComputedOutboxTriggerMetrics();
    const publisher = new BullMqComputedOutboxWakeupPublisher(queue, metrics);
    const appPublisher = createRoleAwareWakeupPublisher(publisher, {
      producerEnabled: true,
      consumerEnabled: true,
    });
    const admission = new ComputedOutboxBaseAdmissionService(queue);
    const runtimes: IV2NodeTestContainer[] = [];
    const byBase = new Map<string, IV2NodeTestContainer>();
    const failures: string[] = [];
    let peakPoolWaiters = 0;
    const observer = setInterval(() => {
      peakPoolWaiters = Math.max(peakPoolWaiters, pool.waitingCount);
    }, 5);
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: async (baseId: string) => {
          const runtime = byBase.get(baseId);
          if (!runtime) throw new Error(`Unknown fixture base ${baseId}`);
          return runtime.container;
        },
        ...(writer && { getComputedWriter: () => writer }),
      } as never,
      metrics,
      appPublisher,
      admission
    );
    const worker = new Worker(
      COMPUTED_OUTBOX_WAKEUP_QUEUE,
      async (job) => handler.handle(job.data),
      { connection, prefix, concurrency: workerConcurrency }
    );
    worker.on('failed', (_job, error) => {
      failures.push(error.message);
    });
    worker.on('error', (error) => {
      failures.push(error.message);
    });
    const waitForConvergence = async (fixtures: BaseFixture[], epoch: number) => {
      const started = performance.now();
      let last;
      do {
        if (failures.length) throw new Error(`BullMQ failures: ${failures.join('; ')}`);
        const checked = await Promise.all(fixtures.map((fixture) => totals(fixture, epoch)));
        const queueState = await sql<{ pending: number; dead: number }>`SELECT
        (SELECT count(*)::int FROM computed_update_outbox WHERE base_id IN (${sql.join([...byBase.keys()])})) AS pending,
        (SELECT count(*)::int FROM computed_update_dead_letter WHERE base_id IN (${sql.join([...byBase.keys()])})) AS dead`.execute(
          runtimes[0].db
        );
        last = { checked, queue: queueState.rows[0] };
        if (last.queue.dead) throw new Error(`Computed dead letters: ${JSON.stringify(last)}`);
        if (
          !last.queue.pending &&
          checked.every(
            (value) =>
              value.mismatches === 0 &&
              value.sourceRecords === value.expectedSourceRecords &&
              value.targetRecords === value.expectedTargetRecords &&
              value.actualTotal === value.expectedTotal
          )
        )
          return last;
        await delay(20);
      } while (performance.now() - started < convergenceTimeoutMs);
      throw new Error(`Convergence timeout: ${JSON.stringify(last)}`);
    };
    try {
      await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
      // Warm both pools identically. Exercise the live reserve before starting measurement.
      const clients: { release(): void }[] = [];
      try {
        for (let used = 1; used <= 3; used++) {
          clients.push(await pool.connect());
          expect(pool.waitingCount).toBe(0);
          if (writer) expect(writer.hasWaiters()).toBe(used === 3);
        }
      } finally {
        for (const client of clients) client.release();
      }
      for (let index = 0; index < 2; index++) {
        const runtime = await createE2eTestContainer({
          dbMode: 'postgres',
          connectionString,
          registerDb: (container, config) => registerV2PostgresDb(container, config, { pool }),
          computedUpdate: {
            mode: 'hybrid',
            hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
            wakeupPublisher: appPublisher,
          },
        });
        runtimes.push(runtime);
        byBase.set(runtime.baseId.toString(), runtime);
      }
      // Independent seed tables exceed the per-seed cap (1) and shared writer cap (2).
      // Three heavy chains plus one small chain contend on a single four-client pool.
      const fixtures = [
        await setup(runtimes[0], 'heavy', 0, 64),
        await setup(runtimes[0], 'heavy', 1, 64),
        await setup(runtimes[0], 'heavy', 2, 64),
        await setup(runtimes[1], 'small', 0, 8),
      ];
      await waitForConvergence(fixtures, 0);
      const mutate = async (fixture: BaseFixture, epoch: number, measured: boolean) => {
        const started = performance.now();
        await post(fixture.url, 'updateRecords', {
          tableId: fixture.sourceId,
          records: fixture.roots.map((id, root) => ({
            id,
            fields: { [fixture.amount]: epoch * 100 + root + 1 },
          })),
        });
        if (measured) fixture.latenciesMs.push(performance.now() - started);
      };
      await Promise.all(fixtures.map((fixture) => mutate(fixture, 1, false)));
      await waitForConvergence(fixtures, 1);
      peakPoolWaiters = 0;
      const before = await sql<{
        lsn: string;
      }>`SELECT pg_current_wal_insert_lsn()::text AS lsn`.execute(runtimes[0].db);
      const started = performance.now();
      const completedAt = new Map<string, number>();
      await Promise.all(
        fixtures.map(async (fixture) => {
          for (let request = 0; request < requestsPerChain; request++)
            await mutate(fixture, request + 2, true);
          completedAt.set(fixture.label, performance.now());
        })
      );
      const foregroundFinishedAt = performance.now();
      const result = await waitForConvergence(fixtures, requestsPerChain + 1);
      const convergedAt = performance.now();
      const after = await sql<{
        bytes: string;
      }>`SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${before.rows[0].lsn}::pg_lsn)::text AS bytes`.execute(
        runtimes[0].db
      );
      const output = {
        schemaVersion: 1,
        revision: process.env.COMPUTED_WRITER_BENCH_REVISION,
        label: process.env.COMPUTED_WRITER_BENCH_LABEL,
        fixtureVersion: 'two-base-writer-v1',
        fixture: {
          rootCount,
          fanout: [64, 64, 64, 8],
          chainsPerBase: [3, 1],
          requestsPerChain,
          poolMax,
          workerConcurrency,
        },
        scheduling:
          'real BullMQ Worker -> production wakeup handler -> real Redis base/writer admission -> real PG worker',
        boundary:
          'v2 HTTP router + production handler/admission; routing map supplied by fixture; shared injected PG pool; excludes Nest auth/ingress and deployment topology',
        foreground: (['heavy', 'small'] as const).map((base) => {
          const chains = fixtures.filter((fixture) => fixture.base === base);
          const samplesMs = chains.flatMap((fixture) => fixture.latenciesMs);
          return {
            base,
            requests: samplesMs.length,
            semantics:
              'HTTP updateRecords start through parsed successful response; worker runs concurrently; setup and one warmup request per chain excluded; heavy has three concurrent chains, small one',
            p50Ms: quantile(samplesMs, 0.5),
            p95Ms: quantile(samplesMs, 0.95),
            p99Ms: quantile(samplesMs, 0.99),
            samplesMs,
            durationMs:
              Math.max(...chains.map((fixture) => completedAt.get(fixture.label)!)) - started,
          };
        }),
        walBytes: after.rows[0].bytes,
        walSemantics:
          'cluster-wide WAL insert LSN delta from first measured writes until both bases converge; excludes setup/warmup; dedicated PG cluster required; includes measured HTTP/worker/activity writes',
        timeToConvergenceMs: convergedAt - started,
        postForegroundConvergenceMs: convergedAt - foregroundFinishedAt,
        convergenceSemantics:
          'first measured HTTP start to final source/formula/lookup values and exact totals in both bases plus empty scoped outbox; 20ms polling, reads included',
        peakPoolWaiters,
        totals: result.checked,
        outbox: result.queue,
        queueFailures: failures,
      };
      writeFileSync(artifact, JSON.stringify(output, null, 2));
      expect(output.foreground.map((sample) => sample.requests)).toEqual([
        3 * requestsPerChain,
        requestsPerChain,
      ]);
      expect(failures).toEqual([]);
    } finally {
      clearInterval(observer);
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      for (const server of servers.splice(0)) {
        const closed = Promise.withResolvers<void>();
        server.close((error) => (error ? closed.reject(error) : closed.resolve()));
        await closed.promise;
      }
      for (const runtime of runtimes.reverse()) await runtime.dispose();
      await pool.end();
    }
  },
  600_000
);
