/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T8158/T8163 — contention fragments converge through the real HTTP mutation and worker path.
 *
 * Sanitized structure: one source number drives one formula. A real PostgreSQL session holds
 * the seed-family outbox advisory lock while HTTP updates continue. Each write therefore takes
 * the nonblocking :nolock path. The deliberately old/high-complexity task must receive service
 * while cheaper fragments keep arriving; once the holder releases, one worker claim consolidates
 * the remaining family and the stored formula must equal the final source value.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
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

type Harness = {
  testContainer: IV2NodeTestContainer;
  baseId: string;
  baseUrl: string;
  close(): Promise<void>;
};

const activeHarnesses = new Set<Harness>();
const fieldId = () => `fld${getRandomString(16)}`;

const createHarness = async (): Promise<Harness> => {
  const testContainer = await createE2eTestContainer({
    dbMode: 'postgres',
    computedUpdate: {
      mode: 'hybrid',
      hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
      outboxConfig: {
        maxConcurrentProcessingPerBase: 1,
        maxConcurrentProcessingPerSeedTable: 1,
      },
    },
  });
  const app = express();
  app.use(createV2ExpressRouter({ createContainer: () => testContainer.container }));
  const { promise, resolve, reject } = Promise.withResolvers<Server>();
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  listening.once('error', reject);
  const server = await promise;
  server.keepAliveTimeout = 0;
  const address = server.address() as AddressInfo;
  const harness: Harness = {
    testContainer,
    baseId: testContainer.baseId.toString(),
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      const closed = Promise.withResolvers<void>();
      server.close((error) => (error ? closed.reject(error) : closed.resolve()));
      await closed.promise;
      await testContainer.dispose();
      activeHarnesses.delete(harness);
    },
  };
  activeHarnesses.add(harness);
  return harness;
};

afterEach(async () => {
  for (const harness of [...activeHarnesses]) await harness.close();
});

const post = async (harness: Harness, operation: string, payload: Record<string, unknown>) => {
  const response = await fetch(`${harness.baseUrl}/tables/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  expect(response.ok, JSON.stringify(body)).toBe(true);
  return body;
};

const drain = async (harness: Harness, worker: ComputedUpdateWorker) => {
  for (let round = 0; round < 50; round += 1) {
    const count = await sql<{ count: number }>`SELECT count(*)::int AS count
      FROM computed_update_outbox WHERE base_id = ${harness.baseId}`.execute(
      harness.testContainer.db
    );
    if (Number(count.rows[0]?.count ?? 0) === 0) return;
    const result = await worker.runOnce({ workerId: 't8158-t8163-drain', limit: 1 });
    if (result.isErr()) throw result.error;
  }
  throw new Error('Computed outbox did not settle within 50 rounds');
};

const holdFamilyLock = async (harness: Harness, key: string) => {
  const acquired = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const held = harness.testContainer.db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(
      ('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint
    )`.execute(trx);
    acquired.resolve();
    await release.promise;
  });
  await acquired.promise;
  return async () => {
    release.resolve();
    await held;
  };
};

type FamilyRow = {
  id: string;
  base_id: string;
  seed_table_id: string;
  plan_hash: string;
  change_type: string;
};

const familyRows = async (harness: Harness, row: FamilyRow) =>
  sql<FamilyRow>`SELECT id, base_id, seed_table_id, plan_hash, change_type
    FROM computed_update_outbox
    WHERE base_id = ${row.base_id}
      AND seed_table_id = ${row.seed_table_id}
      AND change_type = ${row.change_type}
      AND regexp_replace(plan_hash, ':nolock:cnm[A-Za-z0-9]{8}$', '') = ${row.plan_hash}
    ORDER BY created_at, id`.execute(harness.testContainer.db);

describe('[C14][S19] computed hot-family contention convergence (e2e) T8158 T8163', () => {
  it('services aged work during source arrivals and converges the final stored formula', async () => {
    const harness = await createHarness();
    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;
    try {
      const name = fieldId();
      const amount = fieldId();
      const doubled = fieldId();
      const table = createTableOkResponseSchema.parse(
        await post(harness, 'create', {
          baseId: harness.baseId,
          name: 'Hot Family Ledger',
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
      const record = createRecordOkResponseSchema.parse(
        await post(harness, 'createRecord', {
          tableId: table.id,
          fields: { [name]: 'row', [amount]: 1 },
        })
      ).data.record;
      await drain(harness, worker);
      const metadata = await sql<{ db_table_name: string }>`SELECT db_table_name
        FROM table_meta WHERE id = ${table.id}`.execute(harness.testContainer.db);
      const column = await sql<{ db_field_name: string }>`SELECT db_field_name
        FROM field WHERE id = ${doubled}`.execute(harness.testContainer.db);
      const readStoredDoubled = async (): Promise<number> => {
        const stored = await sql<{
          value: unknown;
        }>`SELECT ${sql.ref(column.rows[0].db_field_name)} AS value
          FROM ${sql.table(metadata.rows[0].db_table_name)} WHERE __id = ${record.id}`.execute(
          harness.testContainer.db
        );
        return Number(stored.rows[0]?.value);
      };
      expect(await readStoredDoubled()).toBe(2);

      updateRecordOkResponseSchema.parse(
        await post(harness, 'updateRecord', {
          tableId: table.id,
          recordId: record.id,
          fields: { [amount]: 10 },
        })
      );
      const canonicalResult =
        await sql<FamilyRow>`SELECT id, base_id, seed_table_id, plan_hash, change_type
        FROM computed_update_outbox WHERE base_id = ${harness.baseId}
        ORDER BY created_at, id LIMIT 1`.execute(harness.testContainer.db);
      const canonical = canonicalResult.rows[0];
      if (!canonical) throw new Error('Expected canonical source-mutation task');
      await sql`UPDATE computed_update_outbox
        SET created_at = now() - interval '60 seconds', estimated_complexity = 1000
        WHERE id = ${canonical.id}`.execute(harness.testContainer.db);

      const lockKey = `v2:outbox:${canonical.base_id}:${canonical.seed_table_id}:${canonical.plan_hash}:${canonical.change_type}`;
      const release = await holdFamilyLock(harness, lockKey);
      let finalAmount = 10;
      try {
        for (let round = 0; round < 4; round += 1) {
          for (let arrival = 0; arrival < 2; arrival += 1) {
            finalAmount += 1;
            updateRecordOkResponseSchema.parse(
              await post(harness, 'updateRecord', {
                tableId: table.id,
                recordId: record.id,
                fields: { [amount]: finalAmount },
              })
            );
          }
          const fragments = await familyRows(harness, canonical);
          expect(
            fragments.rows.some((fragment) => fragment.plan_hash.includes(':nolock:cnm')),
            'HTTP mutations must exercise the durable merge-lock fallback'
          ).toBe(true);
          const processed = await worker.runOnce({ workerId: `t8163-round-${round}`, limit: 1 });
          if (processed.isErr()) throw processed.error;
          expect(
            await readStoredDoubled(),
            `worker round ${round} must materialize the latest source value while arrivals continue`
          ).toBe(finalAmount * 2);
          if (round === 0) {
            const oldStillPending = await sql<{ present: boolean }>`SELECT EXISTS(
              SELECT 1 FROM computed_update_outbox WHERE id = ${canonical.id}
            ) AS present`.execute(harness.testContainer.db);
            expect(
              oldStillPending.rows[0]?.present,
              'the aged expensive task must receive the first service round despite cheaper arrivals'
            ).toBe(false);
          }
        }
      } finally {
        await release();
      }

      const beforeConsolidation = await familyRows(harness, canonical);
      expect(beforeConsolidation.rows.length).toBeGreaterThan(1);
      const consolidated = await worker.runOnce({ workerId: 't8158-consolidate', limit: 1 });
      if (consolidated.isErr()) throw consolidated.error;
      expect((await familyRows(harness, canonical)).rows.length).toBeLessThanOrEqual(1);
      await drain(harness, worker);

      expect(await readStoredDoubled()).toBe(finalAmount * 2);
      const dead = await sql<{ count: number }>`SELECT count(*)::int AS count
        FROM computed_update_dead_letter WHERE base_id = ${harness.baseId}`.execute(
        harness.testContainer.db
      );
      expect(Number(dead.rows[0]?.count ?? 0)).toBe(0);
    } finally {
      await harness.close();
    }
  }, 180_000);

  it('bounds pending work and age across eight saturated same-family HTTP bursts', async () => {
    const harness = await createHarness();
    const worker = harness.testContainer.container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    ) as ComputedUpdateWorker;
    try {
      const name = fieldId();
      const amount = fieldId();
      const doubled = fieldId();
      const table = createTableOkResponseSchema.parse(
        await post(harness, 'create', {
          baseId: harness.baseId,
          name: 'Burst Ledger',
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
      const record = createRecordOkResponseSchema.parse(
        await post(harness, 'createRecord', {
          tableId: table.id,
          fields: { [name]: 'source', [amount]: 1 },
        })
      ).data.record;
      await drain(harness, worker);
      const metadata = await sql<{ db_table_name: string }>`SELECT db_table_name
        FROM table_meta WHERE id = ${table.id}`.execute(harness.testContainer.db);
      const column = await sql<{ db_field_name: string }>`SELECT db_field_name
        FROM field WHERE id = ${doubled}`.execute(harness.testContainer.db);

      updateRecordOkResponseSchema.parse(
        await post(harness, 'updateRecord', {
          tableId: table.id,
          recordId: record.id,
          fields: { [amount]: 10 },
        })
      );
      const canonicalResult =
        await sql<FamilyRow>`SELECT id, base_id, seed_table_id, plan_hash, change_type
        FROM computed_update_outbox WHERE base_id = ${harness.baseId}
        ORDER BY created_at, id LIMIT 1`.execute(harness.testContainer.db);
      const canonical = canonicalResult.rows[0];
      if (!canonical) throw new Error('Expected source-mutation family');
      await sql`UPDATE computed_update_outbox
        SET created_at = now() - interval '60 seconds', estimated_complexity = 1000
        WHERE id = ${canonical.id}`.execute(harness.testContainer.db);
      const lockKey = `v2:outbox:${canonical.base_id}:${canonical.seed_table_id}:${canonical.plan_hash}:${canonical.change_type}`;
      const burstSize = 8;
      const rounds = 8;
      const pendingCounts: number[] = [];
      const oldestPendingAges: number[] = [];
      let finalAmount = 10;

      for (let round = 0; round < rounds; round++) {
        const burstClock = await sql<{
          started_at: string;
        }>`SELECT clock_timestamp()::text AS started_at`.execute(harness.testContainer.db);
        const release = await holdFamilyLock(harness, lockKey);
        try {
          for (let arrival = 0; arrival < burstSize; arrival++) {
            finalAmount++;
            updateRecordOkResponseSchema.parse(
              await post(harness, 'updateRecord', {
                tableId: table.id,
                recordId: record.id,
                fields: { [amount]: finalAmount },
              })
            );
          }
          const fragments = (await familyRows(harness, canonical)).rows;
          expect(
            fragments,
            `round ${round}: eight arrivals before one service opportunity`
          ).toHaveLength(burstSize + (round === 0 ? 1 : 0));
          const bypass = fragments.filter((row) => row.plan_hash.includes(':nolock:cnm'));
          expect(bypass).toHaveLength(burstSize);
          expect(new Set(bypass.map((row) => row.plan_hash)).size).toBe(burstSize);
          const queued = await sql<{
            pending_count: number;
            oldest_age_ms: number;
            oldest_bypass_age_ms: number;
            burst_elapsed_ms: number;
          }>`SELECT count(*)::int AS pending_count,
            max(extract(epoch FROM (clock_timestamp() - created_at)) * 1000)::float8 AS oldest_age_ms,
            max(extract(epoch FROM (clock_timestamp() - created_at)) * 1000)
              FILTER (WHERE id <> ${canonical.id})::float8 AS oldest_bypass_age_ms,
            (extract(epoch FROM (clock_timestamp() - ${burstClock.rows[0].started_at}::timestamptz)) * 1000)::float8 AS burst_elapsed_ms
            FROM computed_update_outbox
            WHERE base_id = ${harness.baseId} AND status = 'pending'`.execute(
            harness.testContainer.db
          );
          expect(Number(queued.rows[0].pending_count)).toBe(burstSize + (round === 0 ? 1 : 0));
          expect(Number(queued.rows[0].oldest_age_ms)).toBeGreaterThan(0);
          expect(Number(queued.rows[0].oldest_bypass_age_ms)).toBeGreaterThan(0);
          // Real DB time, not a sleep or a synthetic age series: every bypass
          // belongs to this burst, so its age cannot include earlier rounds.
          // Timestamp serialization may round to seconds; allow only that precision.
          expect(Number(queued.rows[0].oldest_bypass_age_ms)).toBeLessThanOrEqual(
            Number(queued.rows[0].burst_elapsed_ms) + 1000
          );
          if (round === 0)
            expect(Number(queued.rows[0].oldest_age_ms)).toBeGreaterThanOrEqual(60_000);
        } finally {
          // Consolidation uses a try-lock. Its service opportunity starts only
          // after contention ends; no capacity promise is made for a permanent holder.
          await release();
        }

        const processed = await worker.runOnce({ workerId: `t8163-burst-${round}`, limit: 1 });
        if (processed.isErr()) throw processed.error;
        const remaining = (await familyRows(harness, canonical)).rows;
        expect(
          remaining,
          `round ${round}: one bounded claim must retire the complete family`
        ).toHaveLength(0);
        if (round === 0) {
          const history = await sql<{
            task_id: string;
          }>`SELECT task_id FROM computed_update_run_history
            WHERE task_id = ${canonical.id}`.execute(harness.testContainer.db);
          expect(history.rows).toEqual([{ task_id: canonical.id }]);
        }
        const stored = await sql<{
          value: unknown;
        }>`SELECT ${sql.ref(column.rows[0].db_field_name)} AS value
          FROM ${sql.table(metadata.rows[0].db_table_name)} WHERE __id = ${record.id}`.execute(
          harness.testContainer.db
        );
        expect(Number(stored.rows[0]?.value), `round ${round}: materialized source value`).toBe(
          finalAmount * 2
        );
        const backlog = await sql<{ count: number; age_ms: number }>`SELECT count(*)::int AS count,
          coalesce(max(extract(epoch FROM (now() - created_at)) * 1000), 0)::float8 AS age_ms
          FROM computed_update_outbox WHERE base_id = ${harness.baseId} AND status = 'pending'`.execute(
          harness.testContainer.db
        );
        pendingCounts.push(Number(backlog.rows[0].count));
        oldestPendingAges.push(Number(backlog.rows[0].age_ms));
      }

      // Eight arrivals per service exceed unmerged task throughput. Claim-time
      // coalescing, not extra workers or rejection, keeps this bounded workload stable.
      expect(pendingCounts).toEqual(Array(rounds).fill(0));
      expect(oldestPendingAges).toEqual(Array(rounds).fill(0));
      const canonicalHistory = await sql<{ count: number }>`SELECT count(*)::int AS count
        FROM computed_update_run_history WHERE task_id = ${canonical.id}`.execute(
        harness.testContainer.db
      );
      expect(Number(canonicalHistory.rows[0].count)).toBe(1);
      expect(Number(canonicalHistory.rows[0].count)).toBeLessThan(rounds);
      expect(finalAmount).toBe(74);
      const durable = await sql<{ count: number }>`SELECT count(*)::int AS count
        FROM computed_update_outbox WHERE base_id = ${harness.baseId}`.execute(
        harness.testContainer.db
      );
      expect(Number(durable.rows[0].count)).toBe(0);
      const dead = await sql<{ count: number }>`SELECT count(*)::int AS count
        FROM computed_update_dead_letter WHERE base_id = ${harness.baseId}`.execute(
        harness.testContainer.db
      );
      expect(Number(dead.rows[0].count)).toBe(0);
    } finally {
      await harness.close();
    }
  }, 180_000);
});
