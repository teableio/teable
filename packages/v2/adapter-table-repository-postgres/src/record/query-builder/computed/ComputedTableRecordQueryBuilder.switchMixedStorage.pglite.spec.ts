/**
 * T6980 regression: sanitized, structure-equivalent to production
 * V2SchemaOperationFailure BACKEND-AI-1GM (Sentry issue 7692302858).
 *
 * Retained structural facts only:
 * - SWITCH formula whose result branches read same-table number columns
 *   (double precision) and rollup max aggregates (CAST ... AS DOUBLE PRECISION)
 * - the SWITCH default branch reads a multi-value link column (jsonb)
 * - computed backfill runs UPDATE ... FROM (SELECT formula CASE ...) during
 *   table.update schema operations
 *
 * Pre-fix, the emitted CASE mixed double precision THENs with a raw jsonb ELSE
 * and Postgres rejected the backfill with
 * "CASE types double precision and jsonb cannot be matched", killing the schema
 * operation. Customer names, ids, and values are not copied.
 */
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  RollupExpression,
  RollupFieldConfig,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { UpdateFromSelectBuilder } from '../../computed/UpdateFromSelectBuilder';
import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';

const typeValidationStrategy = new Pg16TypeValidationStrategy();

const BASE_ID = `bse${'a'.repeat(16)}`;
const MAIN_TABLE_ID = `tbl${'m'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'f'.repeat(16)}`;

const selectId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
const numManualId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
const numDefaultId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
const linkFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
const rollupAId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
const rollupBId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();
const rollupCId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
const formulaId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
const multiLinkId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
const multiLinkSymId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
const priceA = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
const priceB = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
const priceC = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();

const buildDomain = (defaultBranchFieldId: FieldId) => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();

  const foreignBuilder = Table.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('ForeignServices')._unsafeUnwrap());
  foreignBuilder
    .field()
    .number()
    .withId(priceA)
    .withName(FieldName.create('Price A')._unsafeUnwrap())
    .done();
  foreignBuilder
    .field()
    .number()
    .withId(priceB)
    .withName(FieldName.create('Price B')._unsafeUnwrap())
    .done();
  foreignBuilder
    .field()
    .number()
    .withId(priceC)
    .withName(FieldName.create('Price C')._unsafeUnwrap())
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();
  foreignTable
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('Price_A')._unsafeUnwrap())
    ._unsafeUnwrap();
  foreignTable
    .getFields()[1]
    .setDbFieldName(DbFieldName.rehydrate('Price_B')._unsafeUnwrap())
    ._unsafeUnwrap();
  foreignTable
    .getFields()[2]
    .setDbFieldName(DbFieldName.rehydrate('Price_C')._unsafeUnwrap())
    ._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: priceA.toString(),
    isOneWay: true,
  })._unsafeUnwrap();

  const multiLinkConfig = LinkFieldConfig.create({
    relationship: 'oneMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: priceA.toString(),
    symmetricFieldId: multiLinkSymId.toString(),
    isOneWay: false,
  })._unsafeUnwrap();

  const mkRollupConfig = (lookupFieldId: FieldId) =>
    RollupFieldConfig.create({
      linkFieldId: linkFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
    })._unsafeUnwrap();
  const maxExpr = RollupExpression.create('max({values})')._unsafeUnwrap();

  const formulaExpr = FormulaExpression.create(
    `SWITCH({${selectId.toString()}}, "Manual Override", {${numManualId.toString()}}, "Provider", {${rollupAId.toString()}}, "Clinician", {${rollupBId.toString()}}, "Patient", {${rollupCId.toString()}}, {${defaultBranchFieldId.toString()}})`
  )._unsafeUnwrap();

  const mainBuilder = Table.builder()
    .withId(mainTableId)
    .withBaseId(baseId)
    .withName(TableName.create('MainTable')._unsafeUnwrap());
  mainBuilder
    .field()
    .singleSelect()
    .withId(selectId)
    .withName(FieldName.create('Cost Basis')._unsafeUnwrap())
    .done();
  mainBuilder
    .field()
    .number()
    .withId(numManualId)
    .withName(FieldName.create('Manual Cost')._unsafeUnwrap())
    .done();
  mainBuilder
    .field()
    .number()
    .withId(numDefaultId)
    .withName(FieldName.create('Current Cost')._unsafeUnwrap())
    .done();
  mainBuilder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Service Link')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  mainBuilder
    .field()
    .link()
    .withId(multiLinkId)
    .withName(FieldName.create('Crosswalk Link')._unsafeUnwrap())
    .withConfig(multiLinkConfig)
    .done();
  mainBuilder
    .field()
    .rollup()
    .withId(rollupAId)
    .withName(FieldName.create('Rollup A')._unsafeUnwrap())
    .withConfig(mkRollupConfig(priceA))
    .withExpression(maxExpr)
    .done();
  mainBuilder
    .field()
    .rollup()
    .withId(rollupBId)
    .withName(FieldName.create('Rollup B')._unsafeUnwrap())
    .withConfig(mkRollupConfig(priceB))
    .withExpression(maxExpr)
    .done();
  mainBuilder
    .field()
    .rollup()
    .withId(rollupCId)
    .withName(FieldName.create('Rollup C')._unsafeUnwrap())
    .withConfig(mkRollupConfig(priceC))
    .withExpression(maxExpr)
    .done();
  mainBuilder
    .field()
    .formula()
    .withId(formulaId)
    .withName(FieldName.create('Effective Cost')._unsafeUnwrap())
    .withExpression(formulaExpr)
    .done();
  mainBuilder.view().defaultGrid().done();

  const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
  const names = [
    'Cost_Basis',
    'Manual_Cost',
    'Current_Cost',
    'Service_Link',
    'Crosswalk_Link',
    'Rollup_A',
    'Rollup_B',
    'Rollup_C',
    'Effective_Cost',
  ];
  mainTable.getFields().forEach((f, i) => {
    f.setDbFieldName(DbFieldName.rehydrate(names[i]!)._unsafeUnwrap())._unsafeUnwrap();
  });
  return { mainTable, foreignTable };
};

const buildBackfillSelect = (
  db: Kysely<DynamicDB>,
  mainTable: Table,
  foreignTable: Table
): ReturnType<ComputedTableRecordQueryBuilder['build']> => {
  const builder = new ComputedTableRecordQueryBuilder(db, {
    typeValidationStrategy,
    forceLookupArrayOutput: true,
    resolveSystemUserSnapshotsFromUsers: true,
    allowFullTableSetBasedRollups: true,
    foreignTables: new Map([[FOREIGN_TABLE_ID, foreignTable]]),
  })
    .from(mainTable)
    .select([formulaId]);
  return builder.build();
};

describe('ComputedTableRecordQueryBuilder SWITCH mixed-storage branches (pglite)', () => {
  let pgliteDb: Awaited<ReturnType<typeof createPGliteDb>>;

  const createMainTable = async (effectiveCostColumnType: 'double precision' | 'text') => {
    const { db } = pgliteDb;
    await sql.raw(`drop table if exists "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm"`).execute(db);
    await sql
      .raw(
        `create table "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" (
        "__id" text primary key,
        "__version" integer not null default 1,
        "__fk_fldhhhhhhhhhhhhhhhh" text,
        "Cost_Basis" text,
        "Manual_Cost" double precision,
        "Current_Cost" double precision,
        "Service_Link" jsonb,
        "Crosswalk_Link" jsonb,
        "Rollup_A" double precision,
        "Rollup_B" double precision,
        "Rollup_C" double precision,
        "Effective_Cost" ${effectiveCostColumnType}
      )`
      )
      .execute(db);
    await sql
      .raw(
        `insert into "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm"
        ("__id", "__fk_fldhhhhhhhhhhhhhhhh", "Cost_Basis", "Manual_Cost", "Current_Cost", "Service_Link", "Crosswalk_Link")
       values
        ('recM1', 'recF1', 'Provider', 1, 5, '{"id":"recF1","title":"11"}'::jsonb, '[{"id":"recF1","title":"11"}]'::jsonb),
        ('recM2', 'recF2', 'Unknown Basis', 2, 7, '{"id":"recF2","title":"44"}'::jsonb, '[{"id":"recF2","title":"44"}]'::jsonb)`
      )
      .execute(db);
  };

  const runBackfill = async (
    defaultBranchFieldId: FieldId,
    effectiveCostColumnType: 'double precision' | 'text'
  ) => {
    const { mainTable, foreignTable } = buildDomain(defaultBranchFieldId);
    const db = pgliteDb.db as unknown as Kysely<DynamicDB>;
    await createMainTable(effectiveCostColumnType);
    const buildResult = buildBackfillSelect(db, mainTable, foreignTable);
    if (buildResult.isErr()) throw buildResult.error;
    const updateBuilder = new UpdateFromSelectBuilder(db);
    const updateResult = updateBuilder.build({
      table: mainTable,
      fieldIds: [formulaId],
      selectQuery: buildResult.value,
    });
    if (updateResult.isErr()) throw updateResult.error;
    await db.executeQuery(updateResult.value);
    const rows = await sql<{ Effective_Cost: unknown }>`
      select "Effective_Cost" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" order by "__id"
    `.execute(db);
    return rows.rows.map((row) => row.Effective_Cost);
  };

  beforeAll(async () => {
    pgliteDb = await createPGliteDb();
    const { db } = pgliteDb;
    await sql`create schema "bseaaaaaaaaaaaaaaaa"`.execute(db);
    await sql
      .raw(
        `create table "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" (
        "__id" text primary key,
        "Price_A" double precision,
        "Price_B" double precision,
        "Price_C" double precision
      )`
      )
      .execute(db);
    await sql
      .raw(
        `insert into "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" ("__id", "Price_A", "Price_B", "Price_C")
       values ('recF1', 11, 22, 33), ('recF2', 44, 55, 66)`
      )
      .execute(db);
  });

  afterAll(async () => {
    await pgliteDb?.db.destroy();
  });

  test('numeric-only SWITCH default backfills into a double precision column', async () => {
    const values = await runBackfill(numDefaultId, 'double precision');
    expect(values.map(Number)).toEqual([11, 7]);
  });

  test('multi-value link jsonb default no longer breaks the backfill CASE', async () => {
    // Pre-fix this rejected with: CASE types double precision and jsonb cannot be matched
    const values = await runBackfill(multiLinkId, 'text');
    expect(Number(values[0])).toBe(11);
    expect(String(values[1])).toContain('44');
  });
});
