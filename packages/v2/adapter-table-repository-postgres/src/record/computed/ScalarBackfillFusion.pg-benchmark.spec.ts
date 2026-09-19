import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId } from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { CompiledQuery, sql } from 'kysely';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

import type { DynamicDB } from '../query-builder';
import { planPhase1BackfillFieldChunks } from './__tests__/phase1BackfillPlanner';
import {
  makeScalarBackfillTable,
  scalarBackfillExpressions,
} from './__tests__/scalarBackfillFixture';
import { ComputedFieldBackfillService } from './ComputedFieldBackfillService';

it('compares singleton, numeric-only and expanded scalar backfill on native PG', async () => {
  const connectionString = process.env.FORMULA_PLAN_DATABASE_URL;
  if (!connectionString) throw new Error('FORMULA_PLAN_DATABASE_URL is required');
  const db = await createV2PostgresDb<DynamicDB>({
    pg: { connectionString, pool: { max: 1, connectionTimeoutMillis: 5000 } },
  });
  const schema = `scalar_backfill_${process.pid}_${Date.now()}`;
  const relation = `${schema}.fusion`;
  const rowCount = 10000;
  const { table, fields, columnDefinitions } = makeScalarBackfillTable(relation);
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
  const seed = `INSERT INTO ${relation} (__id, __version, col_0, col_1, col_2, col_3)
    SELECT 'rec' || lpad(i::text, 16, '0'), 10,
      CASE WHEN i % 7 = 0 THEN NULL ELSE ' row ' || i::text || ' ' END,
      CASE WHEN i % 11 = 0 THEN NULL WHEN i % 5 = 0 THEN 0 ELSE i::float8 / 3 END,
      CASE WHEN i % 13 = 0 THEN NULL ELSE '2024-03-01T06:30:00Z'::timestamptz + (i % 280) * interval '1 day' END,
      CASE WHEN i % 17 = 0 THEN NULL ELSE i % 2 = 0 END
    FROM generate_series(1, ${rowCount}) i`;
  let schemaCreated = false;
  try {
    await sql.raw(`CREATE SCHEMA ${schema}`).execute(db);
    schemaCreated = true;
    await sql
      .raw(
        `CREATE TABLE ${relation} (__id text PRIMARY KEY, __version integer, ${columnDefinitions})`
      )
      .execute(db);
    await sql`SET jit = off`.execute(db);
    await sql`SET statement_timeout = '30s'`.execute(db);
    const version = await sql<{ version: string }>`SELECT version() AS version`.execute(db);
    const samples: unknown[] = [];
    let expected: unknown;
    const modes = ['singleton', 'numeric-only', 'expanded'] as const;
    for (let iteration = 0; iteration < 6; iteration++) {
      for (let index = 0; index < modes.length; index++) {
        const mode = modes[(index + iteration) % modes.length];
        await sql.raw(`TRUNCATE ${relation}`).execute(db);
        await sql.raw(seed).execute(db);
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
          plans.push((result.rows[0] as { 'QUERY PLAN': typeof plans })['QUERY PLAN'][0]);
          return { rows: [] };
        });
        const started = performance.now();
        try {
          const groups =
            mode === 'singleton'
              ? fields.map((field) => [field])
              : mode === 'numeric-only'
                ? planPhase1BackfillFieldChunks(table, fields)
                : [fields];
          for (const group of groups) {
            (await service.executeSyncMany(context, { table, fields: group }))._unsafeUnwrap({
              withStackTrace: true,
            });
          }
        } finally {
          spy.mockRestore();
        }
        const wallMs = performance.now() - started;
        const result = await sql.raw(`SELECT * FROM ${relation} ORDER BY __id`).execute(db);
        expected ??= result.rows;
        expect(result.rows).toEqual(expected);
        expect(result.rows).toHaveLength(rowCount);
        expect(plans).toHaveLength(mode === 'singleton' ? 8 : mode === 'numeric-only' ? 7 : 1);
        samples.push({
          iteration,
          mode,
          wallMs,
          updateCount: plans.length,
          planningMs: plans.reduce((n, p) => n + p['Planning Time'], 0),
          executionMs: plans.reduce((n, p) => n + p['Execution Time'], 0),
          walBytes: plans.reduce((n, p) => n + (p.Plan['WAL Bytes'] ?? 0), 0),
        });
        if (iteration === 0)
          await writeFile(
            resolve(directory, `scalar-backfill-${mode}-plans.json`),
            JSON.stringify({ queries, plans }, null, 2)
          );
      }
    }
    await writeFile(
      resolve(directory, 'scalar-backfill-samples.json'),
      JSON.stringify(
        {
          serverVersion: version.rows[0].version,
          rowCount,
          fieldCount: fields.length,
          formulas: scalarBackfillExpressions,
          timeZone: 'America/New_York',
          seed,
          reset: 'TRUNCATE / reseed / ANALYZE each sample; rotated mode order; jit=off',
          baselineCommit: '488cca0fe',
          warmupIterations: 1,
          correctness: 'All 10,000 full result rows including versions equal in all 18 runs',
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
}, 120000);
