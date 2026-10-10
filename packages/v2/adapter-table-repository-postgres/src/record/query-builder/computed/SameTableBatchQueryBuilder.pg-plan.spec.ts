import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  LookupOptions,
  Table,
  TableId,
  TableName,
  TimeZone,
  createAttachmentField,
  createFormulaField,
  createSingleLineTextField,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { sql, type Kysely } from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UpdateFromSelectBuilder } from '../../computed/UpdateFromSelectBuilder';
import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { explainUpdate } from './plan-testkit/explain';
import { SameTableBatchQueryBuilder } from './SameTableBatchQueryBuilder';

const schema = 'bseplanregression01';
const tableId = 'tblplanregression01';
const rowCount = 100;
const id = (letter: string) => FieldId.create(`fld${letter.repeat(16)}`)._unsafeUnwrap();
const textId = id('t');
const attachmentId = id('a');
const lookupId = id('k');
const linkId = id('l');
const name = (value: string) => FieldName.create(value)._unsafeUnwrap();
const ref = (value: FieldId) => `{${value.toString()}}`;

const buildTable = (expressions: string[], timeZones?: string[]) => {
  const formulas = expressions.map((expression, index) =>
    createFormulaField({
      id: id(String.fromCharCode(102 + index)),
      name: name(`Formula ${index}`),
      expression: FormulaExpression.create(expression)._unsafeUnwrap(),
      ...(timeZones?.[index]
        ? { timeZone: TimeZone.create(timeZones[index])._unsafeUnwrap() }
        : {}),
    })._unsafeUnwrap()
  );
  const fields = [
    createSingleLineTextField({ id: textId, name: name('Input') })._unsafeUnwrap(),
    createAttachmentField({ id: attachmentId, name: name('Files') })._unsafeUnwrap(),
    ...formulas,
  ];
  const builder = Table.builder()
    .withId(TableId.create(tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(schema)._unsafeUnwrap())
    .withName(TableName.create('Formula plan regression')._unsafeUnwrap());
  for (const field of fields) builder.addFieldFromResult(ok(field));
  const foreignId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
  const foreignBuilder = Table.builder()
    .withId(foreignId)
    .withBaseId(BaseId.create(schema)._unsafeUnwrap())
    .withName(TableName.create('Source')._unsafeUnwrap());
  foreignBuilder.addFieldFromResult(
    createSingleLineTextField({ id: textId, name: name('Source value') })
  );
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();
  builder
    .field()
    .link()
    .withId(linkId)
    .withName(name('Source link'))
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignId.toString(),
        lookupFieldId: textId.toString(),
        symmetricFieldId: id('s').toString(),
      })._unsafeUnwrap()
    )
    .done();
  builder
    .field()
    .lookup()
    .withId(lookupId)
    .withName(name('Lookup value'))
    .withLookupOptions(
      LookupOptions.create({
        linkFieldId: linkId.toString(),
        foreignTableId: foreignId.toString(),
        lookupFieldId: textId.toString(),
      })._unsafeUnwrap()
    )
    .withInnerField(foreignTable.getFields()[0])
    .withIsMultipleCellValue(true)
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
  table.getFields().forEach((field, index) => {
    field.setDbFieldName(DbFieldName.rehydrate(`column_${index}`)._unsafeUnwrap())._unsafeUnwrap();
  });
  return { table, formulas };
};

describe('native PostgreSQL computed formula plan gate', () => {
  let db: Kysely<DynamicDB>;

  beforeAll(async () => {
    const connectionString = process.env.FORMULA_PLAN_DATABASE_URL;
    if (!connectionString)
      throw new Error('FORMULA_PLAN_DATABASE_URL is required for the native PG plan gate');
    db = await createV2PostgresDb<DynamicDB>({
      pg: { connectionString, pool: { max: 1, connectionTimeoutMillis: 5000 } },
    });
    await sql`SET statement_timeout = '10s'`.execute(db);
    await sql`SET lock_timeout = '2s'`.execute(db);
    await sql`SET jit = off`.execute(db);
    await sql.raw(`CREATE SCHEMA "${schema}"`).execute(db);
  });

  afterAll(async () => {
    if (db) {
      try {
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      } finally {
        await db.destroy();
      }
    }
  });

  const run = async (
    caseName: string,
    expressions: string[],
    resultType: 'text' | 'double precision',
    levels?: number[][],
    timeZones?: string[]
  ) => {
    const { table, formulas } = buildTable(expressions, timeZones);
    await sql.raw(`DROP TABLE IF EXISTS "${schema}"."${tableId}"`).execute(db);
    await sql
      .raw(
        `CREATE TABLE "${schema}"."${tableId}" (
      __id text PRIMARY KEY, __version integer NOT NULL DEFAULT 1,
      column_0 text, column_1 jsonb,
      ${formulas.map((_, index) => `column_${index + 2} ${resultType}`).join(',')},
      column_${formulas.length + 2} jsonb, column_${formulas.length + 3} jsonb
    )`
      )
      .execute(db);
    await sql
      .raw(
        `INSERT INTO "${schema}"."${tableId}" (__id, column_0, column_1, column_${formulas.length + 3})
      SELECT 'rec' || n, '1:2:3:4', '[{"id":"att1","name":"sample.txt"}]'::jsonb, '["1:2:3:4"]'::jsonb
      FROM generate_series(1, ${rowCount}) n`
      )
      .execute(db);
    await sql.raw(`ANALYZE "${schema}"."${tableId}"`).execute(db);
    const selected = new SameTableBatchQueryBuilder(db, new Pg16TypeValidationStrategy())
      .build({
        table,
        fieldLevels: (levels ?? formulas.map((_, index) => [index])).map((indices, level) => ({
          level,
          fieldIds: indices.map((index) => formulas[index].id()),
        })),
      })
      ._unsafeUnwrap();
    const update = new UpdateFromSelectBuilder(db)
      .build({
        table,
        fieldIds: formulas.map((field) => field.id()),
        selectQuery: selected.selectQuery,
      })
      ._unsafeUnwrap();
    const plan = await explainUpdate(db, update, caseName);
    expect(plan.sqlBytes).toBeLessThan(100_000);
    expect(plan.expressionBytes).toBeLessThan(200_000);
    expect(plan.nodes.length).toBeLessThan(300);
    const values = await sql<{
      value: string | number;
    }>`SELECT ${sql.ref(`column_${formulas.length + 1}`)} AS value FROM ${sql.table(`${schema}.${tableId}`)}`.execute(
      db
    );
    expect(values.rows).toHaveLength(rowCount);
    return { ...plan, values: values.rows.map((row) => row.value) };
  };

  it('extracts attachment display text once per row through nested IF', async () => {
    const expression = `IF(${ref(textId)}="", "", IF(${ref(textId)}="missing", "", ${ref(attachmentId)}))`;
    const plan = await run('attachment-nested-if', [expression], 'text');
    expect(new Set(plan.values)).toEqual(new Set(['sample.txt']));
    const extractions = plan.nodes.filter(
      (node) => node['Function Name'] === 'jsonb_array_elements'
    );
    expect(extractions.length).toBeGreaterThan(0);
    expect(extractions.reduce((total, node) => total + (node['Actual Loops'] ?? 0), 0)).toBe(
      rowCount
    );
  });

  it('bounds the incident TEXTSPLIT / normalization plan under repeated expressions', async () => {
    const core = `SUM(ARRAY_COMPACT(TEXTSPLIT(REGEXP_REPLACE(${ref(lookupId)}, "[^0-9.]+", ":"), ":")))`;
    const plan = await run(
      'split-normalization',
      [`IF(${ref(textId)}="", 0, ${core}+${core})`],
      'double precision'
    );
    expect(new Set(plan.values)).toEqual(new Set([20]));
    const scans = plan.nodes.filter((node) =>
      ['jsonb_array_elements', 'jsonb_array_elements_text', 'unnest'].includes(
        node['Function Name'] ?? ''
      )
    );
    // Lookup extraction and fused split/compact/sum each visit their input once
    // per row, even though the formula occurs twice in the source expression.
    expect(scans.map((node) => node['Function Name']).sort()).toEqual([
      'jsonb_array_elements',
      'unnest',
    ]);
    expect(scans.map((node) => node['Actual Loops'])).toEqual([rowCount, rowCount]);
  });

  it('preserves a shared computed result through a diamond dependency', async () => {
    const core = `SUM(ARRAY_COMPACT(TEXTSPLIT(REGEXP_REPLACE(${ref(lookupId)}, "[^0-9.]+", ":"), ":")))`;
    const plan = await run(
      'diamond',
      [core, `${ref(id('f'))}+1`, `${ref(id('f'))}*2`, `${ref(id('g'))}+${ref(id('h'))}`],
      'double precision'
    );
    expect(new Set(plan.values)).toEqual(new Set([31]));
    // The expensive source must not be copied into each downstream formula.
    const scans = plan.nodes.filter((node) => node['Function Name'] === 'jsonb_array_elements');
    expect(scans.reduce((total, node) => total + (node['Actual Loops'] ?? 0), 0)).toBe(rowCount);
  });
  it('shares identical formulas computed in the same layer', async () => {
    const core = `SUM(ARRAY_COMPACT(TEXTSPLIT(REGEXP_REPLACE(${ref(lookupId)}, "[^0-9.]+", ":"), ":")))`;
    const plan = await run(
      'same-layer',
      [core, core, `${ref(id('f'))}+${ref(id('g'))}`],
      'double precision',
      [[0, 1], [2]]
    );
    expect(new Set(plan.values)).toEqual(new Set([20]));
    const scans = plan.nodes.filter((node) =>
      ['jsonb_array_elements', 'jsonb_array_elements_text', 'unnest'].includes(
        node['Function Name'] ?? ''
      )
    );
    expect(scans.map((node) => node['Function Name']).sort()).toEqual([
      'jsonb_array_elements',
      'unnest',
    ]);
    // PG may additionally Memoize equal input rows at the lateral boundary.
    for (const scan of scans) {
      expect(scan['Actual Loops']).toBeGreaterThan(0);
      expect(scan['Actual Loops']).toBeLessThanOrEqual(rowCount);
    }
  });
  it('shares a producer across different formula roots in one layer', async () => {
    const core = `SUM(ARRAY_COMPACT(TEXTSPLIT(REGEXP_REPLACE(${ref(lookupId)}, "[^0-9.]+", ":"), ":")))`;
    const plan = await run(
      'different-roots',
      [`${core}+1`, `${core}*2`, `${ref(id('f'))}+${ref(id('g'))}`],
      'double precision',
      [[0, 1], [2]]
    );
    expect(new Set(plan.values)).toEqual(new Set([31]));
    const scans = plan.nodes.filter((node) =>
      ['jsonb_array_elements', 'jsonb_array_elements_text', 'unnest'].includes(
        node['Function Name'] ?? ''
      )
    );
    expect(scans.map((node) => node['Function Name']).sort()).toEqual([
      'jsonb_array_elements',
      'unnest',
    ]);
    for (const scan of scans) {
      expect(scan['Actual Loops']).toBeGreaterThan(0);
      expect(scan['Actual Loops']).toBeLessThanOrEqual(rowCount);
    }
  });
  it('preserves error columns from jointly compiled roots for downstream IS_ERROR', async () => {
    const plan = await run(
      'group-error-state',
      ['1/0', '2', `IF(IS_ERROR(${ref(id('f'))}), "error", "ok")`],
      'text',
      [[0, 1], [2]]
    );
    expect(new Set(plan.values)).toEqual(new Set(['error']));
  });

  it('does not merge formula literals with different internal whitespace', async () => {
    const plan = await run(
      'group-literal-whitespace',
      ['"a  b"', '"a b"', `${ref(id('f'))}&"|"&${ref(id('g'))}`],
      'text',
      [[0, 1], [2]]
    );
    expect(new Set(plan.values)).toEqual(new Set(['a  b|a b']));
  });

  it('keeps separate compilation groups for formula time zones', async () => {
    const expression = 'DATETIME_FORMAT("2024-01-01T00:00:00Z", "YYYY-MM-DD HH:mm")';
    const plan = await run(
      'group-time-zones',
      [expression, expression, expression, expression, `${ref(id('f'))}&"|"&${ref(id('h'))}`],
      'text',
      [[0, 1, 2, 3], [4]],
      ['UTC', 'UTC', 'Asia/Tokyo', 'Asia/Tokyo', 'UTC']
    );
    expect(new Set(plan.values)).toEqual(new Set(['2024-01-01 00:00|2024-01-01 09:00']));
  });
  it.each(['IF', 'SWITCH'] as const)('keeps array storage through %s branches', async (branch) => {
    const split = `TEXTSPLIT(${ref(textId)}, ":")`;
    const expression =
      branch === 'IF'
        ? `IF(${ref(textId)}="", TEXTSPLIT("0", ":"), ${split})`
        : `SWITCH(${ref(textId)}, "", TEXTSPLIT("0", ":"), ${split})`;
    const plan = await run(
      `array-${branch.toLowerCase()}`,
      [`SUM(ARRAY_COMPACT(${expression}))`],
      'double precision'
    );
    expect(new Set(plan.values)).toEqual(new Set([10]));
  });

  it('keeps nested branch plan growth proportional to formula depth', async () => {
    const measurements: number[] = [];
    for (const depth of [2, 4, 8]) {
      let expression = ref(attachmentId);
      for (let level = 0; level < depth; level++) {
        expression = `IF(${ref(textId)}="missing-${level}", "", ${expression})`;
      }
      const plan = await run(`attachment-depth-${depth}`, [expression], 'text');
      expect(new Set(plan.values)).toEqual(new Set(['sample.txt']));
      measurements.push(plan.expressionBytes);
      const extractions = plan.nodes.filter(
        (node) => node['Function Name'] === 'jsonb_array_elements'
      );
      expect(extractions.reduce((total, node) => total + (node['Actual Loops'] ?? 0), 0)).toBe(
        rowCount
      );
    }
    // Four times the AST depth must not cause exponential plan expansion.
    expect(measurements[2]).toBeLessThan(measurements[0] * 5);
  });
});
