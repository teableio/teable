/* eslint-disable @typescript-eslint/naming-convention */
import {
  BaseId,
  CheckboxConditionSpec,
  DbFieldName,
  FieldName,
  LongTextConditionSpec,
  NumberConditionSpec,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
  SingleLineTextConditionSpec,
  SingleSelectConditionSpec,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type Expression,
  type SqlBool,
} from 'kysely';
import { describe, expect, test } from 'vitest';

import { TableRecordConditionWhereVisitor } from './TableRecordConditionWhereVisitor';

// ============================================================================
// Utilities
// ============================================================================

const createTestDb = () =>
  new Kysely<Record<string, Record<string, unknown>>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

/**
 * Compile a RawBuilder WHERE condition to a SQL string using a dummy select.
 * Returns { sql, parameters } so we can snapshot both.
 */
const compileWhere = (db: ReturnType<typeof createTestDb>, condRaw: unknown) => {
  const compiled = db
    .selectFrom('test_table as t')
    .selectAll()
    .where(condRaw as Expression<SqlBool>)
    .compile();
  // Strip the SELECT prefix so we only snapshot the WHERE part
  const idx = compiled.sql.indexOf(' where ');
  const whereSql = idx >= 0 ? compiled.sql.slice(idx + 7) : compiled.sql;
  return { sql: whereSql, parameters: compiled.parameters };
};

// ============================================================================
// Table fixtures
// ============================================================================

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'t'.repeat(16)}`;

const createTestTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('FilterTestTable')._unsafeUnwrap());

  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Score')._unsafeUnwrap()).done();
  builder.field().singleSelect().withName(FieldName.create('Status')._unsafeUnwrap()).done();
  builder.field().checkbox().withName(FieldName.create('Done')._unsafeUnwrap()).done();
  builder.field().longText().withName(FieldName.create('Notes')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const fields = table.getFields();
  fields[0].setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())._unsafeUnwrap();
  fields[1].setDbFieldName(DbFieldName.rehydrate('col_score')._unsafeUnwrap())._unsafeUnwrap();
  fields[2].setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())._unsafeUnwrap();
  fields[3].setDbFieldName(DbFieldName.rehydrate('col_done')._unsafeUnwrap())._unsafeUnwrap();
  fields[4].setDbFieldName(DbFieldName.rehydrate('col_notes')._unsafeUnwrap())._unsafeUnwrap();

  return {
    table,
    nameField: fields[0],
    scoreField: fields[1],
    statusField: fields[2],
    doneField: fields[3],
    notesField: fields[4],
  };
};

/**
 * Helper: create a spec, run it through the visitor, and compile the WHERE SQL.
 */
const buildWhereFor = (
  db: ReturnType<typeof createTestDb>,
  spec: { accept: (v: TableRecordConditionWhereVisitor) => { isErr: () => boolean } }
) => {
  const visitor = new TableRecordConditionWhereVisitor({ tableAlias: 't' });
  const acceptResult = spec.accept(visitor);
  expect(acceptResult.isErr()).toBe(false);
  const whereResult = visitor.where();
  expect(whereResult.isOk()).toBe(true);
  if (whereResult.isErr()) throw new Error('where() failed');
  return compileWhere(db, whereResult.value);
};

// ============================================================================
// Tests
// ============================================================================

describe('TableRecordConditionWhereVisitor NULL handling', () => {
  const db = createTestDb();
  const { nameField, scoreField, statusField, doneField, notesField } = createTestTable();

  // ---- isNot ----

  describe('isNot operator', () => {
    test('text isNot uses IS DISTINCT FROM (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'isNot', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_name" is distinct from $1"`);
      expect(parameters).toEqual(['hello']);
    });

    test('number isNot uses IS DISTINCT FROM (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create(42)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'isNot', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" is distinct from $1"`);
      expect(parameters).toEqual([42]);
    });

    test('singleSelect isNot uses IS DISTINCT FROM (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('Closed')._unsafeUnwrap();
      const spec = SingleSelectConditionSpec.create(statusField, 'isNot', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_status" is distinct from $1"`);
      expect(parameters).toEqual(['Closed']);
    });
  });

  // ---- doesNotContain ----

  describe('doesNotContain operator', () => {
    test('text doesNotContain uses COALESCE (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('test')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'doesNotContain', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"coalesce("t"."col_name", '') not like $1"`);
      expect(parameters).toEqual(['%test%']);
    });

    test('longText doesNotContain uses COALESCE (includes NULL rows)', () => {
      const value = RecordConditionLiteralValue.create('note')._unsafeUnwrap();
      const spec = LongTextConditionSpec.create(notesField, 'doesNotContain', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"coalesce("t"."col_notes", '') not like $1"`);
      expect(parameters).toEqual(['%note%']);
    });

    test('text contains does NOT use COALESCE (standard LIKE)', () => {
      const value = RecordConditionLiteralValue.create('test')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'contains', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_name" like $1"`);
      expect(parameters).toEqual(['%test%']);
    });
  });

  // ---- isNoneOf ----

  describe('isNoneOf operator', () => {
    test('singleSelect isNoneOf uses COALESCE (includes NULL rows)', () => {
      const value = RecordConditionLiteralListValue.create(['Closed', 'Archived'])._unsafeUnwrap();
      const spec = SingleSelectConditionSpec.create(statusField, 'isNoneOf', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"coalesce("t"."col_status", '') not in ($1, $2)"`);
      expect(parameters).toEqual(['Closed', 'Archived']);
    });

    test('singleSelect isAnyOf does NOT use COALESCE (standard IN)', () => {
      const value = RecordConditionLiteralListValue.create(['Open', 'Active'])._unsafeUnwrap();
      const spec = SingleSelectConditionSpec.create(statusField, 'isAnyOf', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_status" in ($1, $2)"`);
      expect(parameters).toEqual(['Open', 'Active']);
    });
  });

  // ---- checkbox is(false) ----

  describe('checkbox is operator', () => {
    test('checkbox is(false) includes NULL rows (unchecked checkboxes)', () => {
      const value = RecordConditionLiteralValue.create(false)._unsafeUnwrap();
      const spec = CheckboxConditionSpec.create(doneField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"("t"."col_done" = false or "t"."col_done" is null)"`);
      expect(parameters).toEqual([]);
    });

    test('checkbox is(true) uses standard equality (no NULL special handling)', () => {
      const value = RecordConditionLiteralValue.create(true)._unsafeUnwrap();
      const spec = CheckboxConditionSpec.create(doneField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_done" = $1"`);
      expect(parameters).toEqual([true]);
    });
  });

  // ---- is (positive — no NULL special handling expected) ----

  describe('is operator (positive)', () => {
    test('text is uses standard equality', () => {
      const value = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
      const spec = SingleLineTextConditionSpec.create(nameField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_name" = $1"`);
      expect(parameters).toEqual(['hello']);
    });

    test('number is uses standard equality', () => {
      const value = RecordConditionLiteralValue.create(100)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'is', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" = $1"`);
      expect(parameters).toEqual([100]);
    });
  });

  // ---- isEmpty / isNotEmpty ----

  describe('isEmpty / isNotEmpty operators', () => {
    test('text isEmpty checks IS NULL or empty string', () => {
      const spec = SingleLineTextConditionSpec.create(nameField, 'isEmpty');
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`"("t"."col_name" is null) or ("t"."col_name" = '')"`);
      expect(parameters).toEqual([]);
    });

    test('text isNotEmpty checks IS NOT NULL and non-empty', () => {
      const spec = SingleLineTextConditionSpec.create(nameField, 'isNotEmpty');
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(
        `"("t"."col_name" is not null) and ("t"."col_name" != '')"`
      );
      expect(parameters).toEqual([]);
    });

    test('number isEmpty checks IS NULL', () => {
      const spec = NumberConditionSpec.create(scoreField, 'isEmpty');
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" is null"`);
      expect(parameters).toEqual([]);
    });
  });

  // ---- comparison operators (no COALESCE — consistent with v1) ----

  describe('comparison operators', () => {
    test('isGreater uses standard comparison (no COALESCE)', () => {
      const value = RecordConditionLiteralValue.create(50)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'isGreater', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" > $1"`);
      expect(parameters).toEqual([50]);
    });

    test('isLessEqual uses standard comparison (no COALESCE)', () => {
      const value = RecordConditionLiteralValue.create(100)._unsafeUnwrap();
      const spec = NumberConditionSpec.create(scoreField, 'isLessEqual', value);
      const { sql, parameters } = buildWhereFor(db, spec);

      expect(sql).toMatchInlineSnapshot(`""t"."col_score" <= $1"`);
      expect(parameters).toEqual([100]);
    });
  });
});
