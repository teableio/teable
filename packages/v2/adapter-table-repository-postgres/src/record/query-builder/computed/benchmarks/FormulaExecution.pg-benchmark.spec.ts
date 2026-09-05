import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
  createFormulaField,
  createNumberField,
  createSingleLineTextField,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import { ok } from 'neverthrow';
import { expect, it } from 'vitest';

import { UpdateFromSelectBuilder } from '../../../computed/UpdateFromSelectBuilder';
import type { DynamicDB } from '../../ITableRecordQueryBuilder';
import { SameTableBatchQueryBuilder } from '../SameTableBatchQueryBuilder';

const schema = 'bseformulabench0001';
const tableId = 'tblformulabench0001';
const qualified = `"${schema}"."${tableId}"`;
const id = (letter: string) => FieldId.create(`fld${letter.repeat(16)}`)._unsafeUnwrap();
const ref = (letter: string) => `{${id(letter).toString()}}`;
const rowCount = Number(process.env.FORMULA_BENCH_ROWS ?? 1000);
const samples = Number(process.env.FORMULA_BENCH_SAMPLES ?? 5);
const selectedCases = process.env.FORMULA_BENCH_CASES?.split(',');
const selectedJit = process.env.FORMULA_BENCH_JIT;
const cases = [
  {
    name: 'scalar-chain',
    expressions: [`${ref('n')}+1`, `${ref('f')}*2`, `${ref('g')}+${ref('f')}`],
    levels: [[0], [1], [2]],
    json: false,
  },
  {
    name: 'array-pipeline',
    expressions: [`SUM(ARRAY_COMPACT(TEXTSPLIT(${ref('t')}, ":")))`],
    levels: [[0]],
    json: false,
  },
  { name: 'json-split', expressions: [`TEXTSPLIT(${ref('t')}, ":")`], levels: [[0]], json: true },
];

type Explain = {
  'Planning Time': number;
  'Execution Time': number;
  JIT?: { Timing?: { Total?: number } };
  Plan: { 'WAL Bytes'?: number; 'Shared Hit Blocks'?: number; 'Temp Written Blocks'?: number };
};

// Opt-in, native PostgreSQL only. Run unchanged on the pinned baseline and PR revision.
it('measures production UPDATE SQL, verifies every output, and compares JIT/batch policies', async () => {
  const url = process.env.FORMULA_PLAN_DATABASE_URL;
  if (!url) throw new Error('FORMULA_PLAN_DATABASE_URL must point to a disposable benchmark DB');
  const db: Kysely<DynamicDB> = await createV2PostgresDb<DynamicDB>({
    pg: { connectionString: url, pool: { max: 1 } },
  });
  const results: object[] = [];
  try {
    const environment = await sql`SELECT version(), pg_jit_available() AS llvm`.execute(db);
    await sql`SET statement_timeout = '30s'`.execute(db);
    await sql`SET max_parallel_workers_per_gather = 0`.execute(db);
    await sql.raw(`CREATE SCHEMA "${schema}"`).execute(db);
    for (const fixture of cases.filter(
      (fixture) => !selectedCases || selectedCases.includes(fixture.name)
    )) {
      const fields = [
        createSingleLineTextField({
          id: id('t'),
          name: FieldName.create('Text')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        createNumberField({
          id: id('n'),
          name: FieldName.create('Number')._unsafeUnwrap(),
        })._unsafeUnwrap(),
      ];
      const formulas = fixture.expressions.map((expression, index) =>
        createFormulaField({
          id: id(String.fromCharCode(102 + index)),
          name: FieldName.create(`Formula ${index}`)._unsafeUnwrap(),
          expression: FormulaExpression.create(expression)._unsafeUnwrap(),
        })._unsafeUnwrap()
      );
      const builder = Table.builder()
        .withId(TableId.create(tableId)._unsafeUnwrap())
        .withBaseId(BaseId.create(schema)._unsafeUnwrap())
        .withName(TableName.create('Formula benchmark')._unsafeUnwrap());
      for (const field of [...fields, ...formulas]) builder.addFieldFromResult(ok(field));
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      table
        .getFields()
        .forEach((field, index) =>
          field.setDbFieldName(DbFieldName.rehydrate(`c${index}`)._unsafeUnwrap())._unsafeUnwrap()
        );
      await sql.raw(`DROP TABLE IF EXISTS ${qualified}`).execute(db);
      await sql
        .raw(
          `CREATE TABLE ${qualified} (__id text PRIMARY KEY, __version integer DEFAULT 1, c0 text, c1 double precision, ${formulas.map((_, i) => `c${i + 2} ${fixture.json ? 'jsonb' : 'double precision'}`).join(', ')})`
        )
        .execute(db);
      await sql
        .raw(
          `INSERT INTO ${qualified} (__id,c0,c1) SELECT 'rec'||n,n||':2:3',n FROM generate_series(1,${rowCount}) n`
        )
        .execute(db);
      await sql.raw(`ANALYZE ${qualified}`).execute(db);
      for (const chunkSize of fixture.json ? [25, 100, 500] : [rowCount]) {
        for (const jit of ['off', 'default', 'basic'] as const) {
          if (selectedJit && selectedJit !== jit) continue;
          await sql.raw(`SET jit = ${jit === 'off' ? 'off' : 'on'}`).execute(db);
          // Force basic JIT for a controlled comparison; production defaults are recorded below.
          await sql.raw(`SET jit_above_cost = ${jit === 'default' ? 100000 : 0}`).execute(db);
          await sql
            .raw(`SET jit_inline_above_cost = ${jit === 'default' ? 500000 : -1}`)
            .execute(db);
          await sql
            .raw(`SET jit_optimize_above_cost = ${jit === 'default' ? 500000 : -1}`)
            .execute(db);
          for (let sample = -1; sample < samples; sample++) {
            await sql.raw(`TRUNCATE ${qualified}`).execute(db);
            await sql
              .raw(
                `INSERT INTO ${qualified} (__id,c0,c1) SELECT 'rec'||n,n||':2:3',n FROM generate_series(1,${rowCount}) n`
              )
              .execute(db);
            await sql.raw(`ANALYZE ${qualified}`).execute(db);
            const start = performance.now();
            let compileMs = 0,
              planningMs = 0,
              executionMs = 0,
              jitMs = 0,
              walBytes = 0,
              sharedHits = 0,
              tempBlocks = 0,
              sqlBytes = 0,
              statements = 0;
            for (let offset = 0; offset < rowCount; offset += chunkSize) {
              const compileStart = performance.now();
              const recordIds = Array.from(
                { length: Math.min(chunkSize, rowCount - offset) },
                (_, i) => `rec${offset + i + 1}`
              );
              const selected = new SameTableBatchQueryBuilder(db, new Pg16TypeValidationStrategy())
                .build({
                  table,
                  fieldLevels: fixture.levels.map((indices, level) => ({
                    level,
                    fieldIds: indices.map((i) => formulas[i].id()),
                  })),
                  ...(chunkSize < rowCount ? { recordIds } : {}),
                })
                ._unsafeUnwrap();
              const query = new UpdateFromSelectBuilder(db)
                .build({
                  table,
                  fieldIds: formulas.map((f) => f.id()),
                  selectQuery: selected.selectQuery,
                })
                ._unsafeUnwrap();
              compileMs += performance.now() - compileStart;
              sqlBytes += Buffer.byteLength(query.sql);
              const explained = await db.executeQuery<{ 'QUERY PLAN': Explain[] }>(
                CompiledQuery.raw(
                  `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON, TIMING ON) ${query.sql}`,
                  [...query.parameters]
                )
              );
              const plan = explained.rows[0]['QUERY PLAN'][0];
              planningMs += plan['Planning Time'];
              executionMs += plan['Execution Time'];
              jitMs += plan.JIT?.Timing?.Total ?? 0;
              walBytes += Number(plan.Plan['WAL Bytes'] ?? 0);
              sharedHits += plan.Plan['Shared Hit Blocks'] ?? 0;
              tempBlocks += plan.Plan['Temp Written Blocks'] ?? 0;
              statements++;
            }
            const wallMs = performance.now() - start;
            const expected =
              fixture.name === 'scalar-chain'
                ? ['c1+1', '(c1+1)*2', '(c1+1)*3']
                : [fixture.json ? "to_jsonb(string_to_array(c0, ':'))" : 'c1+5'];
            const verification = await sql
              .raw(
                `SELECT count(*)::integer AS count FROM ${qualified} WHERE ${expected.map((value, i) => `c${i + 2} IS DISTINCT FROM (${value})`).join(' OR ')} OR __version <> 2`
              )
              .execute(db);
            expect(verification.rows[0]).toEqual({ count: 0 });
            if (sample >= 0)
              results.push({
                case: fixture.name,
                rowCount,
                chunkSize,
                jit,
                sample,
                compileMs,
                planningMs,
                executionMs,
                jitMs,
                wallMs,
                walBytes,
                sharedHits,
                tempBlocks,
                sqlBytes,
                statements,
                mismatches: 0,
              });
          }
        }
      }
    }
    const output = resolve(process.env.FORMULA_BENCH_OUTPUT ?? 'formula-benchmark.json');
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          revision: process.env.FORMULA_BENCH_REVISION,
          environment: environment.rows,
          samples,
          settings: {
            parallelWorkers: 0,
            defaultJitCosts: [100000, 500000, 500000],
            basicJitCosts: [0, -1, -1],
            timing: true,
          },
          results,
        },
        null,
        2
      )
    );
  } finally {
    await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
    await db.destroy();
  }
}, 300_000);
