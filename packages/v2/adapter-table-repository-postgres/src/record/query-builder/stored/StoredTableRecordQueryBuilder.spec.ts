import {
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  DateFormattingPreset,
  DateTimeFormatting,
  DbFieldName,
  DbFieldType,
  FieldHasError,
  FieldId,
  FieldName,
  FieldType,
  FormulaExpression,
  RecordConditionFieldReferenceValue,
  Table,
  TableId,
  TableName,
  TimeFormatting,
  UserConditionSpec,
  UserMultiplicity,
} from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql as kyselySql,
} from 'kysely';
import { describe, expect, test } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { StoredTableRecordQueryBuilder } from './StoredTableRecordQueryBuilder';

// ============================================================================
// Test Utilities
// ============================================================================

const createTestDb = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const compileQuery = (db: Kysely<DynamicDB>, builder: StoredTableRecordQueryBuilder) => {
  const result = builder.build();
  expect(result.isOk()).toBe(true);
  if (result.isErr()) throw new Error(result.error.message);
  const compiled = result.value.compile();
  return { sql: compiled.sql, parameters: compiled.parameters };
};

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const MAIN_TABLE_ID = `tbl${'m'.repeat(16)}`;

// ============================================================================
// Tests
// ============================================================================

describe('StoredTableRecordQueryBuilder', () => {
  describe('basic field types', () => {
    const createTableWithAllFields = () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();

      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('AllFieldsTable')._unsafeUnwrap());

      // Add all basic field types
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('SingleLineText')._unsafeUnwrap())
        .done();
      builder.field().longText().withName(FieldName.create('LongText')._unsafeUnwrap()).done();
      builder.field().number().withName(FieldName.create('Number')._unsafeUnwrap()).done();
      builder.field().rating().withName(FieldName.create('Rating')._unsafeUnwrap()).done();
      builder
        .field()
        .singleSelect()
        .withName(FieldName.create('SingleSelect')._unsafeUnwrap())
        .done();
      builder
        .field()
        .multipleSelect()
        .withName(FieldName.create('MultipleSelect')._unsafeUnwrap())
        .done();
      builder.field().checkbox().withName(FieldName.create('Checkbox')._unsafeUnwrap()).done();
      builder.field().attachment().withName(FieldName.create('Attachment')._unsafeUnwrap()).done();
      builder.field().date().withName(FieldName.create('Date')._unsafeUnwrap()).done();
      builder
        .field()
        .createdTime()
        .withName(FieldName.create('CreatedTime')._unsafeUnwrap())
        .done();
      builder
        .field()
        .lastModifiedTime()
        .withName(FieldName.create('LastModifiedTime')._unsafeUnwrap())
        .done();
      builder
        .field()
        .user()
        .withName(FieldName.create('User')._unsafeUnwrap())
        .withMultiplicity(UserMultiplicity.single())
        .done();
      builder.field().createdBy().withName(FieldName.create('CreatedBy')._unsafeUnwrap()).done();
      builder
        .field()
        .lastModifiedBy()
        .withName(FieldName.create('LastModifiedBy')._unsafeUnwrap())
        .done();
      builder.field().autoNumber().withName(FieldName.create('AutoNumber')._unsafeUnwrap()).done();
      builder.field().button().withName(FieldName.create('Button')._unsafeUnwrap()).done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();

      // Set db field names: col_{fieldType}
      const fields = table.getFields();
      fields[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[1]
        .setDbFieldName(DbFieldName.rehydrate('col_long_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[2].setDbFieldName(DbFieldName.rehydrate('col_number')._unsafeUnwrap())._unsafeUnwrap();
      fields[3].setDbFieldName(DbFieldName.rehydrate('col_rating')._unsafeUnwrap())._unsafeUnwrap();
      fields[4]
        .setDbFieldName(DbFieldName.rehydrate('col_single_select')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[5]
        .setDbFieldName(DbFieldName.rehydrate('col_multiple_select')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[6]
        .setDbFieldName(DbFieldName.rehydrate('col_checkbox')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[7]
        .setDbFieldName(DbFieldName.rehydrate('col_attachment')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[8].setDbFieldName(DbFieldName.rehydrate('col_date')._unsafeUnwrap())._unsafeUnwrap();
      fields[9]
        .setDbFieldName(DbFieldName.rehydrate('col_created_time')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[10]
        .setDbFieldName(DbFieldName.rehydrate('col_last_modified_time')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[11].setDbFieldName(DbFieldName.rehydrate('col_user')._unsafeUnwrap())._unsafeUnwrap();
      fields[12]
        .setDbFieldName(DbFieldName.rehydrate('col_created_by')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[13]
        .setDbFieldName(DbFieldName.rehydrate('col_last_modified_by')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[14]
        .setDbFieldName(DbFieldName.rehydrate('col_auto_number')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[15]
        .setDbFieldName(DbFieldName.rehydrate('col_button')._unsafeUnwrap())
        ._unsafeUnwrap();

      return table;
    };

    test('generates SELECT for all basic field types', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(db, qb.from(table));

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."__auto_number" as "__auto_number", "t"."__created_time" as "__created_time", "t"."__created_by" as "__created_by", "t"."__last_modified_time" as "__last_modified_time", "t"."__last_modified_by" as "__last_modified_by", "t"."col_single_line_text" as "col_single_line_text", "t"."col_long_text" as "col_long_text", "t"."col_number" as "col_number", "t"."col_rating" as "col_rating", "t"."col_single_select" as "col_single_select", "t"."col_multiple_select" as "col_multiple_select", "t"."col_checkbox" as "col_checkbox", "t"."col_attachment" as "col_attachment", "t"."col_date" as "col_date", "t"."col_created_time" as "col_created_time", "t"."col_last_modified_time" as "col_last_modified_time", "t"."col_user" as "col_user", "t"."col_created_by" as "col_created_by", "t"."col_last_modified_by" as "col_last_modified_by", "t"."col_auto_number" as "col_auto_number", "t"."col_button" as "col_button" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""`
      );
      expect(parameters).toEqual([]);
    });

    test('projects typed nulls instead of stale stored values for errored computed fields', () => {
      const db = createTestDb();
      const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
      const formulaFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
      const builder = Table.builder()
        .withId(TableId.create(MAIN_TABLE_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('ErroredComputedTable')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withId(primaryFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      builder
        .field()
        .formula()
        .withId(formulaFieldId)
        .withName(FieldName.create('Broken formula')._unsafeUnwrap())
        .withExpression(FormulaExpression.create(`{${primaryFieldId.toString()}}`)._unsafeUnwrap())
        .withResultType({
          cellValueType: CellValueType.string(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        })
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const formulaField = table
        .getField((field) => field.id().equals(formulaFieldId))
        ._unsafeUnwrap();
      formulaField
        .setDbFieldName(DbFieldName.rehydrate('col_broken_formula')._unsafeUnwrap())
        ._unsafeUnwrap();
      formulaField.setDbFieldType(DbFieldType.rehydrate('TEXT')._unsafeUnwrap())._unsafeUnwrap();
      formulaField.setHasError(FieldHasError.error());

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(
        db,
        qb.from(table).select([formulaFieldId]).orderBy(formulaFieldId, 'asc')
      );

      expect(sql).toContain('NULL::text as "col_broken_formula"');
      expect(sql).toContain('order by NULL::text asc nulls first');
      expect(sql).not.toContain('"t"."col_broken_formula"');
    });

    test('emits uncast NULL for errored computed fields with unknown dbFieldType', () => {
      const db = createTestDb();
      const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
      const formulaFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
      const builder = Table.builder()
        .withId(TableId.create(MAIN_TABLE_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('ErroredComputedTable')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withId(primaryFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      builder
        .field()
        .formula()
        .withId(formulaFieldId)
        .withName(FieldName.create('Broken formula')._unsafeUnwrap())
        .withExpression(FormulaExpression.create(`{${primaryFieldId.toString()}}`)._unsafeUnwrap())
        .withResultType({
          cellValueType: CellValueType.string(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        })
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const formulaField = table
        .getField((field) => field.id().equals(formulaFieldId))
        ._unsafeUnwrap();
      formulaField
        .setDbFieldName(DbFieldName.rehydrate('col_broken_formula')._unsafeUnwrap())
        ._unsafeUnwrap();
      // Persisted metadata is untrusted: must never reach raw SQL as a cast.
      formulaField
        .setDbFieldType(DbFieldType.rehydrate(`text) FROM x --`)._unsafeUnwrap())
        ._unsafeUnwrap();
      formulaField.setHasError(FieldHasError.error());

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).select([formulaFieldId]));

      expect(sql).toContain('NULL as "col_broken_formula"');
      expect(sql).not.toContain('NULL::');
      expect(sql).not.toContain('FROM x');
    });

    test('applies limit and offset', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(db, qb.from(table).limit(10).offset(20));

      expect(sql).toContain('limit $1 offset $2');
      expect(parameters).toEqual([10, 20]);
    });

    test('selects ordered pages through a narrow id subquery', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(
        db,
        qb.from(table).orderBy('__auto_number', 'asc').limit(10).offset(20)
      );

      // Wide rows are only fetched for the page selected by the narrow subquery.
      expect(sql).toContain('inner join (select "t"."__id" as "__id" from');
      expect(sql).toContain('as "__page" on "__page"."__id" = "t"."__id"');
      const inner = sql.slice(sql.indexOf('inner join ('), sql.indexOf('as "__page"'));
      expect(inner).not.toContain('col_single_line_text');
      expect(inner).toContain('order by "t"."__auto_number" asc');
      expect(inner).not.toContain('is null');
      expect(inner).toContain('limit $1 offset $2');
      // The outer query re-applies the ordering for the joined page rows.
      const outer = sql.slice(sql.indexOf('as "__page"'));
      expect(outer).toContain('order by');
      expect(outer).not.toContain('limit');
      expect(parameters).toEqual([10, 20]);
    });

    test('orders never-null system columns without an is-null prefix', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy('__auto_number', 'asc'));

      expect(sql).toContain('order by "t"."__auto_number" asc');
      expect(sql).not.toContain('"t"."__auto_number" is null');
    });

    test('orders nullable number columns with native nulls first', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const numberField = table
        .getFields()
        .find((field) => field.type().equals(FieldType.number()));

      expect(numberField).toBeDefined();
      if (!numberField) return;

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy(numberField.id(), 'asc').limit(10));

      const inner = sql.slice(sql.indexOf('inner join ('), sql.indexOf('as "__page"'));
      expect(inner).toContain('order by "t"."col_number" asc nulls first');
      expect(inner).not.toContain('is null');
      expect(sql).toContain('"t"."col_number" asc nulls first');
    });

    test('orders fields through the masked CASE value', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const [visibilityField, , numberField] = table.getFields();
      expect(visibilityField).toBeDefined();
      expect(numberField).toBeDefined();
      if (!visibilityField || !numberField) return;

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(
        db,
        qb
          .from(table)
          .fieldMaskSql(
            new Map([
              [
                numberField.id().toString(),
                kyselySql<boolean>`${kyselySql.ref('t.col_single_line_text')} = ${'visible'}`,
              ],
            ])
          )
          .orderBy(numberField.id(), 'asc')
      );

      expect(sql).toContain(
        'order by CASE WHEN "t"."col_single_line_text" = $1 THEN "t"."col_number" ELSE NULL END asc nulls first'
      );
      expect(sql).not.toContain('order by "t"."col_number" asc');
      expect(parameters).toEqual(['visible']);
    });

    test('collapses duplicate system column order keys', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(
        db,
        qb.from(table).orderBy('__auto_number', 'asc').orderBy('__auto_number', 'asc')
      );

      expect(sql.match(/order by "t"."__auto_number" asc/g)).toEqual([
        'order by "t"."__auto_number" asc',
      ]);
    });

    test('idsOnly selects just the record id column', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).idsOnly());

      expect(sql).toContain('"t"."__id" as "__id"');
      expect(sql).not.toContain('__version');
      expect(sql).not.toContain('__created_time');
      expect(sql).not.toContain('col_single_line_text');
    });

    test('valuesOnly selects id and projected field columns only', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const firstFieldId = table.getFields()[0].id();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).select([firstFieldId]).valuesOnly());

      expect(sql).toContain('"t"."__id" as "__id"');
      expect(sql).toContain('"t"."col_single_line_text" as "col_single_line_text"');
      expect(sql).not.toContain('__version');
      expect(sql).not.toContain('__auto_number');
      expect(sql).not.toContain('__created_time');
      expect(sql).not.toContain('__created_by');
      expect(sql).not.toContain('__last_modified_time');
      expect(sql).not.toContain('__last_modified_by');
      expect(sql).not.toContain('col_long_text');
    });

    test('idsOnly ordered pages return the narrow subquery without a payload join', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(
        db,
        qb.from(table).idsOnly().orderBy('__auto_number', 'asc').limit(10).offset(20)
      );

      expect(sql).not.toContain('inner join');
      expect(sql).toContain('"t"."__id" as "__id"');
      expect(sql).not.toContain('__version');
      expect(sql).toContain('order by "t"."__auto_number" asc');
      expect(sql).not.toContain('is null');
      expect(sql).toContain('limit $1 offset $2');
      expect(parameters).toEqual([10, 20]);
    });

    test('places whereExpression conditions inside the page subquery', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(
        db,
        qb
          .from(table)
          .orderBy('__auto_number', 'asc')
          .limit(10)
          .whereExpression(kyselySql<boolean>`${kyselySql.ref('t.__auto_number')} > ${5}`)
      );

      const inner = sql.slice(sql.indexOf('inner join ('), sql.indexOf('as "__page"'));
      expect(inner).toContain('where "t"."__auto_number" > $1');
      expect(inner).toContain('limit $2');
      const outer = sql.slice(0, sql.indexOf('inner join ('));
      expect(outer).not.toContain('where');
      expect(parameters).toEqual([5, 10]);
    });

    test('keeps single-query shape for unpaginated ordered reads', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy('__auto_number', 'asc'));

      expect(sql).not.toContain('inner join');
      expect(sql).toContain('order by');
    });

    test('filters by projection', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const firstFieldId = table.getFields()[0].id();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).select([firstFieldId]));

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."__auto_number" as "__auto_number", "t"."__created_time" as "__created_time", "t"."__created_by" as "__created_by", "t"."__last_modified_time" as "__last_modified_time", "t"."__last_modified_by" as "__last_modified_by", "t"."col_single_line_text" as "col_single_line_text" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""`
      );
    });

    test('orders createdTime by formatted day when time formatting omits time', () => {
      const db = createTestDb();
      const formatting = DateTimeFormatting.create({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
        timeZone: 'Asia/Singapore',
      })._unsafeUnwrap();

      const table = Table.builder()
        .withId(TableId.create(MAIN_TABLE_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('CreatedTimeSortTable')._unsafeUnwrap())
        .field()
        .createdTime()
        .withName(FieldName.create('CreatedTime')._unsafeUnwrap())
        .withFormatting(formatting)
        .done()
        .view()
        .defaultGrid()
        .done()
        .build()
        ._unsafeUnwrap();

      const createdTimeField = table.getFields()[0];
      createdTimeField
        .setDbFieldName(DbFieldName.rehydrate('col_created_time')._unsafeUnwrap())
        ._unsafeUnwrap();

      expect(createdTimeField).toBeDefined();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(
        db,
        qb.from(table).orderBy(createdTimeField.id(), 'desc')
      );

      expect(sql).toContain(
        'order by to_char(timezone($1, "t"."__created_time"), $2) desc nulls last'
      );
      expect(sql).not.toContain('is null');
      expect(parameters.slice(-2)).toEqual(['Asia/Singapore', 'YYYY-MM-DD']);
    });

    test('orders tracked lastModifiedTime by the field column not the system timestamp', () => {
      const db = createTestDb();
      const formatting = DateTimeFormatting.create({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
        timeZone: 'Asia/Shanghai',
      })._unsafeUnwrap();
      const trackedFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();

      const table = Table.builder()
        .withId(TableId.create(MAIN_TABLE_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('TrackedLastModifiedSortTable')._unsafeUnwrap())
        .field()
        .singleLineText()
        .withId(trackedFieldId)
        .withName(FieldName.create('Status')._unsafeUnwrap())
        .done()
        .field()
        .lastModifiedTime()
        .withName(FieldName.create('LastModified')._unsafeUnwrap())
        .withFormatting(formatting)
        .withTrackedFieldIds([trackedFieldId])
        .done()
        .view()
        .defaultGrid()
        .done()
        .build()
        ._unsafeUnwrap();

      const [statusField, lastModifiedTimeField] = table.getFields();
      statusField
        .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
        ._unsafeUnwrap();
      lastModifiedTimeField
        .setDbFieldName(DbFieldName.rehydrate('col_last_modified')._unsafeUnwrap())
        ._unsafeUnwrap();
      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(
        db,
        qb.from(table).orderBy(lastModifiedTimeField.id(), 'desc')
      );

      expect(sql).toContain(
        'order by to_char(timezone($1, "t"."col_last_modified"), $2) desc nulls last'
      );
      expect(sql).not.toContain('order by to_char(timezone($1, "t"."__last_modified_time")');
      expect(parameters.slice(-2)).toEqual(['Asia/Shanghai', 'YYYY-MM-DD']);
    });

    test('orders date fields by formatted year when date formatting collapses precision', () => {
      const db = createTestDb();
      const formatting = DateTimeFormatting.create({
        date: DateFormattingPreset.Y,
        time: TimeFormatting.None,
        timeZone: 'Asia/Singapore',
      })._unsafeUnwrap();

      const table = Table.builder()
        .withId(TableId.create(MAIN_TABLE_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('DateSortTable')._unsafeUnwrap())
        .field()
        .date()
        .withName(FieldName.create('Date')._unsafeUnwrap())
        .withFormatting(formatting)
        .done()
        .view()
        .defaultGrid()
        .done()
        .build()
        ._unsafeUnwrap();

      const dateField = table.getFields()[0];
      dateField.setDbFieldName(DbFieldName.rehydrate('col_date')._unsafeUnwrap())._unsafeUnwrap();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(db, qb.from(table).orderBy(dateField.id(), 'asc'));

      expect(sql).toContain('order by to_char(timezone($1, "t"."col_date"), $2) asc nulls first');
      expect(sql).not.toContain('is null');
      expect(parameters.slice(-2)).toEqual(['Asia/Singapore', 'YYYY']);
    });

    test('orders single user field by title with ASC null-first semantics', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const userField = table.getFields().find((field) => field.type().equals(FieldType.user()));

      expect(userField).toBeDefined();
      if (!userField) return;

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy(userField.id(), 'asc'));

      expect(sql).toContain('"t"."col_user"::jsonb ->> \'title\' asc nulls first');
      expect(sql).not.toContain('is null');
    });

    test('orders single user field by the group identity when flagged for group collation', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const userField = table.getFields().find((field) => field.type().equals(FieldType.user()));

      expect(userField).toBeDefined();
      if (!userField) return;

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(
        db,
        qb.from(table).orderBy(userField.id(), 'asc', { groupIdentityCollation: true })
      );

      // title over the identity (object/scalar normalized), null-first, then
      // the identity object as the same-title tiebreak — the exact collation
      // the group queries use
      expect(sql).toContain(`CASE jsonb_typeof("t"."col_user"::jsonb)`);
      expect(sql).toContain(`->> 'title' asc nulls first`);
      expect(sql).not.toContain('is null');
      expect(sql).toMatch(/END asc$/);
    });

    test('orders createdBy field by title with ASC null-first semantics', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const createdByField = table
        .getFields()
        .find((field) => field.type().equals(FieldType.createdBy()));

      expect(createdByField).toBeDefined();
      if (!createdByField) return;

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy(createdByField.id(), 'asc'));

      expect(sql).toContain(
        `coalesce(to_jsonb("t"."__created_by") ->> 'title', to_jsonb("t"."__created_by") ->> 'name', to_jsonb("t"."__created_by") #>> '{}') asc nulls first`
      );
      expect(sql).not.toContain('is null');
    });
  });

  describe('computed-like fields (selected as stored columns)', () => {
    // For stored builder, even "computed" fields are just selected as stored columns
    const createTableWithComputedFieldColumns = () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();

      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('TableWithComputedColumns')._unsafeUnwrap());

      // Simple fields that would have pre-computed values stored
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('TextField')._unsafeUnwrap())
        .done();
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('FormulaStored')._unsafeUnwrap())
        .done();
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('LinkStored')._unsafeUnwrap())
        .done();
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('LookupStored')._unsafeUnwrap())
        .done();
      builder.field().number().withName(FieldName.create('RollupStored')._unsafeUnwrap()).done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();

      // Set db field names simulating stored computed columns
      const fields = table.getFields();
      fields[0].setDbFieldName(DbFieldName.rehydrate('col_text')._unsafeUnwrap())._unsafeUnwrap();
      fields[1]
        .setDbFieldName(DbFieldName.rehydrate('col_formula_stored')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[2]
        .setDbFieldName(DbFieldName.rehydrate('col_link_stored')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[3]
        .setDbFieldName(DbFieldName.rehydrate('col_lookup_stored')._unsafeUnwrap())
        ._unsafeUnwrap();
      fields[4]
        .setDbFieldName(DbFieldName.rehydrate('col_rollup_stored')._unsafeUnwrap())
        ._unsafeUnwrap();

      return table;
    };

    test('selects all columns directly without any joins', () => {
      const db = createTestDb();
      const table = createTableWithComputedFieldColumns();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(db, qb.from(table));

      // Stored builder should select all columns directly without joins
      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."__auto_number" as "__auto_number", "t"."__created_time" as "__created_time", "t"."__created_by" as "__created_by", "t"."__last_modified_time" as "__last_modified_time", "t"."__last_modified_by" as "__last_modified_by", "t"."col_text" as "col_text", "t"."col_formula_stored" as "col_formula_stored", "t"."col_link_stored" as "col_link_stored", "t"."col_lookup_stored" as "col_lookup_stored", "t"."col_rollup_stored" as "col_rollup_stored" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""`
      );
      expect(parameters).toEqual([]);

      // Verify no LATERAL join or aggregations
      expect(sql).not.toContain('inner join lateral');
      expect(sql).not.toContain('json_agg');
      expect(sql).not.toContain('ARRAY_AGG');
    });

    test('selects only projected columns', () => {
      const db = createTestDb();
      const table = createTableWithComputedFieldColumns();
      const formulaFieldId = table.getFields()[1].id();
      const lookupFieldId = table.getFields()[3].id();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).select([formulaFieldId, lookupFieldId]));

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."__auto_number" as "__auto_number", "t"."__created_time" as "__created_time", "t"."__created_by" as "__created_by", "t"."__last_modified_time" as "__last_modified_time", "t"."__last_modified_by" as "__last_modified_by", "t"."col_formula_stored" as "col_formula_stored", "t"."col_lookup_stored" as "col_lookup_stored" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""`
      );
    });
  });

  describe('user field reference filters', () => {
    const createUserFilterTable = () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();

      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('UserFilterTable')._unsafeUnwrap());

      builder.field().user().withName(FieldName.create('Owner')._unsafeUnwrap()).done();
      builder
        .field()
        .user()
        .withName(FieldName.create('Assignees')._unsafeUnwrap())
        .withMultiplicity(UserMultiplicity.multiple())
        .done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      const ownerField = table
        .getField((field) => field.name().toString() === 'Owner')
        ._unsafeUnwrap();
      const assigneesField = table
        .getField((field) => field.name().toString() === 'Assignees')
        ._unsafeUnwrap();

      ownerField.setDbFieldName(DbFieldName.rehydrate('col_owner')._unsafeUnwrap())._unsafeUnwrap();
      assigneesField
        .setDbFieldName(DbFieldName.rehydrate('col_assignees')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { table, ownerField, assigneesField };
    };

    test('matches single user against multiple user reference by id array overlap', () => {
      const db = createTestDb();
      const { table, ownerField, assigneesField } = createUserFilterTable();
      const referenceValue =
        RecordConditionFieldReferenceValue.create(assigneesField)._unsafeUnwrap();
      const condition = UserConditionSpec.create(ownerField, 'is', referenceValue);

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).where(condition));

      expect(sql).toContain('jsonb_exists_any');
      expect(sql).toContain('jsonb_path_query_array(COALESCE(to_jsonb("t"."col_owner")');
      expect(sql).toContain("'$.id'");
      expect(sql).toContain('jsonb_path_query_array(CASE');
      expect(sql).toContain('jsonb_build_array(to_jsonb("t"."col_assignees"))');
      expect(sql).toContain("'$[*].id'");
    });

    test('orders multiple user field by titles array text with ASC null-first semantics', () => {
      const db = createTestDb();
      const { table, assigneesField } = createUserFilterTable();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy(assigneesField.id(), 'asc'));

      expect(sql).toContain('jsonb_path_query_array(CASE');
      expect(sql).toContain(`WHEN jsonb_typeof("t"."col_assignees"::jsonb) = 'array'`);
      expect(sql).toContain(
        `WHEN jsonb_typeof("t"."col_assignees"::jsonb) = 'object' THEN jsonb_build_array("t"."col_assignees"::jsonb)`
      );
      expect(sql).toContain("'$[*].title')::text asc nulls first");
      expect(sql).not.toContain('is null');
    });

    test('orders multiple user field by identity titles when flagged for group collation', () => {
      const db = createTestDb();
      const { table, assigneesField } = createUserFilterTable();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(
        db,
        qb.from(table).orderBy(assigneesField.id(), 'asc', { groupIdentityCollation: true })
      );

      // titles over the group identity array with the '[]' empty fallback,
      // then the identity itself as the same-titles tiebreak
      expect(sql).toContain('COALESCE(jsonb_path_query_array(CASE');
      expect(sql).toContain(`CASE jsonb_typeof("t"."col_assignees"::jsonb)`);
      expect(sql).toContain(`FROM jsonb_array_elements("t"."col_assignees"::jsonb) AS u`);
      expect(sql).toContain(`'$[*].title')::text, '[]') asc`);
      expect(sql).toMatch(/END asc$/);
    });
  });

  describe('error handling', () => {
    test('returns error when from() not called', () => {
      const db = createTestDb();
      const qb = new StoredTableRecordQueryBuilder(db);
      const result = qb.build();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Call from() first');
      }
    });
  });
});
