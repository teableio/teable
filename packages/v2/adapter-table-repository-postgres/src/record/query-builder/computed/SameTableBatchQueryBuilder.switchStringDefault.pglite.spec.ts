/**
 * T6998 regression: sanitized, structure-equivalent to production v2 computed
 * dead letters (app.teable.cn, 2026-08-26, failureKind=computed_code_bug,
 * failurePhase=execute_plan, sqlState 22P02).
 *
 * Retained structural facts only:
 * - a SWITCH formula over a singleSelect with three string-literal result
 *   branches ('0') and a number-typed default branch
 *   INT(DATETIME_DIFF(Now(), {date}, "days")); production's default read a
 *   rollup date column, but only the number-typed default matters here
 * - the SWITCH formula metadata is string-typed (cell_value_type='string')
 *   and persisted in a text column
 * - a second formula compares the SWITCH field with a number literal:
 *   IF({switch} > 7, "STALE", "OK"), also persisted in a text column
 * - the computed worker executes a level_0 (SWITCH) + level_1 (comparison)
 *   UPDATE ... FROM (SELECT ...) plan
 *
 * Pre-fix, coerceSwitchResults returned raw branch SQL whenever the result
 * branches agreed, never checking the default branch. The emitted CASE mixed
 * unknown-type '0' literals with a double precision ELSE, so Postgres typed
 * the CASE as double precision while field metadata stayed string. The
 * downstream comparison trusted the metadata and emitted
 * COALESCE("level_0"."Days_Since_Update", '') in its text fallback, forcing
 * ''::float8 at parse time: invalid input syntax for type double precision: "".
 * Customer names, ids, and values are not copied.
 */
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  FieldValueTypeVisitor,
  FormulaExpression,
  SelectOption,
  Table,
  TableId,
  TableName,
  createDateField,
  createFormulaField,
  createSingleSelectField,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { UpdateFromSelectBuilder } from '../../computed/UpdateFromSelectBuilder';
import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { SameTableBatchQueryBuilder } from './SameTableBatchQueryBuilder';

const typeValidationStrategy = new Pg16TypeValidationStrategy();

const BASE_ID = `bse${'a'.repeat(16)}`;
const MAIN_TABLE_ID = `tbl${'m'.repeat(16)}`;

const selectId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
const dateId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
const formulaAId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
const formulaBId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();

const buildDomain = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();

  const option = (name: string, color: string) =>
    SelectOption.create({ name, color })._unsafeUnwrap();

  const statusResult = createSingleSelectField({
    id: selectId,
    name: FieldName.create('Status')._unsafeUnwrap(),
    options: [
      option('Alpha', 'blue'),
      option('Beta', 'green'),
      option('Gamma', 'red'),
      option('Active', 'yellow'),
    ],
  });
  const dateResult = createDateField({
    id: dateId,
    name: FieldName.create('Last Update')._unsafeUnwrap(),
  });
  const formulaAResult = createFormulaField({
    id: formulaAId,
    name: FieldName.create('Days Since Update')._unsafeUnwrap(),
    expression: FormulaExpression.create(
      `SWITCH({${selectId.toString()}}, "Alpha", "0", "Beta", "0", "Gamma", "0", INT(DATETIME_DIFF(Now(), {${dateId.toString()}}, "days")))`
    )._unsafeUnwrap(),
  });
  const formulaBResult = createFormulaField({
    id: formulaBId,
    name: FieldName.create('Followup Flag')._unsafeUnwrap(),
    expression: FormulaExpression.create(
      `IF({${formulaAId.toString()}} > 7, "STALE", "OK")`
    )._unsafeUnwrap(),
  });

  const mainTable = Table.builder()
    .withId(mainTableId)
    .withBaseId(baseId)
    .withName(TableName.create('MainTable')._unsafeUnwrap())
    .addFieldFromResult(statusResult)
    .addFieldFromResult(dateResult)
    .addFieldFromResult(formulaAResult)
    .addFieldFromResult(formulaBResult)
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

  const names = ['Status', 'Last_Update', 'Days_Since_Update', 'Followup_Flag'];
  mainTable.getFields().forEach((field, index) => {
    field.setDbFieldName(DbFieldName.rehydrate(names[index]!)._unsafeUnwrap())._unsafeUnwrap();
  });
  return mainTable;
};

describe('SameTableBatchQueryBuilder SWITCH string branches with numeric default (pglite, T6998)', () => {
  let pgliteDb: PGliteTestDb;

  beforeAll(async () => {
    pgliteDb = await createPGliteDb();
    const { db } = pgliteDb;
    await sql`create schema "bseaaaaaaaaaaaaaaaa"`.execute(db);
    await sql
      .raw(
        `create table "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" (
        "__id" text primary key,
        "__version" integer not null default 1,
        "Status" text,
        "Last_Update" timestamp with time zone,
        "Days_Since_Update" text,
        "Followup_Flag" text
      )`
      )
      .execute(db);
    await sql
      .raw(
        `insert into "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm"
        ("__id", "Status", "Last_Update")
       values
        ('rec1', 'Alpha', null),
        ('rec2', 'Active', now() - interval '10 days'),
        ('rec3', 'Active', now() - interval '3 days')`
      )
      .execute(db);
  });

  afterAll(async () => {
    await pgliteDb?.db.destroy();
  });

  test('computed plan backfills a string-typed SWITCH and its downstream numeric comparison', async () => {
    const mainTable = buildDomain();
    const db = pgliteDb.db as unknown as Kysely<DynamicDB>;

    // Formula A metadata must stay string-typed like production
    // (mixed string-literal branches + numeric default).
    const formulaA = mainTable.getField((field) => field.id().equals(formulaAId))._unsafeUnwrap();
    const formulaAValueType = formulaA.accept(new FieldValueTypeVisitor())._unsafeUnwrap();
    expect(formulaAValueType.cellValueType.toString()).toBe('string');

    const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
    const buildResult = builder.build({
      table: mainTable,
      fieldLevels: [
        { level: 0, fieldIds: [formulaAId] },
        { level: 1, fieldIds: [formulaBId] },
      ],
    });
    if (buildResult.isErr()) throw buildResult.error;

    const updateBuilder = new UpdateFromSelectBuilder(db);
    const updateResult = updateBuilder.build({
      table: mainTable,
      fieldIds: [formulaAId, formulaBId],
      selectQuery: buildResult.value.selectQuery,
    });
    if (updateResult.isErr()) throw updateResult.error;

    // Pre-fix this threw: invalid input syntax for type double precision: ""
    await db.executeQuery(updateResult.value);

    const rows = await sql<{
      __id: string;
      Days_Since_Update: string | null;
      Followup_Flag: string | null;
    }>`
      select "__id", "Days_Since_Update", "Followup_Flag"
      from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm"
      order by "__id"
    `.execute(db);

    expect(rows.rows).toEqual([
      { __id: 'rec1', Days_Since_Update: '0', Followup_Flag: 'OK' },
      { __id: 'rec2', Days_Since_Update: '10', Followup_Flag: 'STALE' },
      { __id: 'rec3', Days_Since_Update: '3', Followup_Flag: 'OK' },
    ]);
  });
});
