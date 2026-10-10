import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { BaseId, FieldId, NoopLogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { CompiledQuery, sql } from 'kysely';
import { expect, it, vi } from 'vitest';

import { FieldDependencyGraph } from './FieldDependencyGraph';

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
};

const sequentialMetadataRows = (node: PlanNode): number =>
  (node['Node Type'] === 'Seq Scan' &&
  (node['Relation Name'] === 'field' || node['Relation Name'] === 'reference')
    ? (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0)) * node['Actual Loops']
    : 0) + (node.Plans ?? []).reduce((total, child) => total + sequentialMetadataRows(child), 0);

it('keeps multi-seed local graph loads bounded on large native PostgreSQL metadata', async () => {
  const connectionString = process.env.FORMULA_PLAN_DATABASE_URL;
  if (!connectionString) throw new Error('FORMULA_PLAN_DATABASE_URL is required');
  const db = await createV2PostgresDb<V1TeableDatabase>({
    pg: { connectionString, pool: { max: 1, connectionTimeoutMillis: 5000 } },
  });
  const queries: CompiledQuery[] = [];
  let capture = false;
  const executor = db.getExecutor();
  const executeQuery = executor.executeQuery.bind(executor);
  const querySpy = vi
    .spyOn(executor, 'executeQuery')
    .mockImplementation(<R>(...args: Parameters<typeof executor.executeQuery>) => {
      if (capture) queries.push(args[0]);
      return executeQuery<R>(...args);
    });
  const schema = `graph_plan_${process.pid}_${Date.now()}`;
  const directory = resolve(process.env.FORMULA_PLAN_ARTIFACT_DIR ?? 'formula-plan-artifacts');
  await mkdir(directory, { recursive: true });
  let schemaCreated = false;
  try {
    await sql.raw(`CREATE SCHEMA ${schema}`).execute(db);
    schemaCreated = true;
    await sql.raw(`SET search_path TO ${schema}`).execute(db);
    await sql`SET statement_timeout = '30s'`.execute(db);
    // Leave scan/join planner choices enabled; forcing index scans would hide this regression.
    await sql`SET enable_seqscan = on`.execute(db);
    await sql`SET enable_hashjoin = on`.execute(db);
    await sql`SET enable_nestloop = on`.execute(db);
    await sql`SET enable_mergejoin = on`.execute(db);
    await sql
      .raw(
        `CREATE TABLE table_meta (
      id text PRIMARY KEY, base_id text NOT NULL,
      provision_state text NOT NULL DEFAULT 'ready', deleted_time timestamp
    )`
      )
      .execute(db);
    await sql
      .raw(
        `CREATE TABLE field (
      id text PRIMARY KEY, table_id text NOT NULL, type text NOT NULL,
      is_computed boolean, is_lookup boolean, is_conditional_lookup boolean, is_pending boolean,
      options text, lookup_options text, lookup_linked_field_id text, meta text,
      deleted_time timestamp
    )`
      )
      .execute(db);
    await sql
      .raw(
        `CREATE TABLE reference (
      from_field_id text NOT NULL, to_field_id text NOT NULL,
      UNIQUE (to_field_id, from_field_id)
    )`
      )
      .execute(db);
    for (const statement of [
      'CREATE INDEX reference_from_field_id_idx ON reference (from_field_id)',
      'CREATE INDEX reference_to_field_id_idx ON reference (to_field_id)',
      'CREATE INDEX field_lookup_linked_field_id_idx ON field (lookup_linked_field_id)',
      'CREATE INDEX field_table_id_deleted_time_idx ON field (table_id, deleted_time)',
      'CREATE INDEX table_meta_base_id_deleted_time_idx ON table_meta (base_id, deleted_time)',
    ]) {
      await sql.raw(statement).execute(db);
    }
    for (const migration of [
      '20260114000000_add_field_json_indexes',
      '20260907110000_add_conditional_dependency_index',
    ]) {
      const source = await readFile(
        new URL(
          `../../../../../db-main-prisma/prisma/postgres/migrations/${migration}/migration.sql`,
          import.meta.url
        ),
        'utf8'
      );
      for (const statement of source.split(';').filter((part) => part.trim())) {
        await sql.raw(statement).execute(db);
      }
    }
    const version = await sql<{ version: string }>`SELECT version() AS version`.execute(db);
    const graph = new FieldDependencyGraph(db, new NoopLogger());
    const baseId = BaseId.create(`bse${'0'.repeat(16)}`)._unsafeUnwrap();
    const measurements = [];
    for (const size of [1000, 100000]) {
      await sql`TRUNCATE field, reference, table_meta`.execute(db);
      await sql
        .raw(
          `INSERT INTO table_meta (id, base_id)
        SELECT 'tbl' || lpad(i::text, 16, '0'), 'bse' || lpad(i::text, 16, '0')
        FROM generate_series(0, ${size / 100 - 1}) i`
        )
        .execute(db);
      await sql
        .raw(
          `INSERT INTO field (id, table_id, type, is_computed)
        SELECT 'fld' || lpad(i::text, 16, '0'), 'tbl' || lpad((i / 100)::text, 16, '0'),
          CASE WHEN i % 4 = 0 THEN 'number' ELSE 'formula' END, i % 4 != 0
        FROM generate_series(0, ${size - 1}) i`
        )
        .execute(db);
      await sql
        .raw(
          `INSERT INTO reference (from_field_id, to_field_id)
        SELECT 'fld' || lpad((i - 1)::text, 16, '0'), 'fld' || lpad(i::text, 16, '0')
        FROM generate_series(0, ${size - 1}) i WHERE i % 4 != 0`
        )
        .execute(db);
      for (const relation of ['field', 'reference', 'table_meta']) {
        await sql.raw(`ANALYZE ${relation}`).execute(db);
      }
      for (const seedCount of [1, 20, 100]) {
        const requiredFieldIds = Array.from({ length: seedCount }, (_, i) =>
          FieldId.create(`fld${i.toString().padStart(16, '0')}`)._unsafeUnwrap()
        );
        const expectedIds = Array.from(
          { length: Math.max(4, seedCount) },
          (_, i) => `fld${i.toString().padStart(16, '0')}`
        );
        queries.length = 0;
        capture = true;
        const result = (await graph.load(baseId, undefined, { requiredFieldIds }))._unsafeUnwrap();
        capture = false;
        expect([...result.fieldsById.keys()].sort()).toEqual(expectedIds);
        expect(result.edges.map((edge) => `${edge.fromFieldId}:${edge.toFieldId}`).sort()).toEqual(
          expectedIds.flatMap((id, i) => (i % 4 ? [`${expectedIds[i - 1]}:${id}`] : [])).sort()
        );
        const plans = [];
        let scannedRows = 0;
        for (const query of queries) {
          const explained = await db.executeQuery<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
            CompiledQuery.raw(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF) ${query.sql}`, [
              ...query.parameters,
            ])
          );
          const plan = explained.rows[0]['QUERY PLAN'][0];
          scannedRows += sequentialMetadataRows(plan.Plan);
          plans.push({ query, plan });
        }
        const samples = [];
        for (let iteration = 0; iteration < 12; iteration++) {
          const started = performance.now();
          (await graph.load(baseId, undefined, { requiredFieldIds }))._unsafeUnwrap();
          if (iteration >= 2) samples.push(performance.now() - started);
        }
        const sorted = [...samples].sort((a, b) => a - b);
        measurements.push({
          size,
          seedCount,
          scannedRows,
          queryCount: queries.length,
          medianMs: (sorted[4] + sorted[5]) / 2,
          samples,
        });
        await writeFile(
          resolve(directory, `graph-${size}-${seedCount}-plans.json`),
          JSON.stringify(plans, null, 2)
        );
        // Allow cheap scans on small tables. At 100k fields the existing recursive walk and
        // legacy probes need at most one reference scan plus two field scans (2.75 * size).
        // Incident metadata must not add full scans. Assert work, not timing or SQL counts.
        expect(scannedRows, `${size} fields / ${seedCount} seeds`).toBeLessThanOrEqual(
          Math.max(10000, 3 * size)
        );
      }
    }
    await writeFile(
      resolve(directory, 'graph-load-samples.json'),
      JSON.stringify(
        {
          version: version.rows[0].version,
          warmups: 2,
          measurements,
        },
        null,
        2
      )
    );
  } finally {
    querySpy.mockRestore();
    try {
      if (schemaCreated) await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(db);
    } finally {
      await db.destroy();
    }
  }
}, 120000);
