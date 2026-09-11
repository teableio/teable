/**
 * SQL type matrix (pglite).
 *
 * Why this exists:
 * `computed-matrix/*.matrix.spec.ts` multiplies value transitions
 * (nullToValue / valueToValue) on scalar sources. Those tests never EXECUTE
 * generated SQL against the physical column type. Production
 * V2SchemaOperationFailure groups (T7099, T6980, T6844, T6734, …) fail at
 * Postgres EXECUTE of `UPDATE … FROM (SELECT …)` when the emitter treats a
 * jsonb lookup/array column as a scalar.
 *
 * This file is the missing axis:
 *   rollup expression × storage (scalar column | jsonb lookup column)
 *     × compatible cell value type
 * plus a small formula subset for mixed-storage CASE / jsonb operands.
 *
 * Each case runs a real backfill UPDATE on PGlite. A PG type error
 * (42883, 42804, 22P02, …) fails the test.
 *
 * Not copied from customer data. Fixtures use padded synthetic ids.
 */
import {
  BaseId,
  CellValueType,
  DbFieldName,
  DbFieldType,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  LookupOptions,
  RollupExpression,
  RollupFieldConfig,
  Table,
  TableId,
  TableName,
  createCheckboxField,
  createDateField,
  createFormulaField,
  createNumberField,
  createSingleLineTextField,
  createSingleSelectField,
  getRollupFunctionsByCellValueType,
  SelectOption,
  type RollupFunction,
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
import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';
import { SameTableBatchQueryBuilder } from './SameTableBatchQueryBuilder';

const typeValidationStrategy = new Pg16TypeValidationStrategy();

const BASE_ID = `bse${'a'.repeat(16)}`;
const HOST_TABLE_ID = `tbl${'m'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'f'.repeat(16)}`;
const LEAF_TABLE_ID = `tbl${'n'.repeat(16)}`;
const HOST_LINK_ID = `fld${'k'.repeat(16)}`;
const HOST_NAME_ID = `fld${'h'.repeat(16)}`;
const FOREIGN_VALUE_ID = `fld${'v'.repeat(16)}`;
const FOREIGN_LOOKUP_ID = `fld${'u'.repeat(16)}`;
const FOREIGN_LINK_ID = `fld${'l'.repeat(16)}`;
const LEAF_NAME_ID = `fld${'p'.repeat(16)}`;
const LEAF_VALUE_ID = `fld${'q'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'s'.repeat(16)}`;
const FK_COLUMN = `__fk_${SYMMETRIC_FIELD_ID}`;

type CellKind = 'number' | 'dateTime' | 'boolean' | 'string';
type StorageKind = 'scalar' | 'jsonbLookup';

const CELL_KINDS: CellKind[] = ['number', 'dateTime', 'boolean', 'string'];
const STORAGE_KINDS: StorageKind[] = ['scalar', 'jsonbLookup'];

const cellValueTypeOf = (kind: CellKind): CellValueType => {
  switch (kind) {
    case 'number':
      return CellValueType.number();
    case 'dateTime':
      return CellValueType.dateTime();
    case 'boolean':
      return CellValueType.boolean();
    case 'string':
      return CellValueType.string();
  }
};

const fieldIdFromIndex = (index: number): FieldId => {
  const suffix = index.toString(36).padStart(15, '0');
  return FieldId.create(`fldr${suffix}`)._unsafeUnwrap();
};

const columnNameForExpression = (expression: RollupFunction): string =>
  `col_${expression.replace(/[{}()]/g, '').replace(/\W+/g, '_')}`;

const pgTypeForRollup = (expression: RollupFunction, cell: CellKind): string => {
  if (expression === 'array_unique({values})' || expression === 'array_compact({values})') {
    return 'jsonb';
  }
  if (expression === 'array_join({values})' || expression === 'concatenate({values})') {
    return 'text';
  }
  if (
    expression === 'and({values})' ||
    expression === 'or({values})' ||
    expression === 'xor({values})'
  ) {
    return 'boolean';
  }
  if ((expression === 'max({values})' || expression === 'min({values})') && cell === 'dateTime') {
    return 'timestamp with time zone';
  }
  return 'double precision';
};

const dbFieldTypeForPgType = (pgType: string): string => {
  switch (pgType) {
    case 'jsonb':
      return 'JSON';
    case 'boolean':
      return 'BOOLEAN';
    case 'timestamp with time zone':
      return 'TIMESTAMPTZ';
    case 'text':
      return 'TEXT';
    default:
      return 'REAL';
  }
};

const scalarPgType = (cell: CellKind): string => {
  switch (cell) {
    case 'number':
      return 'double precision';
    case 'dateTime':
      return 'timestamp with time zone';
    case 'boolean':
      return 'boolean';
    case 'string':
      return 'text';
  }
};

const scalarSqlLiterals = (cell: CellKind): [string, string] => {
  switch (cell) {
    case 'number':
      return ['10', '30'];
    case 'dateTime':
      return [`'2024-01-01T00:00:00Z'::timestamptz`, `'2024-03-01T00:00:00Z'::timestamptz`];
    case 'boolean':
      return ['true', 'true'];
    case 'string':
      return [`'Alpha'`, `'Beta'`];
  }
};

const jsonbSqlLiteral = (cell: CellKind): string => {
  switch (cell) {
    case 'number':
      return `'[10, 30]'::jsonb`;
    case 'dateTime':
      return `'["2024-01-01T00:00:00.000Z", "2024-03-01T00:00:00.000Z"]'::jsonb`;
    case 'boolean':
      return `'[true, true]'::jsonb`;
    case 'string':
      return `'["Alpha", "Beta"]'::jsonb`;
  }
};

const scalarFieldResult = (cell: CellKind, fieldId: FieldId) => {
  const name = FieldName.create('Value')._unsafeUnwrap();
  switch (cell) {
    case 'number':
      return createNumberField({ id: fieldId, name });
    case 'dateTime':
      return createDateField({ id: fieldId, name });
    case 'boolean':
      return createCheckboxField({ id: fieldId, name });
    case 'string':
      return createSingleLineTextField({ id: fieldId, name });
  }
};

const innerFieldFor = (cell: CellKind) => {
  const id = FieldId.create(LEAF_VALUE_ID)._unsafeUnwrap();
  const name = FieldName.create('LeafValue')._unsafeUnwrap();
  switch (cell) {
    case 'number':
      return createNumberField({ id, name })._unsafeUnwrap();
    case 'dateTime':
      return createDateField({ id, name })._unsafeUnwrap();
    case 'boolean':
      return createCheckboxField({ id, name })._unsafeUnwrap();
    case 'string':
      return createSingleLineTextField({ id, name })._unsafeUnwrap();
  }
};

type RollupColumn = {
  expression: RollupFunction;
  fieldId: FieldId;
  column: string;
  pgType: string;
};

const buildRollupDomain = (cell: CellKind, storage: StorageKind) => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const hostTableId = TableId.create(HOST_TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
  const leafTableId = TableId.create(LEAF_TABLE_ID)._unsafeUnwrap();
  const hostLinkId = FieldId.create(HOST_LINK_ID)._unsafeUnwrap();
  const hostNameId = FieldId.create(HOST_NAME_ID)._unsafeUnwrap();
  const foreignValueId = FieldId.create(FOREIGN_VALUE_ID)._unsafeUnwrap();
  const foreignLookupId = FieldId.create(FOREIGN_LOOKUP_ID)._unsafeUnwrap();
  const foreignLinkId = FieldId.create(FOREIGN_LINK_ID)._unsafeUnwrap();
  const leafNameId = FieldId.create(LEAF_NAME_ID)._unsafeUnwrap();
  const leafValueId = FieldId.create(LEAF_VALUE_ID)._unsafeUnwrap();
  const expressions = getRollupFunctionsByCellValueType(cellValueTypeOf(cell));

  const leafBuilder = Table.builder()
    .withId(leafTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Leaf')._unsafeUnwrap());
  leafBuilder
    .field()
    .singleLineText()
    .withId(leafNameId)
    .withName(FieldName.create('LeafName')._unsafeUnwrap())
    .done();
  leafBuilder.addFieldFromResult(scalarFieldResult(cell, leafValueId));
  leafBuilder.view().defaultGrid().done();
  const leafTable = leafBuilder.build()._unsafeUnwrap();

  const foreignBuilder = Table.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Foreign')._unsafeUnwrap());

  if (storage === 'scalar') {
    foreignBuilder.addFieldFromResult(scalarFieldResult(cell, foreignValueId));
  } else {
    const leafLinkConfig = LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: leafTableId.toString(),
      lookupFieldId: leafNameId.toString(),
      isOneWay: true,
    })._unsafeUnwrap();
    const lookupOptions = LookupOptions.create({
      linkFieldId: foreignLinkId.toString(),
      foreignTableId: leafTableId.toString(),
      lookupFieldId: leafValueId.toString(),
    })._unsafeUnwrap();
    foreignBuilder
      .field()
      .link()
      .withId(foreignLinkId)
      .withName(FieldName.create('LeafLink')._unsafeUnwrap())
      .withConfig(leafLinkConfig)
      .done();
    foreignBuilder
      .field()
      .lookup()
      .withId(foreignLookupId)
      .withName(FieldName.create('LeafLookup')._unsafeUnwrap())
      .withLookupOptions(lookupOptions)
      .withInnerField(innerFieldFor(cell))
      .done();
  }
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder
    .build({ foreignTables: storage === 'jsonbLookup' ? [leafTable] : [] })
    ._unsafeUnwrap();

  const sourceFieldId = storage === 'scalar' ? foreignValueId : foreignLookupId;
  const sourceField = foreignTable
    .getField((field) => field.id().equals(sourceFieldId))
    ._unsafeUnwrap();
  if (storage === 'jsonbLookup') {
    sourceField.setDbFieldName(DbFieldName.rehydrate('col_values')._unsafeUnwrap())._unsafeUnwrap();
    sourceField.setDbFieldType(DbFieldType.rehydrate('JSON')._unsafeUnwrap())._unsafeUnwrap();
  } else {
    sourceField.setDbFieldName(DbFieldName.rehydrate('col_values')._unsafeUnwrap())._unsafeUnwrap();
  }

  const hostLinkConfig = LinkFieldConfig.create({
    relationship: 'oneMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: sourceFieldId.toString(),
    symmetricFieldId: SYMMETRIC_FIELD_ID,
  })._unsafeUnwrap();

  const hostBuilder = Table.builder()
    .withId(hostTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Host')._unsafeUnwrap());
  hostBuilder
    .field()
    .singleLineText()
    .withId(hostNameId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .done();
  hostBuilder
    .field()
    .link()
    .withId(hostLinkId)
    .withName(FieldName.create('Items')._unsafeUnwrap())
    .withConfig(hostLinkConfig)
    .done();

  const rollupColumns: RollupColumn[] = expressions.map((expression, index) => {
    const fieldId = fieldIdFromIndex(index);
    const column = columnNameForExpression(expression);
    const pgType = pgTypeForRollup(expression, cell);
    const rollupConfig = RollupFieldConfig.create({
      linkFieldId: hostLinkId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: sourceFieldId.toString(),
    })._unsafeUnwrap();
    hostBuilder
      .field()
      .rollup()
      .withId(fieldId)
      .withName(FieldName.create(column)._unsafeUnwrap())
      .withConfig(rollupConfig)
      .withExpression(RollupExpression.create(expression)._unsafeUnwrap())
      .done();
    return { expression, fieldId, column, pgType };
  });
  hostBuilder.view().defaultGrid().done();

  const hostTable = hostBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
  hostTable
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  hostTable
    .getFields()[1]
    .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
    ._unsafeUnwrap();
  rollupColumns.forEach((column, index) => {
    const field = hostTable.getFields()[index + 2];
    field.setDbFieldName(DbFieldName.rehydrate(column.column)._unsafeUnwrap())._unsafeUnwrap();
    field
      .setDbFieldType(DbFieldType.rehydrate(dbFieldTypeForPgType(column.pgType))._unsafeUnwrap())
      ._unsafeUnwrap();
  });

  return { hostTable, foreignTable, rollupColumns, sourceField };
};

const assertCoreValues = (cell: CellKind, storage: StorageKind, rows: Record<string, unknown>) => {
  const read = (expression: RollupFunction) => rows[columnNameForExpression(expression)];

  if (cell === 'number') {
    expect(Number(read('max({values})'))).toBe(30);
    expect(Number(read('min({values})'))).toBe(10);
    expect(Number(read('sum({values})'))).toBe(40);
    expect(Number(read('average({values})'))).toBe(20);
  }
  if (cell === 'dateTime') {
    const asTime = (value: unknown) => new Date(String(value)).getTime();
    expect(asTime(read('max({values})'))).toBe(Date.parse('2024-03-01T00:00:00.000Z'));
    expect(asTime(read('min({values})'))).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
  }
  if (cell === 'boolean') {
    expect(read('and({values})')).toBe(true);
    expect(read('or({values})')).toBe(true);
  }
  if (cell === 'string') {
    const joined = String(read('array_join({values})') ?? '');
    expect(joined).toContain('Alpha');
    expect(joined).toContain('Beta');
  }

  const count = Number(read('count({values})'));
  const counta = Number(read('counta({values})'));
  if (storage === 'jsonbLookup') {
    expect(count).toBe(1);
    return;
  }
  // Boolean COUNT is DISTINCT; two identical trues collapse to 1.
  if (cell === 'boolean') {
    expect(counta).toBe(2);
    expect(count).toBe(1);
    return;
  }
  expect(count).toBe(2);
};

describe('SQL type matrix (pglite)', () => {
  let pgliteDb: PGliteTestDb;

  beforeAll(async () => {
    pgliteDb = await createPGliteDb();
    await sql`create schema "bseaaaaaaaaaaaaaaaa"`.execute(pgliteDb.db);
  });

  afterAll(async () => {
    await pgliteDb?.db.destroy();
  });

  describe('rollup expression × storage × cell value type', () => {
    const cases = CELL_KINDS.flatMap((cell) =>
      STORAGE_KINDS.map((storage) => ({
        cell,
        storage,
        expressions: getRollupFunctionsByCellValueType(cellValueTypeOf(cell)),
      }))
    );

    test.each(cases)(
      'backfills $cell $storage ($expressions.length expressions)',
      async ({ cell, storage, expressions }) => {
        const db = pgliteDb.db as unknown as Kysely<DynamicDB>;
        const { hostTable, foreignTable, rollupColumns, sourceField } = buildRollupDomain(
          cell,
          storage
        );

        if (storage === 'jsonbLookup') {
          expect(sourceField.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(true);
        }

        await sql
          .raw(`drop table if exists "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" cascade`)
          .execute(db);
        await sql
          .raw(`drop table if exists "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" cascade`)
          .execute(db);

        const rollupDefs = rollupColumns
          .map((column) => `"${column.column}" ${column.pgType}`)
          .join(',\n        ');

        await sql
          .raw(
            `create table "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" (
              "__id" text primary key,
              "__auto_number" integer not null default 1,
              "${FK_COLUMN}" text,
              "${FK_COLUMN}_order" integer not null default 1,
              "col_values" ${storage === 'scalar' ? scalarPgType(cell) : 'jsonb'}
            )`
          )
          .execute(db);

        await sql
          .raw(
            `create table "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" (
              "__id" text primary key,
              "__version" integer not null default 1,
              "col_name" text,
              "col_link" jsonb,
              ${rollupDefs}
            )`
          )
          .execute(db);

        await sql
          .raw(
            `insert into "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" ("__id", "col_name")
             values ('recH1', 'Host')`
          )
          .execute(db);

        if (storage === 'scalar') {
          const [left, right] = scalarSqlLiterals(cell);
          await sql
            .raw(
              `insert into "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff"
                ("__id", "__auto_number", "${FK_COLUMN}", "${FK_COLUMN}_order", "col_values")
               values ('recF1', 1, 'recH1', 1, ${left}), ('recF2', 2, 'recH1', 2, ${right})`
            )
            .execute(db);
        } else {
          await sql
            .raw(
              `insert into "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff"
                ("__id", "__auto_number", "${FK_COLUMN}", "${FK_COLUMN}_order", "col_values")
               values ('recF1', 1, 'recH1', 1, ${jsonbSqlLiteral(cell)})`
            )
            .execute(db);
        }

        const buildResult = new ComputedTableRecordQueryBuilder(db, {
          typeValidationStrategy,
          forceLookupArrayOutput: true,
          resolveSystemUserSnapshotsFromUsers: true,
          allowFullTableSetBasedRollups: true,
          foreignTables: new Map([[FOREIGN_TABLE_ID, foreignTable]]),
        })
          .from(hostTable)
          .select(rollupColumns.map((column) => column.fieldId))
          .build();
        if (buildResult.isErr()) {
          throw new Error(
            `${cell}/${storage} select failed: ${buildResult.error.message}\n${JSON.stringify(buildResult.error)}`
          );
        }

        const updateResult = new UpdateFromSelectBuilder(db).build({
          table: hostTable,
          fieldIds: rollupColumns.map((column) => column.fieldId),
          selectQuery: buildResult.value,
          skipDistinctFilter: true,
        });
        if (updateResult.isErr()) {
          throw new Error(`${cell}/${storage} update SQL failed: ${updateResult.error.message}`);
        }

        try {
          await db.executeQuery(updateResult.value);
        } catch (error) {
          const compiled = updateResult.value;
          throw new Error(
            `${cell}/${storage} backfill EXECUTE failed for [${expressions.join(', ')}]: ${String(error)}\nSQL: ${'sql' in compiled ? compiled.sql : ''}`
          );
        }

        const result = await sql<Record<string, unknown>>`
          select * from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" where "__id" = 'recH1'
        `.execute(db);
        const row = result.rows[0];
        if (!row) throw new Error('missing host row');
        assertCoreValues(cell, storage, row);
      }
    );
  });

  describe('formula mixed-storage backfill', () => {
    test('SWITCH numeric branches with a jsonb-link default backfill into text', async () => {
      const db = pgliteDb.db as unknown as Kysely<DynamicDB>;
      const selectId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
      const numberId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
      const linkId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
      const formulaId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();

      const option = (name: string, color: string) =>
        SelectOption.create({ name, color })._unsafeUnwrap();
      const status = createSingleSelectField({
        id: selectId,
        name: FieldName.create('Basis')._unsafeUnwrap(),
        options: [option('Manual', 'blue'), option('Other', 'gray')],
      });
      const numberField = createNumberField({
        id: numberId,
        name: FieldName.create('Manual')._unsafeUnwrap(),
      });
      const formula = createFormulaField({
        id: formulaId,
        name: FieldName.create('Effective')._unsafeUnwrap(),
        expression: FormulaExpression.create(
          `SWITCH({${selectId.toString()}}, "Manual", {${numberId.toString()}}, {${linkId.toString()}})`
        )._unsafeUnwrap(),
      });

      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: FOREIGN_TABLE_ID,
        lookupFieldId: FOREIGN_VALUE_ID,
        symmetricFieldId: SYMMETRIC_FIELD_ID,
        isOneWay: true,
      })._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(TableId.create(HOST_TABLE_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('Host')._unsafeUnwrap());
      hostBuilder.addFieldFromResult(status);
      hostBuilder.addFieldFromResult(numberField);
      hostBuilder
        .field()
        .link()
        .withId(linkId)
        .withName(FieldName.create('Crosswalk')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      hostBuilder.addFieldFromResult(formula);
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();
      const names = ['Basis', 'Manual', 'Crosswalk', 'Effective'];
      hostTable.getFields().forEach((field, index) => {
        field.setDbFieldName(DbFieldName.rehydrate(names[index]!)._unsafeUnwrap())._unsafeUnwrap();
      });

      await sql
        .raw(`drop table if exists "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" cascade`)
        .execute(db);
      await sql
        .raw(
          `create table "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" (
            "__id" text primary key,
            "__version" integer not null default 1,
            "Basis" text,
            "Manual" double precision,
            "Crosswalk" jsonb,
            "Effective" text
          )`
        )
        .execute(db);
      await sql
        .raw(
          `insert into "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm"
            ("__id", "Basis", "Manual", "Crosswalk")
           values
            ('rec1', 'Manual', 11, '[{"id":"recF1","title":"44"}]'::jsonb),
            ('rec2', 'Other', 7, '[{"id":"recF1","title":"44"}]'::jsonb)`
        )
        .execute(db);

      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const buildResult = builder.build({
        table: hostTable,
        fieldLevels: [{ level: 0, fieldIds: [formulaId] }],
      });
      if (buildResult.isErr()) throw buildResult.error;

      const updateResult = new UpdateFromSelectBuilder(db).build({
        table: hostTable,
        fieldIds: [formulaId],
        selectQuery: buildResult.value.selectQuery,
        skipDistinctFilter: true,
      });
      if (updateResult.isErr()) throw updateResult.error;

      await db.executeQuery(updateResult.value);
      const rows = await sql<{ Effective: string | null }>`
        select "Effective" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" order by "__id"
      `.execute(db);
      expect(Number(rows.rows[0]?.Effective)).toBe(11);
      expect(String(rows.rows[1]?.Effective ?? '')).toContain('44');
    });

    test('numeric formula over a jsonb lookup array backfills into double precision', async () => {
      const db = pgliteDb.db as unknown as Kysely<DynamicDB>;
      const lookupId = FieldId.create(FOREIGN_LOOKUP_ID)._unsafeUnwrap();
      const formulaId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
      const leafTableId = TableId.create(LEAF_TABLE_ID)._unsafeUnwrap();
      const foreignLinkId = FieldId.create(FOREIGN_LINK_ID)._unsafeUnwrap();

      const leafBuilder = Table.builder()
        .withId(leafTableId)
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('Leaf')._unsafeUnwrap());
      leafBuilder
        .field()
        .number()
        .withId(FieldId.create(LEAF_VALUE_ID)._unsafeUnwrap())
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .done();
      leafBuilder.view().defaultGrid().done();
      const leafTable = leafBuilder.build()._unsafeUnwrap();

      const lookupOptions = LookupOptions.create({
        linkFieldId: foreignLinkId.toString(),
        foreignTableId: LEAF_TABLE_ID,
        lookupFieldId: LEAF_VALUE_ID,
      })._unsafeUnwrap();
      const leafLinkConfig = LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: LEAF_TABLE_ID,
        lookupFieldId: LEAF_VALUE_ID,
        isOneWay: true,
      })._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(TableId.create(HOST_TABLE_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('Host')._unsafeUnwrap());
      hostBuilder
        .field()
        .link()
        .withId(foreignLinkId)
        .withName(FieldName.create('LeafLink')._unsafeUnwrap())
        .withConfig(leafLinkConfig)
        .done();
      hostBuilder
        .field()
        .lookup()
        .withId(lookupId)
        .withName(FieldName.create('Amounts')._unsafeUnwrap())
        .withLookupOptions(lookupOptions)
        .withInnerField(
          createNumberField({
            id: FieldId.create(LEAF_VALUE_ID)._unsafeUnwrap(),
            name: FieldName.create('Amount')._unsafeUnwrap(),
          })._unsafeUnwrap()
        )
        .done();
      hostBuilder.addFieldFromResult(
        createFormulaField({
          id: formulaId,
          name: FieldName.create('AmountPlus')._unsafeUnwrap(),
          expression: FormulaExpression.create(`{${lookupId.toString()}} + 1`)._unsafeUnwrap(),
        })
      );
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build({ foreignTables: [leafTable] })._unsafeUnwrap();
      hostTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('Amounts')._unsafeUnwrap())
        ._unsafeUnwrap();
      hostTable
        .getFields()[1]
        .setDbFieldType(DbFieldType.rehydrate('JSON')._unsafeUnwrap())
        ._unsafeUnwrap();
      hostTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('AmountPlus')._unsafeUnwrap())
        ._unsafeUnwrap();
      hostTable
        .getFields()[2]
        .setDbFieldType(DbFieldType.rehydrate('REAL')._unsafeUnwrap())
        ._unsafeUnwrap();

      await sql
        .raw(`drop table if exists "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" cascade`)
        .execute(db);
      await sql
        .raw(
          `create table "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" (
            "__id" text primary key,
            "__version" integer not null default 1,
            "Amounts" jsonb,
            "AmountPlus" double precision
          )`
        )
        .execute(db);
      await sql
        .raw(
          `insert into "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" ("__id", "Amounts")
           values ('rec1', '[10, 30]'::jsonb)`
        )
        .execute(db);

      const builder = new SameTableBatchQueryBuilder(db, typeValidationStrategy);
      const buildResult = builder.build({
        table: hostTable,
        fieldLevels: [{ level: 0, fieldIds: [formulaId] }],
      });
      if (buildResult.isErr()) throw buildResult.error;

      const updateResult = new UpdateFromSelectBuilder(db).build({
        table: hostTable,
        fieldIds: [formulaId],
        selectQuery: buildResult.value.selectQuery,
        skipDistinctFilter: true,
      });
      if (updateResult.isErr()) throw updateResult.error;

      await db.executeQuery(updateResult.value);
      const rows = await sql<{ AmountPlus: number | null }>`
        select "AmountPlus" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm"
      `.execute(db);
      expect(Number(rows.rows[0]?.AmountPlus)).toBeGreaterThan(0);
    });
  });
});
