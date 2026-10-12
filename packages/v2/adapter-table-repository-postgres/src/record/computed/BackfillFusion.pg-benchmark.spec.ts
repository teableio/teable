import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId } from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { CompiledQuery, sql } from 'kysely';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

import type { DynamicDB } from '../query-builder';
import { makeBackfillFusionTable } from './__tests__/backfillFusionFixture';
import { ComputedFieldBackfillService } from './ComputedFieldBackfillService';

it('compares singleton and fused backfill on native PG, including WAL and versions', async () => {
  const connectionString = process.env.FORMULA_PLAN_DATABASE_URL;
  if (!connectionString) throw new Error('FORMULA_PLAN_DATABASE_URL is required');
  const db = await createV2PostgresDb<DynamicDB>({
    pg: { connectionString, pool: { max: 1, connectionTimeoutMillis: 5000 } },
  });
  const rowCount = 10000;
  const fieldCount = 8;
  const schema = `backfill_fusion_${process.pid}_${Date.now()}`;
  const relation = `${schema}.fusion`;
  const table = makeBackfillFusionTable(
    Array.from({ length: fieldCount }, (_, i) => `{fld${'a'.repeat(16)}} * ${i + 1} + 1`),
    relation
  );
  const fields = table.getFields().slice(1);
  const context = { actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap() };
  const service = new ComputedFieldBackfillService(
    { findOne: vi.fn(async () => ok(table)) } as never,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    {} as never,
    db as never,
    {} as never,
    { mode: 'sync', hybridThreshold: 10000 },
    new Pg16TypeValidationStrategy()
  );
  const directory = resolve(process.env.FORMULA_PLAN_ARTIFACT_DIR ?? 'formula-plan-artifacts');
  await mkdir(directory, { recursive: true });
  let schemaCreated = false;
  try {
    await sql.raw(`CREATE SCHEMA ${schema}`).execute(db);
    schemaCreated = true;
    await sql
      .raw(
        `CREATE TABLE ${relation} (__id text PRIMARY KEY, __version integer, col_0 double precision, ${fields.map((_, i) => `col_${i + 1} double precision`).join(', ')})`
      )
      .execute(db);
    await sql`SET jit = off`.execute(db);
    await sql`SET statement_timeout = '30s'`.execute(db);
    const version = await sql<{ version: string }>`SELECT version() AS version`.execute(db);
    const samples: unknown[] = [];
    let baseline: unknown;
    for (let iteration = 0; iteration < 6; iteration++) {
      // Alternate ordering to reduce systematic warm-cache bias.
      for (const fused of iteration % 2 ? [true, false] : [false, true]) {
        await sql.raw(`TRUNCATE ${relation}`).execute(db);
        await sql
          .raw(
            `INSERT INTO ${relation} (__id, __version, col_0) SELECT 'rec' || lpad(i::text, 16, '0'), 10, i::float8 FROM generate_series(1, ${rowCount}) i`
          )
          .execute(db);
        await sql.raw(`ANALYZE ${relation}`).execute(db);
        const execute = db.executeQuery.bind(db);
        const plans: {
          Plan: { 'WAL Bytes'?: number };
          'Execution Time': number;
          'Planning Time': number;
        }[] = [];
        const queries: { sql: string; parameters: readonly unknown[] }[] = [];
        const spy = vi.spyOn(db, 'executeQuery').mockImplementation(async (query) => {
          if (!query.sql.includes(`update "${schema}"."fusion"`)) return execute(query);
          queries.push({ sql: query.sql, parameters: query.parameters });
          const result = await execute(
            CompiledQuery.raw(
              `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON, TIMING OFF) ${query.sql}`,
              [...query.parameters]
            )
          );
          const plan = (result.rows[0] as { 'QUERY PLAN': typeof plans })['QUERY PLAN'][0];
          plans.push(plan);
          return { rows: [] };
        });
        const started = performance.now();
        try {
          for (const group of fused ? [fields] : fields.map((field) => [field])) {
            (await service.executeSyncMany(context, { table, fields: group }))._unsafeUnwrap({
              withStackTrace: true,
            });
          }
        } finally {
          spy.mockRestore();
        }
        const wallMs = performance.now() - started;
        const result = await sql.raw(`SELECT * FROM ${relation} ORDER BY __id`).execute(db);
        if (!baseline) baseline = result.rows;
        expect(result.rows).toEqual(baseline);
        expect(result.rows).toHaveLength(rowCount);
        expect((result.rows[0] as { __version: number }).__version).toBe(18);
        expect(plans).toHaveLength(fused ? 1 : 8);
        samples.push({
          iteration,
          fused,
          wallMs,
          updateCount: plans.length,
          planningMs: plans.reduce((n, p) => n + p['Planning Time'], 0),
          executionMs: plans.reduce((n, p) => n + p['Execution Time'], 0),
          walBytes: plans.reduce((n, p) => n + (p.Plan['WAL Bytes'] ?? 0), 0),
        });
        if (iteration === 0)
          await writeFile(
            resolve(directory, `backfill-${fused ? 'fused' : 'singleton'}-plans.json`),
            JSON.stringify({ queries, plans }, null, 2)
          );
      }
    }
    await writeFile(
      resolve(directory, 'backfill-fusion-samples.json'),
      JSON.stringify(
        {
          serverVersion: version.rows[0].version,
          rowCount,
          fieldCount,
          seed: 'col_0 = row index 1..10000; computed columns NULL; version 10; TRUNCATE/reseed/ANALYZE before every sample',
          warmupIterations: 1,
          samples,
        },
        null,
        2
      )
    );
  } finally {
    try {
      if (schemaCreated) await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(db);
    } finally {
      await db.destroy();
    }
  }
}, 60000);
