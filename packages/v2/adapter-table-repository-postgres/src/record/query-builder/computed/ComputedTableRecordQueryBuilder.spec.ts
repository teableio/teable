import {
  BaseId,
  ConditionalLookupOptions,
  ConditionalRollupConfig,
  DateFormattingPreset,
  DateTimeFormatting,
  DbFieldType,
  NumberFormatting,
  NumberFormattingType,
  TimeFormatting,
  createDateField,
  createNumberField,
  createSingleLineTextField,
  DbFieldName,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  LinkFieldMeta,
  LookupOptions,
  RollupExpression,
  RollupFieldConfig,
  Table,
  TableId,
  TableName,
  UserMultiplicity,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, test } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';

// ============================================================================
// Test Utilities
// ============================================================================

const typeValidationStrategy = new Pg16TypeValidationStrategy();

const createTestDb = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const compileQuery = (db: Kysely<DynamicDB>, builder: ComputedTableRecordQueryBuilder) => {
  const result = builder.build();
  expect(result.isOk()).toBe(true);
  if (result.isErr()) throw new Error(result.error.message);
  const compiled = result.value.compile();
  return { sql: compiled.sql, parameters: compiled.parameters };
};

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const MAIN_TABLE_ID = `tbl${'m'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'f'.repeat(16)}`;
const LINK_FIELD_ID = `fld${'k'.repeat(16)}`;
const LOOKUP_TARGET_FIELD_ID = `fld${'l'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'s'.repeat(16)}`;

// ============================================================================
// Tests
// ============================================================================

describe('ComputedTableRecordQueryBuilder', () => {
  describe('all field types', () => {
    const createTableWithAllFields = () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();

      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('AllFieldsTable')._unsafeUnwrap());

      // Add all basic field types (excluding computed: formula, lookup, rollup, link)
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
      builder.field().user().withName(FieldName.create('User')._unsafeUnwrap()).done();
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

      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
      const { sql, parameters } = compileQuery(db, qb.from(table));

      expect(sql).toMatchInlineSnapshot(
        `
        "select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_single_line_text" as "col_single_line_text", "t"."col_long_text" as "col_long_text", "t"."col_number" as "col_number", "t"."col_rating" as "col_rating", "t"."col_single_select" as "col_single_select", "t"."col_multiple_select" as "col_multiple_select", "t"."col_checkbox" as "col_checkbox", "t"."col_attachment" as "col_attachment", "t"."col_date" as "col_date", "t"."__created_time" as "col_created_time", "t"."__last_modified_time" as "col_last_modified_time", "t"."col_user" as "col_user", jsonb_strip_nulls(
            CASE
              WHEN (CASE
            WHEN "t"."col_created_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_created_by")) = 'object' THEN to_jsonb("t"."col_created_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_created_by") #>> '{}', 'title', to_jsonb("t"."col_created_by") #>> '{}')
          END) IS NULL AND "t"."__created_by" IS NULL THEN NULL::jsonb
              ELSE COALESCE(
                (CASE
            WHEN "t"."col_created_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_created_by")) = 'object' THEN to_jsonb("t"."col_created_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_created_by") #>> '{}', 'title', to_jsonb("t"."col_created_by") #>> '{}')
          END),
                jsonb_build_object('id', "t"."__created_by", 'title', "t"."__created_by")
              ) || jsonb_build_object(
                'id', COALESCE((CASE
            WHEN "t"."col_created_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_created_by")) = 'object' THEN to_jsonb("t"."col_created_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_created_by") #>> '{}', 'title', to_jsonb("t"."col_created_by") #>> '{}')
          END)->>'id', "t"."__created_by"),
                'title', COALESCE((CASE
            WHEN "t"."col_created_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_created_by")) = 'object' THEN to_jsonb("t"."col_created_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_created_by") #>> '{}', 'title', to_jsonb("t"."col_created_by") #>> '{}')
          END)->>'title', (CASE
            WHEN "t"."col_created_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_created_by")) = 'object' THEN to_jsonb("t"."col_created_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_created_by") #>> '{}', 'title', to_jsonb("t"."col_created_by") #>> '{}')
          END)->>'name', (CASE
            WHEN "t"."col_created_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_created_by")) = 'object' THEN to_jsonb("t"."col_created_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_created_by") #>> '{}', 'title', to_jsonb("t"."col_created_by") #>> '{}')
          END)->>'id', "t"."__created_by")
              )
            END
          ) as "col_created_by", jsonb_strip_nulls(
            CASE
              WHEN (CASE
            WHEN "t"."col_last_modified_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_last_modified_by")) = 'object' THEN to_jsonb("t"."col_last_modified_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_last_modified_by") #>> '{}', 'title', to_jsonb("t"."col_last_modified_by") #>> '{}')
          END) IS NULL AND "t"."__last_modified_by" IS NULL THEN NULL::jsonb
              ELSE COALESCE(
                (CASE
            WHEN "t"."col_last_modified_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_last_modified_by")) = 'object' THEN to_jsonb("t"."col_last_modified_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_last_modified_by") #>> '{}', 'title', to_jsonb("t"."col_last_modified_by") #>> '{}')
          END),
                jsonb_build_object('id', "t"."__last_modified_by", 'title', "t"."__last_modified_by")
              ) || jsonb_build_object(
                'id', COALESCE((CASE
            WHEN "t"."col_last_modified_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_last_modified_by")) = 'object' THEN to_jsonb("t"."col_last_modified_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_last_modified_by") #>> '{}', 'title', to_jsonb("t"."col_last_modified_by") #>> '{}')
          END)->>'id', "t"."__last_modified_by"),
                'title', COALESCE((CASE
            WHEN "t"."col_last_modified_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_last_modified_by")) = 'object' THEN to_jsonb("t"."col_last_modified_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_last_modified_by") #>> '{}', 'title', to_jsonb("t"."col_last_modified_by") #>> '{}')
          END)->>'title', (CASE
            WHEN "t"."col_last_modified_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_last_modified_by")) = 'object' THEN to_jsonb("t"."col_last_modified_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_last_modified_by") #>> '{}', 'title', to_jsonb("t"."col_last_modified_by") #>> '{}')
          END)->>'name', (CASE
            WHEN "t"."col_last_modified_by" IS NULL THEN NULL::jsonb
            WHEN jsonb_typeof(to_jsonb("t"."col_last_modified_by")) = 'object' THEN to_jsonb("t"."col_last_modified_by")
            ELSE jsonb_build_object('id', to_jsonb("t"."col_last_modified_by") #>> '{}', 'title', to_jsonb("t"."col_last_modified_by") #>> '{}')
          END)->>'id', "t"."__last_modified_by")
              )
            END
          ) as "col_last_modified_by", "t"."__auto_number" as "col_auto_number", "t"."col_button" as "col_button" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""
      `
      );
      expect(sql).not.toContain('public.users');
      expect(parameters).toEqual([]);
    });

    test('applies limit and offset', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
      const { sql, parameters } = compileQuery(db, qb.from(table).limit(10).offset(20));

      expect(sql).toContain('limit $1 offset $2');
      expect(parameters).toEqual([10, 20]);
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

      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
      const { sql, parameters } = compileQuery(
        db,
        qb.from(table).orderBy(createdTimeField.id(), 'desc')
      );

      expect(sql).toMatch(
        /order by to_char\(timezone\(\$\d+, "t"\."__created_time"\), \$\d+\) is null asc/
      );
      expect(sql).toMatch(/to_char\(timezone\(\$\d+, "t"\."__created_time"\), \$\d+\) desc/);
      expect(parameters.slice(-4)).toEqual([
        'Asia/Singapore',
        'YYYY-MM-DD',
        'Asia/Singapore',
        'YYYY-MM-DD',
      ]);
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

      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
      const { sql, parameters } = compileQuery(db, qb.from(table).orderBy(dateField.id(), 'asc'));

      expect(sql).toMatch(
        /order by to_char\(timezone\(\$\d+, "t"\."col_date"\), \$\d+\) is null desc/
      );
      expect(sql).toMatch(/to_char\(timezone\(\$\d+, "t"\."col_date"\), \$\d+\) asc/);
      expect(parameters.slice(-4)).toEqual(['Asia/Singapore', 'YYYY', 'Asia/Singapore', 'YYYY']);
    });

    test('aligns sort semantics with v1 for null and user-like fields', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const numberFieldId = table.getFields()[2].id();
      const userFieldId = table.getFields()[11].id();
      const createdByFieldId = table.getFields()[12].id();

      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
      const { sql } = compileQuery(
        db,
        qb
          .from(table)
          .orderBy(numberFieldId, 'asc')
          .orderBy(userFieldId, 'asc')
          .orderBy(createdByFieldId, 'asc')
      );

      expect(sql).toContain('"t"."col_number" is null desc');
      expect(sql).toContain('"t"."col_number" asc');
      expect(sql).toContain('"t"."col_user"::jsonb ->> \'title\' is null desc');
      expect(sql).toContain('"t"."col_user"::jsonb ->> \'title\' asc');
      expect(sql).toContain(
        'coalesce(to_jsonb("t"."__created_by") ->> \'title\', to_jsonb("t"."__created_by") ->> \'name\', to_jsonb("t"."__created_by") #>> \'{}\') is null desc'
      );
    });

    test('filters by projection', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const firstFieldId = table.getFields()[0].id();

      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
      const { sql } = compileQuery(db, qb.from(table).select([firstFieldId]));

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_single_line_text" as "col_single_line_text" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""`
      );
    });
  });

  describe('date add source typing', () => {
    const compileDateAddSql = (unitLiteral: string) => {
      const db = createTestDb();
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const dateFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
      const formulaFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();

      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('DateAddTable')._unsafeUnwrap());
      builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
      builder
        .field()
        .date()
        .withId(dateFieldId)
        .withName(FieldName.create('Date')._unsafeUnwrap())
        .done();
      builder
        .field()
        .formula()
        .withId(formulaFieldId)
        .withName(FieldName.create('DatePlusOne')._unsafeUnwrap())
        .withExpression(
          FormulaExpression.create(
            `DATE_ADD({${dateFieldId.toString()}}, 1, '${unitLiteral}')`
          )._unsafeUnwrap()
        )
        .done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      table
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_date')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_date_plus_one')._unsafeUnwrap())
        ._unsafeUnwrap();

      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy }).from(table)
      );

      return sql.replace(/\s+/g, ' ');
    };

    test.each([
      ['days', "INTERVAL '1 day'"],
      ['weeks', "INTERVAL '1 week'"],
      ['hours', "INTERVAL '1 hour'"],
      ['months', "INTERVAL '1 month'"],
    ])(
      'generates DATE_ADD from date column for %s without text reparsing',
      (unitLiteral, expectedInterval) => {
        const normalizedSql = compileDateAddSql(unitLiteral);
        expect(normalizedSql).toContain(
          `("t"."col_date")::timestamptz + ((1)::double precision) * ${expectedInterval}`
        );
        expect(normalizedSql).not.toContain('__teable_input_is_valid((("t"."col_date")::text');
      }
    );
  });

  describe('link field with all relationship types', () => {
    const relationships = ['oneOne', 'oneMany', 'manyOne', 'manyMany'] as const;
    const expectedMultiValue: Record<(typeof relationships)[number], boolean> = {
      oneOne: false,
      oneMany: true,
      manyOne: false,
      manyMany: true,
    };

    const createLinkedTables = (relationship: (typeof relationships)[number]) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      // Foreign table
      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(lookupFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();

      // Link config - let table builder generate FK configs automatically
      const linkConfig = LinkFieldConfig.create({
        relationship,
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      // Main table
      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder.view().defaultGrid().done();

      // Build with foreign table so FK configs are generated
      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { mainTable, foreignTable, foreignTableId };
    };

    test.each(relationships)('generates correct SQL for %s relationship', (relationship) => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLinkedTables(relationship);

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      // Verify lateral join exists
      expect(sql).toContain('inner join lateral');

      // Verify JSON object structure
      expect(sql).toContain("jsonb_build_object('id'");
      expect(sql).toContain("'title'");

      // Verify multi-value vs single-value based on [0] presence
      if (expectedMultiValue[relationship]) {
        // Multi-value: json_agg returns array directly (no [0])
        expect(sql).not.toContain(')[0]');
      } else {
        // Single-value: (json_agg(...))[0] extracts first element
        expect(sql).toContain(')[0]');
      }
    });

    test.each(relationships)('%s relationship snapshot', (relationship) => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLinkedTables(relationship);

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toMatchSnapshot(`link-${relationship}`);
    });

    test('multi-value link fields include __id as tie-breaker for stable ordering', () => {
      // This test verifies that multi-value link fields (oneMany, manyMany) include
      // junction table's __id as a secondary sort key to ensure stable ordering
      // when multiple records have the same __order value (e.g., when viewing
      // symmetric link from the "foreign" side).

      // Create a manyMany link field with order column enabled
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      // Foreign table
      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(lookupFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();

      // Link config with order column
      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      // Meta with hasOrderColumn: true
      const linkMeta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap()!;

      // Main table
      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .withMeta(linkMeta)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();

      const db = createTestDb();
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      // Verify the ORDER BY clause includes both __order and __id subqueries
      // for junction-based relationships (manyMany)
      // The SQL should contain two subqueries: one for __order and one for __id
      expect(sql).toContain('"j"."__order"');
      expect(sql).toContain('"j"."__id"');

      // Both should be in ORDER BY context
      expect(sql).toMatch(/ORDER BY.*"j"\."__order".*"j"\."__id"/i);
    });

    test('oneMany link field includes __id as tie-breaker for stable ordering', () => {
      // Create a oneMany link field with order column enabled
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      // Foreign table
      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(lookupFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();

      // Link config - oneMany (two-way) uses foreign table for order
      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      // Meta with hasOrderColumn: true
      const linkMeta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap()!;

      // Main table
      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .withMeta(linkMeta)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();

      const db = createTestDb();
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      // For oneMany (two-way), the ordering uses foreign table columns
      // The SQL should include both order column and __id from foreign table
      expect(sql).toContain('"f"."__id"');
      // Verify ORDER BY includes the tie-breaker
      expect(sql).toMatch(/ORDER BY.*"f"\./i);
    });
  });

  describe('lookup field', () => {
    const createLookupTable = () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      // Foreign table
      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(lookupFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();

      // Link config - let table builder generate FK configs
      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      // Lookup options
      const lookupOptions = LookupOptions.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap();

      // Inner field for lookup
      const innerField = createSingleLineTextField({
        id: FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap(),
        name: FieldName.create('InnerText')._unsafeUnwrap(),
      })._unsafeUnwrap();

      // Main table
      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder
        .field()
        .lookup()
        .withName(FieldName.create('LookupTitle')._unsafeUnwrap())
        .withLookupOptions(lookupOptions)
        .withInnerField(innerField)
        .done();
      mainBuilder.view().defaultGrid().done();

      // Build with foreign table so FK configs are generated
      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_lookup')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { mainTable, foreignTable, foreignTableId };
    };

    const createNestedLookupChain = (options?: { filteredInner?: boolean }) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const hostTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const middleTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const sourceTableId = TableId.create(`tbl${'n'.repeat(16)}`)._unsafeUnwrap();
      const sourceTitleFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
      const sourceValueFieldId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
      const sourceStatusFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
      const middleTitleFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
      const middleLinkFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
      const middleLookupFieldId = FieldId.create(`fld${'u'.repeat(16)}`)._unsafeUnwrap();
      const hostTitleFieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();
      const hostLinkFieldId = FieldId.create(`fld${'w'.repeat(16)}`)._unsafeUnwrap();
      const hostLookupFieldId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();

      const lookupInnerField = createNumberField({
        id: sourceValueFieldId,
        name: FieldName.create('InnerAmount')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const sourceBuilder = Table.builder()
        .withId(sourceTableId)
        .withBaseId(baseId)
        .withName(TableName.create('LookupLeaf')._unsafeUnwrap());
      sourceBuilder
        .field()
        .singleLineText()
        .withId(sourceTitleFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      sourceBuilder
        .field()
        .number()
        .withId(sourceValueFieldId)
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .done();
      sourceBuilder
        .field()
        .singleLineText()
        .withId(sourceStatusFieldId)
        .withName(FieldName.create('Status')._unsafeUnwrap())
        .done();
      sourceBuilder.view().defaultGrid().done();

      const sourceTable = sourceBuilder.build()._unsafeUnwrap();
      sourceTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_leaf_name')._unsafeUnwrap())
        ._unsafeUnwrap();
      sourceTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_leaf_amount')._unsafeUnwrap())
        ._unsafeUnwrap();
      sourceTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_leaf_status')._unsafeUnwrap())
        ._unsafeUnwrap();

      const middleLinkConfig = LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: sourceTableId.toString(),
        lookupFieldId: sourceTitleFieldId.toString(),
        symmetricFieldId: `fld${'y'.repeat(16)}`,
        isOneWay: true,
      })._unsafeUnwrap();
      const middleLookupOptions = LookupOptions.create({
        linkFieldId: middleLinkFieldId.toString(),
        foreignTableId: sourceTableId.toString(),
        lookupFieldId: sourceValueFieldId.toString(),
        ...(options?.filteredInner
          ? {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: sourceStatusFieldId.toString(),
                    operator: 'is',
                    value: 'active',
                  },
                ],
              },
            }
          : {}),
      })._unsafeUnwrap();

      const middleBuilder = Table.builder()
        .withId(middleTableId)
        .withBaseId(baseId)
        .withName(TableName.create('LookupBridge')._unsafeUnwrap());
      middleBuilder
        .field()
        .singleLineText()
        .withId(middleTitleFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      middleBuilder
        .field()
        .link()
        .withId(middleLinkFieldId)
        .withName(FieldName.create('Leaf')._unsafeUnwrap())
        .withConfig(middleLinkConfig)
        .done();
      middleBuilder
        .field()
        .lookup()
        .withId(middleLookupFieldId)
        .withName(FieldName.create('LeafAmounts')._unsafeUnwrap())
        .withLookupOptions(middleLookupOptions)
        .withInnerField(lookupInnerField)
        .done();
      middleBuilder.view().defaultGrid().done();

      const middleTable = middleBuilder.build({ foreignTables: [sourceTable] })._unsafeUnwrap();
      middleTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_bridge_name')._unsafeUnwrap())
        ._unsafeUnwrap();
      middleTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_bridge_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      middleTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_lookup_value')._unsafeUnwrap())
        ._unsafeUnwrap();
      middleTable
        .getFields()[2]
        .setDbFieldType(DbFieldType.rehydrate('JSON')._unsafeUnwrap())
        ._unsafeUnwrap();

      const hostLinkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: middleTableId.toString(),
        lookupFieldId: middleTitleFieldId.toString(),
        symmetricFieldId: `fld${'z'.repeat(16)}`,
      })._unsafeUnwrap();
      const hostLookupOptions = LookupOptions.create({
        linkFieldId: hostLinkFieldId.toString(),
        foreignTableId: middleTableId.toString(),
        lookupFieldId: middleLookupFieldId.toString(),
      })._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(TableName.create('LookupHost')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostTitleFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      hostBuilder
        .field()
        .link()
        .withId(hostLinkFieldId)
        .withName(FieldName.create('Bridge')._unsafeUnwrap())
        .withConfig(hostLinkConfig)
        .done();
      hostBuilder
        .field()
        .lookup()
        .withId(hostLookupFieldId)
        .withName(FieldName.create('BridgeAmounts')._unsafeUnwrap())
        .withLookupOptions(hostLookupOptions)
        .withInnerField(lookupInnerField)
        .done();
      hostBuilder.view().defaultGrid().done();

      const hostTable = hostBuilder.build({ foreignTables: [middleTable] })._unsafeUnwrap();
      hostTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_host_name')._unsafeUnwrap())
        ._unsafeUnwrap();
      hostTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_host_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      hostTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_nested_lookup')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { hostTable, middleTable, middleTableId };
    };

    type TitleFormattingCase = {
      fieldType: 'number' | 'date';
      expectedSql: string;
    };

    const createFormattedTitleTable = (caseItem: TitleFormattingCase) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());

      if (caseItem.fieldType === 'number') {
        const formatting = NumberFormatting.create({
          type: NumberFormattingType.Decimal,
          precision: 2,
        })._unsafeUnwrap();
        foreignBuilder
          .field()
          .number()
          .withId(lookupFieldId)
          .withName(FieldName.create('Amount')._unsafeUnwrap())
          .withFormatting(formatting)
          .done();
      } else {
        const formatting = DateTimeFormatting.create({
          date: 'YYYY/MM/DD',
          time: TimeFormatting.Hour24,
          timeZone: 'UTC',
        })._unsafeUnwrap();
        foreignBuilder
          .field()
          .date()
          .withId(lookupFieldId)
          .withName(FieldName.create('Due')._unsafeUnwrap())
          .withFormatting(formatting)
          .done();
      }
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(
          DbFieldName.rehydrate(
            caseItem.fieldType === 'number' ? 'col_number' : 'col_date'
          )._unsafeUnwrap()
        )
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { mainTable, foreignTable, foreignTableId };
    };

    test.each<TitleFormattingCase>([
      {
        fieldType: 'number',
        expectedSql: 'trim(to_char(("f"."col_number")::numeric, \'999999990D00\'))',
      },
      {
        fieldType: 'date',
        expectedSql:
          'TO_CHAR(("f"."col_date")::timestamptz AT TIME ZONE \'UTC\', \'YYYY/MM/DD HH24:MI\')',
      },
    ])('formats link titles with $fieldType formatting', (caseItem) => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createFormattedTitleTable(caseItem);

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toContain(caseItem.expectedSql);
    });

    test('falls back to foreign primary field when lookup field is checkbox', () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignCheckboxTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(primaryFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignBuilder
        .field()
        .checkbox()
        .withId(lookupFieldId)
        .withName(FieldName.create('Flag')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_primary')._unsafeUnwrap())
        ._unsafeUnwrap();
      foreignTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_flag')._unsafeUnwrap())
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();

      const db = createTestDb();
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toContain('("f"."col_primary")::text');
      expect(sql).not.toContain('"f"."col_flag"');
    });

    test('link title from scalar formula does not use jsonb_array_elements', () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
      const formulaFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignFormulaTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(primaryFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      foreignBuilder
        .field()
        .formula()
        .withId(formulaFieldId)
        .withName(FieldName.create('FormulaTitle')._unsafeUnwrap())
        .withExpression(
          FormulaExpression.create(`{${primaryFieldId.toString()}} & " - Stage"`)._unsafeUnwrap()
        )
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
        ._unsafeUnwrap();
      foreignTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_formula')._unsafeUnwrap())
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: formulaFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();

      const db = createTestDb();
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toContain('("f"."col_formula")::text');
      expect(sql).not.toContain('jsonb_array_elements');
    });

    test('formula reference to link uses stored link title snapshot', () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
      const foreignTitleFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
      const formulaFieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignTitleFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_title')._unsafeUnwrap())
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignTitleFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder
        .field()
        .formula()
        .withId(formulaFieldId)
        .withName(FieldName.create('LinkTitleFormula')._unsafeUnwrap())
        .withExpression(FormulaExpression.create(`{${linkFieldId.toString()}}`)._unsafeUnwrap())
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link_title_formula')._unsafeUnwrap())
        ._unsafeUnwrap();

      const db = createTestDb();
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy })
          .from(mainTable)
          .select([formulaFieldId])
      );

      expect(sql).toContain(`COALESCE(("t"."col_link")::jsonb->>'title'`);
      expect(sql).not.toContain('"f"."col_title"');
    });

    test('shares LATERAL JOIN between link and lookup on same link', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLookupTable();

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      // Should have only ONE lateral join (shared)
      const lateralCount = (sql.match(/inner join lateral/g) || []).length;
      expect(lateralCount).toBe(1);

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_single_line_text" as "col_single_line_text", "lat_fldkkkkkkkkkkkkkkkk_0"."col_link" as "col_link", "lat_fldkkkkkkkkkkkkkkkk_0"."col_lookup" as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select (jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', ("f"."col_single_line_text")::text))))[0] as "col_link", jsonb_agg(to_jsonb("f"."col_single_line_text")) FILTER (WHERE "f"."col_single_line_text" IS NOT NULL) as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."__id" = "t"."__fk_fldkkkkkkkkkkkkkkkk") as "lat_fldkkkkkkkkkkkkkkkk_0" on true"`
      );
    });

    test('coerces single-value number lookup json scalar before boolean formula comparison', () => {
      const db = createTestDb();
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
      const formulaFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
      const amountFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .number()
        .withId(amountFieldId)
        .withName(FieldName.create('Rate')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_rate')._unsafeUnwrap())
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: amountFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();
      const lookupOptions = LookupOptions.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: amountFieldId.toString(),
      })._unsafeUnwrap();
      const innerField = createNumberField({
        id: amountFieldId,
        name: FieldName.create('Rate')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Coach')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder
        .field()
        .lookup()
        .withId(lookupFieldId)
        .withName(FieldName.create('CoachRate')._unsafeUnwrap())
        .withLookupOptions(lookupOptions)
        .withInnerField(innerField)
        .withIsMultipleCellValue(false)
        .done();
      mainBuilder
        .field()
        .formula()
        .withId(formulaFieldId)
        .withName(FieldName.create('HasRate')._unsafeUnwrap())
        .withExpression(
          FormulaExpression.create(`IF({${lookupFieldId.toString()}}, 1, 0)`)._unsafeUnwrap()
        )
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_lookup_rate')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_has_rate')._unsafeUnwrap())
        ._unsafeUnwrap();

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy })
          .from(mainTable)
          .select([formulaFieldId])
      );

      expect(sql).toContain('jsonb_agg(to_jsonb("f"."col_rate"))');
      expect(sql).toContain(`"lat_${linkFieldId.toString()}_0"."col_lookup_rate"`);
      expect(sql).toContain('to_jsonb');
      expect(sql).toContain(`#>> '{}'`);
      expect(sql).not.toContain(`"lat_${linkFieldId.toString()}_0"."col_lookup_rate" <> 0`);
    });

    test('projection with only lookup field (no link field) generates correct lateral join', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLookupTable();

      // Get lookup field id (index 2)
      const lookupFieldId = mainTable.getFields()[2].id();

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy })
          .from(mainTable)
          .select([lookupFieldId])
      );

      // Should still have lateral join for lookup
      expect(sql).toContain('inner join lateral');

      // Should only select lookup column (not link column)
      expect(sql).toContain('"col_lookup"');
      expect(sql).not.toContain('"col_link"');

      // Lateral subquery should only contain lookup aggregate (jsonb_agg for lookup)
      expect(sql).toContain('jsonb_agg(to_jsonb(');
      // Should not have jsonb_strip_nulls (that's for link fields)
      expect(sql).not.toContain('jsonb_strip_nulls');

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "lat_fldkkkkkkkkkkkkkkkk_0"."col_lookup" as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select jsonb_agg(to_jsonb("f"."col_single_line_text")) FILTER (WHERE "f"."col_single_line_text" IS NOT NULL) as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."__id" = "t"."__fk_fldkkkkkkkkkkkkkkkk") as "lat_fldkkkkkkkkkkkkkkkk_0" on true"`
      );
    });

    test('returns NULL lookup when lookup foreign table mismatches link foreign table', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLookupTable();
      const staleForeignTableId = TableId.create(`tbl${'g'.repeat(16)}`)._unsafeUnwrap();

      const linkField = mainTable.getFields()[1] as unknown as {
        foreignTableId: () => TableId;
      };
      linkField.foreignTableId = () => staleForeignTableId;

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const lookupField = mainTable.getFields()[2];
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy })
          .from(mainTable)
          .select([lookupField.id()])
      );

      expect(sql).toContain('NULL::jsonb as "col_lookup"');
      expect(sql).not.toContain('inner join lateral');
    });

    test('returns NULL lookup when lookup link field is missing', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLookupTable();
      const lookupField = mainTable.getFields()[2];
      const tableWithoutLink = Object.create(mainTable) as Table;
      (tableWithoutLink as unknown as { getField: () => { isErr(): true } }).getField = () => ({
        isErr: () => true,
      });

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy })
          .from(tableWithoutLink)
          .select([lookupField.id()])
      );

      expect(sql).toContain('NULL::jsonb as "col_lookup"');
      expect(sql).not.toContain('inner join lateral');
    });

    test('uses single-level flattening for lookup-of-lookup chains without inner filters', () => {
      const db = createTestDb();
      const { hostTable, middleTable, middleTableId } = createNestedLookupChain();

      const foreignTables = new Map([[middleTableId.toString(), middleTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          hostTable
        )
      );

      expect(sql).toContain('"col_nested_lookup"');
      expect(sql).toContain(
        'jsonb_array_elements(COALESCE(jsonb_agg("f"."col_lookup_value"::jsonb)'
      );
      expect(sql).toContain('WITH ORDINALITY AS outer_elem(elem, outer_ord)');
      expect(sql).toContain('ORDER BY outer_elem.outer_ord, inner_elem.inner_ord');
      expect(sql).not.toContain('WITH RECURSIVE __flat');
    });

    test('keeps recursive flattening for lookup-of-lookup chains with filtered inner lookups', () => {
      const db = createTestDb();
      const { hostTable, middleTable, middleTableId } = createNestedLookupChain({
        filteredInner: true,
      });

      const foreignTables = new Map([[middleTableId.toString(), middleTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          hostTable
        )
      );

      expect(sql).toContain('"col_nested_lookup"');
      expect(sql).toContain('jsonb_agg("f"."col_lookup_value"::jsonb');
      expect(sql).toContain('WITH RECURSIVE __flat');
    });
  });

  describe('rollup field', () => {
    const rollupFunctions = [
      { expression: 'sum({values})', sqlAggregate: 'SUM' },
      { expression: 'average({values})', sqlAggregate: 'AVG' },
      { expression: 'max({values})', sqlAggregate: 'MAX' },
      { expression: 'min({values})', sqlAggregate: 'MIN' },
      { expression: 'count({values})', sqlAggregate: 'COUNT' },
    ] as const;

    const numericRollupExpressions = [
      'countall({values})',
      'counta({values})',
      'count({values})',
      'sum({values})',
      'average({values})',
      'max({values})',
      'min({values})',
      'array_join({values})',
      'array_unique({values})',
      'array_compact({values})',
      'concatenate({values})',
    ] as const;

    const booleanRollupExpressions = ['and({values})', 'or({values})', 'xor({values})'] as const;

    const createRollupTable = (expression: string) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      // Foreign table with number field
      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .number()
        .withId(lookupFieldId)
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_number')._unsafeUnwrap())
        ._unsafeUnwrap();

      // Link config - let table builder generate FK configs
      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      // Rollup config
      const rollupConfig = RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap();

      const rollupExpr = RollupExpression.create(expression)._unsafeUnwrap();

      // Main table
      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Items')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder
        .field()
        .rollup()
        .withName(FieldName.create('Total')._unsafeUnwrap())
        .withConfig(rollupConfig)
        .withExpression(rollupExpr)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_rollup')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { mainTable, foreignTable, foreignTableId };
    };

    const createMultiValueRollupTable = (expression: string) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .multipleSelect()
        .withId(lookupFieldId)
        .withName(FieldName.create('Tags')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_tags')._unsafeUnwrap())
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const rollupConfig = RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap();

      const rollupExpr = RollupExpression.create(expression)._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Items')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder
        .field()
        .rollup()
        .withName(FieldName.create('TagsRollup')._unsafeUnwrap())
        .withConfig(rollupConfig)
        .withExpression(rollupExpr)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_rollup')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { mainTable, foreignTable, foreignTableId };
    };

    const createBooleanRollupTable = (expression: string) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .checkbox()
        .withId(lookupFieldId)
        .withName(FieldName.create('Flag')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_flag')._unsafeUnwrap())
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const rollupConfig = RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap();

      const rollupExpr = RollupExpression.create(expression)._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Items')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder
        .field()
        .rollup()
        .withName(FieldName.create('FlagRollup')._unsafeUnwrap())
        .withConfig(rollupConfig)
        .withExpression(rollupExpr)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_rollup')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { mainTable, foreignTable, foreignTableId };
    };

    test.each(rollupFunctions)(
      'generates $sqlAggregate for $expression',
      ({ expression, sqlAggregate }) => {
        const db = createTestDb();
        const { mainTable, foreignTable, foreignTableId } = createRollupTable(expression);

        const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
        const { sql } = compileQuery(
          db,
          new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
            mainTable
          )
        );

        expect(sql).toContain(`${sqlAggregate}("f"."col_number")`);
      }
    );

    test('rollup sum snapshot', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createRollupTable('sum({values})');

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_single_line_text" as "col_single_line_text", "lat_fldkkkkkkkkkkkkkkkk_0"."col_link" as "col_link", "lat_fldkkkkkkkkkkkkkkkk_0"."col_rollup" as "col_rollup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', trim(to_char(("f"."col_number")::numeric, '999999990D00')))) ORDER BY "f"."__fk_fldssssssssssssssss_order", "f"."__auto_number") as "col_link", CAST(COALESCE(SUM("f"."col_number"), 0) AS DOUBLE PRECISION) as "col_rollup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."__fk_fldssssssssssssssss" = "t"."__id") as "lat_fldkkkkkkkkkkkkkkkk_0" on true"`
      );
    });

    for (const expression of numericRollupExpressions) {
      test(`rollup snapshot for ${expression}`, () => {
        const db = createTestDb();
        const { mainTable, foreignTable, foreignTableId } = createRollupTable(expression);

        const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
        const { sql } = compileQuery(
          db,
          new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
            mainTable
          )
        );

        expect(sql).toMatchSnapshot(`rollup-${expression}`);
      });
    }

    for (const expression of booleanRollupExpressions) {
      test(`rollup snapshot for ${expression}`, () => {
        const db = createTestDb();
        const { mainTable, foreignTable, foreignTableId } = createBooleanRollupTable(expression);

        const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
        const { sql } = compileQuery(
          db,
          new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
            mainTable
          )
        );

        expect(sql).toMatchSnapshot(`rollup-${expression}`);
      });
    }

    test('rollup array_compact snapshot with multi-value field', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } =
        createMultiValueRollupTable('array_compact({values})');

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toMatchInlineSnapshot(`
        "select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_single_line_text" as "col_single_line_text", "lat_fldkkkkkkkkkkkkkkkk_0"."col_link" as "col_link", "lat_fldkkkkkkkkkkkkkkkk_0"."col_rollup" as "col_rollup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', (
                              SELECT string_agg(
                                CASE
                                  WHEN jsonb_typeof(elem) = 'object' THEN COALESCE(elem->>'title', elem->>'name', elem #>> '{}')
                                  ELSE elem #>> '{}'
                                END,
                                ', '
                                ORDER BY ord
                              )
                              FROM jsonb_array_elements((CASE
                              WHEN "f"."col_tags" IS NULL THEN '[]'::jsonb
                              WHEN jsonb_typeof(to_jsonb("f"."col_tags")) = 'array' THEN to_jsonb("f"."col_tags")
                              WHEN jsonb_typeof(to_jsonb("f"."col_tags")) = 'null' THEN '[]'::jsonb
                              ELSE jsonb_build_array(to_jsonb("f"."col_tags"))
                            END)) WITH ORDINALITY AS t(elem, ord)
                            ))) ORDER BY "f"."__fk_fldssssssssssssssss_order", "f"."__auto_number") as "col_link", (
                      WITH RECURSIVE flattened(val) AS (
                        SELECT COALESCE(jsonb_agg("f"."col_tags" ORDER BY "f"."__fk_fldssssssssssssssss_order", "f"."__auto_number") FILTER (WHERE ("f"."col_tags") IS NOT NULL AND ("f"."col_tags")::text <> ''), '[]'::jsonb)
                        UNION ALL
                        SELECT elem
                        FROM flattened
                        CROSS JOIN LATERAL jsonb_array_elements(
                          CASE
                            WHEN jsonb_typeof(flattened.val) = 'array' THEN flattened.val
                            ELSE '[]'::jsonb
                          END
                        ) AS elem
                      )
                      SELECT jsonb_agg(val) FILTER (
                        WHERE jsonb_typeof(val) <> 'array'
                          AND jsonb_typeof(val) <> 'null'
                          AND val <> '""'::jsonb
                      ) FROM flattened
                    ) as "col_rollup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."__fk_fldssssssssssssssss" = "t"."__id") as "lat_fldkkkkkkkkkkkkkkkk_0" on true"
      `);
    });

    test('rollup array_unique flattens multi-value field entries before deduplication', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } =
        createMultiValueRollupTable('array_unique({values})');

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toContain('jsonb_agg(to_jsonb(v.val))');
      expect(sql).toContain('SELECT DISTINCT val');
      expect(sql).toContain('jsonb_array_elements(COALESCE(jsonb_agg("f"."col_tags"');
      expect(sql).toContain('FILTER (WHERE "f"."col_tags" IS NOT NULL)');
    });

    test('returns NULL rollup when rollup foreign table mismatches link foreign table', () => {
      const db = createTestDb();
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const staleForeignTableId = TableId.create(`tbl${'g'.repeat(16)}`)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const staleLookupFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .number()
        .withId(lookupFieldId)
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_number')._unsafeUnwrap())
        ._unsafeUnwrap();

      const staleForeignBuilder = Table.builder()
        .withId(staleForeignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('StaleForeignTable')._unsafeUnwrap());
      staleForeignBuilder
        .field()
        .number()
        .withId(staleLookupFieldId)
        .withName(FieldName.create('StaleAmount')._unsafeUnwrap())
        .done();
      staleForeignBuilder.view().defaultGrid().done();
      const staleForeignTable = staleForeignBuilder.build()._unsafeUnwrap();
      staleForeignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_stale_number')._unsafeUnwrap())
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const rollupConfig = RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: staleForeignTableId.toString(),
        lookupFieldId: staleLookupFieldId.toString(),
      })._unsafeUnwrap();

      const rollupExpr = RollupExpression.create('sum({values})')._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      mainBuilder
        .field()
        .rollup()
        .withName(FieldName.create('RollupAmount')._unsafeUnwrap())
        .withConfig(rollupConfig)
        .withExpression(rollupExpr)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder
        .build({ foreignTables: [foreignTable, staleForeignTable] })
        ._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_rollup')._unsafeUnwrap())
        ._unsafeUnwrap();

      const foreignTables = new Map([
        [foreignTableId.toString(), foreignTable],
        [staleForeignTableId.toString(), staleForeignTable],
      ]);
      const rollupField = mainTable.getFields()[2];
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy })
          .from(mainTable)
          .select([rollupField.id()])
      );

      expect(sql).toContain('NULL as "col_rollup"');
      expect(sql).not.toContain('inner join lateral');
    });
  });

  describe('conditional rollup field', () => {
    const CONDITIONAL_ROLLUP_FIELD_ID = `fld${'c'.repeat(16)}`;
    const SECOND_CONDITIONAL_ROLLUP_FIELD_ID = `fld${'d'.repeat(16)}`;
    const FOREIGN_VALUES_FIELD_ID = `fld${'v'.repeat(16)}`;
    const FOREIGN_FILTER_FIELD_ID = `fld${'g'.repeat(16)}`;
    const FOREIGN_STATUS_FIELD_ID = `fld${'u'.repeat(16)}`;
    const HOST_FILTER_FIELD_ID = `fld${'h'.repeat(16)}`;

    const createConditionalRollupTable = (
      condition: unknown,
      options?: { includeSecondRollup?: boolean; secondCondition?: unknown }
    ) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const conditionalRollupFieldId = FieldId.create(CONDITIONAL_ROLLUP_FIELD_ID)._unsafeUnwrap();
      const secondConditionalRollupFieldId = FieldId.create(
        SECOND_CONDITIONAL_ROLLUP_FIELD_ID
      )._unsafeUnwrap();
      const foreignValuesFieldId = FieldId.create(FOREIGN_VALUES_FIELD_ID)._unsafeUnwrap();
      const foreignFilterFieldId = FieldId.create(FOREIGN_FILTER_FIELD_ID)._unsafeUnwrap();
      const foreignStatusFieldId = FieldId.create(FOREIGN_STATUS_FIELD_ID)._unsafeUnwrap();
      const hostFilterFieldId = FieldId.create(HOST_FILTER_FIELD_ID)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .number()
        .withId(foreignValuesFieldId)
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .done();
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignFilterFieldId)
        .withName(FieldName.create('Category')._unsafeUnwrap())
        .done();
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignStatusFieldId)
        .withName(FieldName.create('Status')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_number')._unsafeUnwrap())
        ._unsafeUnwrap();
      foreignTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_category')._unsafeUnwrap())
        ._unsafeUnwrap();
      foreignTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
        ._unsafeUnwrap();

      const valuesField = foreignTable
        .getField((f) => f.id().equals(foreignValuesFieldId))
        ._unsafeUnwrap();

      const conditionalConfig = ConditionalRollupConfig.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignValuesFieldId.toString(),
        condition,
      })._unsafeUnwrap();
      const secondConditionalConfig = ConditionalRollupConfig.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignValuesFieldId.toString(),
        condition: options?.secondCondition ?? condition,
      })._unsafeUnwrap();
      const rollupExpr = RollupExpression.create('sum({values})')._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withId(hostFilterFieldId)
        .withName(FieldName.create('CategoryRef')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .conditionalRollup()
        .withId(conditionalRollupFieldId)
        .withName(FieldName.create('ConditionalTotal')._unsafeUnwrap())
        .withConfig(conditionalConfig)
        .withExpression(rollupExpr)
        .withValuesField(valuesField)
        .done();
      if (options?.includeSecondRollup) {
        mainBuilder
          .field()
          .conditionalRollup()
          .withId(secondConditionalRollupFieldId)
          .withName(FieldName.create('ConditionalTotalCopy')._unsafeUnwrap())
          .withConfig(secondConditionalConfig)
          .withExpression(rollupExpr)
          .withValuesField(valuesField)
          .done();
      }
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_category_ref')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_conditional_rollup')._unsafeUnwrap())
        ._unsafeUnwrap();
      if (options?.includeSecondRollup) {
        mainTable
          .getFields()[2]
          .setDbFieldName(DbFieldName.rehydrate('col_conditional_rollup_copy')._unsafeUnwrap())
          ._unsafeUnwrap();
      }

      return { mainTable, foreignTable, foreignTableId };
    };

    test('conditional rollup snapshot with literal filter', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createConditionalRollupTable({
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: FOREIGN_FILTER_FIELD_ID,
              operator: 'is',
              value: 'A',
            },
          ],
        },
      });

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).not.toContain('inner join lateral');
      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_category_ref" as "col_category_ref", "cond_fldcccccccccccccccc"."col_conditional_rollup" as "col_conditional_rollup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join (select CAST(COALESCE(SUM("f"."col_number"), 0) AS DOUBLE PRECISION) as "col_conditional_rollup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."col_category" = $1) as "cond_fldcccccccccccccccc" on true"`
      );
    });

    test('conditional rollups with the same field-reference key share one lateral scan', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createConditionalRollupTable(
        {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: FOREIGN_FILTER_FIELD_ID,
                operator: 'is',
                value: HOST_FILTER_FIELD_ID,
                isSymbol: true,
              },
              {
                fieldId: FOREIGN_STATUS_FIELD_ID,
                operator: 'is',
                value: 'active',
              },
            ],
          },
        },
        {
          includeSecondRollup: true,
          secondCondition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: FOREIGN_FILTER_FIELD_ID,
                  operator: 'is',
                  value: HOST_FILTER_FIELD_ID,
                  isSymbol: true,
                },
                {
                  fieldId: FOREIGN_STATUS_FIELD_ID,
                  operator: 'is',
                  value: 'inactive',
                },
              ],
            },
          },
        }
      );

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      const lateralCount = (sql.match(/inner join lateral/g) || []).length;
      expect(lateralCount).toBe(1);
      expect(sql).toContain('"cond_fldcccccccccccccccc"."col_conditional_rollup"');
      expect(sql).toContain('"cond_fldcccccccccccccccc"."col_conditional_rollup_copy"');
      expect(sql).toContain('from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f"');
      expect(sql).toContain('where "f"."col_category" = "t"."col_category_ref"');
      expect(sql).toContain(
        'SUM("f"."col_number") FILTER (WHERE ("f"."col_category" = "t"."col_category_ref") and ("f"."col_status" = $1))'
      );
      expect(sql).toContain(
        'SUM("f"."col_number") FILTER (WHERE ("f"."col_category" = "t"."col_category_ref") and ("f"."col_status" = $2))'
      );
    });

    test('conditional rollup falls back to lateral for complex source-only filter', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createConditionalRollupTable({
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              conjunction: 'or',
              filterSet: [
                {
                  fieldId: FOREIGN_FILTER_FIELD_ID,
                  operator: 'is',
                  value: 'A',
                },
                {
                  fieldId: FOREIGN_FILTER_FIELD_ID,
                  operator: 'is',
                  value: 'B',
                },
              ],
            },
          ],
        },
      });

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toContain('inner join lateral');
      expect(sql).toContain('"f"."col_category" = $1');
      expect(sql).toContain('"f"."col_category" = $2');
    });

    test('conditional rollup snapshot with field reference filter', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createConditionalRollupTable({
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: FOREIGN_FILTER_FIELD_ID,
              operator: 'is',
              value: HOST_FILTER_FIELD_ID,
              isSymbol: true,
            },
          ],
        },
      });

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toContain('inner join lateral');
      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_category_ref" as "col_category_ref", "cond_fldcccccccccccccccc"."col_conditional_rollup" as "col_conditional_rollup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select CAST(COALESCE(SUM("f"."col_number") FILTER (WHERE "f"."col_category" = "t"."col_category_ref"), 0) AS DOUBLE PRECISION) as "col_conditional_rollup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."col_category" = "t"."col_category_ref") as "cond_fldcccccccccccccccc" on true"`
      );
    });
  });

  describe('conditional lookup field', () => {
    const CONDITIONAL_LOOKUP_FIELD_ID = `fld${'q'.repeat(16)}`;
    const FOREIGN_TITLE_FIELD_ID = `fld${'r'.repeat(16)}`;
    const FOREIGN_OWNER_FIELD_ID = `fld${'o'.repeat(16)}`;
    const HOST_ASSIGNEES_FIELD_ID = `fld${'a'.repeat(16)}`;

    const createConditionalLookupTable = (operator: 'is' | 'isNot') => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const conditionalLookupFieldId = FieldId.create(CONDITIONAL_LOOKUP_FIELD_ID)._unsafeUnwrap();
      const foreignTitleFieldId = FieldId.create(FOREIGN_TITLE_FIELD_ID)._unsafeUnwrap();
      const foreignOwnerFieldId = FieldId.create(FOREIGN_OWNER_FIELD_ID)._unsafeUnwrap();
      const hostAssigneesFieldId = FieldId.create(HOST_ASSIGNEES_FIELD_ID)._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ConditionalLookupForeignTable')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignTitleFieldId)
        .withName(FieldName.create('Task')._unsafeUnwrap())
        .done();
      foreignBuilder
        .field()
        .user()
        .withId(foreignOwnerFieldId)
        .withName(FieldName.create('Owner')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      const foreignTitleField = foreignTable
        .getField((f) => f.id().equals(foreignTitleFieldId))
        ._unsafeUnwrap();
      foreignTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_task')._unsafeUnwrap())
        ._unsafeUnwrap();
      foreignTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_owner')._unsafeUnwrap())
        ._unsafeUnwrap();

      const conditionalLookupOptions = ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignTitleFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: foreignOwnerFieldId.toString(),
                operator,
                value: hostAssigneesFieldId.toString(),
                isSymbol: true,
              },
            ],
          },
        },
      })._unsafeUnwrap();

      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('ConditionalLookupHostTable')._unsafeUnwrap());
      mainBuilder
        .field()
        .user()
        .withId(hostAssigneesFieldId)
        .withName(FieldName.create('Assignees')._unsafeUnwrap())
        .withMultiplicity(UserMultiplicity.multiple())
        .done();
      mainBuilder
        .field()
        .conditionalLookup()
        .withId(conditionalLookupFieldId)
        .withName(FieldName.create('MatchingTasks')._unsafeUnwrap())
        .withConditionalLookupOptions(conditionalLookupOptions)
        .withInnerField(foreignTitleField)
        .done();
      mainBuilder.view().defaultGrid().done();

      const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_assignees')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_matching_tasks')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { mainTable, foreignTable, foreignTableId };
    };

    test('conditional lookup snapshot with single user is multi user field reference filter', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createConditionalLookupTable('is');
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);

      const { sql, parameters } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).not.toContain('inner join lateral');
      expect(sql).toContain('left join (select');
      expect(sql).toContain('row_number() over');
      expect(sql).toContain('partition by "h"."__id"');
      expect(sql).toContain('on "cond_fldqqqqqqqqqqqqqqqq"."__host_id" = "t"."__id"');
      expect(sql).toContain('jsonb_exists_any');
      expect(sql).toContain('to_jsonb("f"."col_owner")');
      expect(sql).toContain('to_jsonb("h"."col_assignees")');
      expect(parameters).toEqual([5000]);
    });

    test('scopes field-reference conditional lookup aggregate to dirty host rows', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createConditionalLookupTable('is');
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);

      const { sql, parameters } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy })
          .from(mainTable)
          .withDirtyFilter({ tableId: mainTable.id().toString() })
      );

      const hostDirtyJoin =
        'from (select "h".* from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "h" inner join "tmp_computed_dirty" as "__cond_dirty"';
      const foreignJoin = 'as "h" inner join "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f"';

      expect(sql).toContain('left join (select');
      expect(sql).toContain('row_number() over');
      expect(sql).toContain(hostDirtyJoin);
      expect(sql).toContain(foreignJoin);
      expect(sql.indexOf(hostDirtyJoin)).toBeLessThan(sql.indexOf(foreignJoin));
      expect(sql).toContain('"__cond_dirty"."record_id" and "__cond_dirty"."table_id" = $2');
      expect(parameters).toEqual([mainTable.id().toString(), mainTable.id().toString(), 5000]);
    });

    test('conditional lookup snapshot with single user isNot multi user field reference filter', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createConditionalLookupTable('isNot');
      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);

      const { sql, parameters } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      expect(sql).toContain('inner join lateral');
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('jsonb_array_elements_text');
      expect(sql).toContain('to_jsonb("f"."col_owner")');
      expect(sql).toContain('to_jsonb("t"."col_assignees")');
      expect(parameters).toEqual([5000]);
    });

    test('executes field-reference conditional lookup with set-based pglite query', async () => {
      const { pglite, db } = await createPGliteDb();
      try {
        const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
        const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
        const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
        const foreignKeyFieldId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
        const foreignValueFieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();
        const hostKeyFieldId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();
        const conditionalLookupFieldId = FieldId.create(
          CONDITIONAL_LOOKUP_FIELD_ID
        )._unsafeUnwrap();

        const foreignBuilder = Table.builder()
          .withId(foreignTableId)
          .withBaseId(baseId)
          .withName(TableName.create('A')._unsafeUnwrap());
        foreignBuilder
          .field()
          .singleLineText()
          .withId(foreignKeyFieldId)
          .withName(FieldName.create('A Key')._unsafeUnwrap())
          .done();
        foreignBuilder
          .field()
          .singleLineText()
          .withId(foreignValueFieldId)
          .withName(FieldName.create('A Value')._unsafeUnwrap())
          .done();
        foreignBuilder.view().defaultGrid().done();
        const foreignTable = foreignBuilder.build()._unsafeUnwrap();
        const foreignValueField = foreignTable
          .getField((field) => field.id().equals(foreignValueFieldId))
          ._unsafeUnwrap();
        foreignTable
          .getFields()[0]
          .setDbFieldName(DbFieldName.rehydrate('a_key')._unsafeUnwrap())
          ._unsafeUnwrap();
        foreignTable
          .getFields()[1]
          .setDbFieldName(DbFieldName.rehydrate('a_value')._unsafeUnwrap())
          ._unsafeUnwrap();

        const options = ConditionalLookupOptions.create({
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignValueFieldId.toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignKeyFieldId.toString(),
                  operator: 'is',
                  value: {
                    type: 'field',
                    fieldId: hostKeyFieldId.toString(),
                    tableId: mainTableId.toString(),
                  },
                },
              ],
            },
            limit: 1,
          },
        })._unsafeUnwrap();

        const mainBuilder = Table.builder()
          .withId(mainTableId)
          .withBaseId(baseId)
          .withName(TableName.create('B')._unsafeUnwrap());
        mainBuilder
          .field()
          .singleLineText()
          .withId(hostKeyFieldId)
          .withName(FieldName.create('Lookup A Key')._unsafeUnwrap())
          .done();
        mainBuilder
          .field()
          .conditionalLookup()
          .withId(conditionalLookupFieldId)
          .withName(FieldName.create('Matched A Value')._unsafeUnwrap())
          .withConditionalLookupOptions(options)
          .withInnerField(foreignValueField)
          .done();
        mainBuilder.view().defaultGrid().done();
        const mainTable = mainBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
        mainTable
          .getFields()[0]
          .setDbFieldName(DbFieldName.rehydrate('lookup_a_key')._unsafeUnwrap())
          ._unsafeUnwrap();
        mainTable
          .getFields()[1]
          .setDbFieldName(DbFieldName.rehydrate('matched_a_value')._unsafeUnwrap())
          ._unsafeUnwrap();

        await pglite.query(`create schema "${BASE_ID}"`);
        await pglite.query(`
          create table "${BASE_ID}"."${FOREIGN_TABLE_ID}" (
            "__id" text primary key,
            "__version" integer not null default 1,
            "__auto_number" integer not null,
            "a_key" text,
            "a_value" text
          )
        `);
        await pglite.query(`
          create table "${BASE_ID}"."${MAIN_TABLE_ID}" (
            "__id" text primary key,
            "__version" integer not null default 1,
            "__auto_number" integer not null,
            "lookup_a_key" text,
            "matched_a_value" jsonb
          )
        `);
        await pglite.query(`
          insert into "${BASE_ID}"."${FOREIGN_TABLE_ID}" ("__id", "__auto_number", "a_key", "a_value")
          select 'a-' || g, g, 'K-' || g, 'A-Value-' || g
          from generate_series(1, 1000) as g
        `);
        await pglite.query(`
          insert into "${BASE_ID}"."${MAIN_TABLE_ID}" ("__id", "__auto_number", "lookup_a_key")
          select 'b-' || g, g, 'K-' || g
          from generate_series(1, 1000) as g
        `);

        const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
        const result = new ComputedTableRecordQueryBuilder(db as unknown as Kysely<DynamicDB>, {
          foreignTables,
          typeValidationStrategy,
        })
          .from(mainTable)
          .select([conditionalLookupFieldId])
          .orderBy('__auto_number', 'asc')
          .limit(3)
          .build();
        expect(result.isOk()).toBe(true);
        const query = result._unsafeUnwrap();
        const compiled = query.compile();
        expect(compiled.sql).toContain('left join (select');
        expect(compiled.sql).toContain('row_number() over');
        expect(compiled.sql).not.toContain('inner join lateral');

        const rows = await query.execute();
        expect(rows).toMatchObject([
          { matched_a_value: ['A-Value-1'] },
          { matched_a_value: ['A-Value-2'] },
          { matched_a_value: ['A-Value-3'] },
        ]);
      } finally {
        await db.destroy();
      }
    });
  });

  describe('multiple links to different tables', () => {
    const FOREIGN_TABLE_A_ID = `tbl${'a'.repeat(16)}`;
    const FOREIGN_TABLE_B_ID = `tbl${'b'.repeat(16)}`;
    const LINK_FIELD_A_ID = `fld${'1'.repeat(16)}`;
    const LINK_FIELD_B_ID = `fld${'2'.repeat(16)}`;
    const LOOKUP_FIELD_A_ID = `fld${'3'.repeat(16)}`;
    const LOOKUP_FIELD_B_ID = `fld${'4'.repeat(16)}`;
    const SYMMETRIC_FIELD_A_ID = `fld${'5'.repeat(16)}`;
    const SYMMETRIC_FIELD_B_ID = `fld${'6'.repeat(16)}`;

    const createMultiLinkTable = () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const mainTableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const foreignTableAId = TableId.create(FOREIGN_TABLE_A_ID)._unsafeUnwrap();
      const foreignTableBId = TableId.create(FOREIGN_TABLE_B_ID)._unsafeUnwrap();
      const linkFieldAId = FieldId.create(LINK_FIELD_A_ID)._unsafeUnwrap();
      const linkFieldBId = FieldId.create(LINK_FIELD_B_ID)._unsafeUnwrap();
      const lookupFieldAId = FieldId.create(LOOKUP_FIELD_A_ID)._unsafeUnwrap();
      const lookupFieldBId = FieldId.create(LOOKUP_FIELD_B_ID)._unsafeUnwrap();

      // Foreign table A (Projects)
      const foreignBuilderA = Table.builder()
        .withId(foreignTableAId)
        .withBaseId(baseId)
        .withName(TableName.create('Projects')._unsafeUnwrap());
      foreignBuilderA
        .field()
        .singleLineText()
        .withId(lookupFieldAId)
        .withName(FieldName.create('ProjectName')._unsafeUnwrap())
        .done();
      foreignBuilderA.view().defaultGrid().done();

      const foreignTableA = foreignBuilderA.build()._unsafeUnwrap();
      foreignTableA
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_project_name')._unsafeUnwrap())
        ._unsafeUnwrap();

      // Foreign table B (Categories)
      const foreignBuilderB = Table.builder()
        .withId(foreignTableBId)
        .withBaseId(baseId)
        .withName(TableName.create('Categories')._unsafeUnwrap());
      foreignBuilderB
        .field()
        .singleLineText()
        .withId(lookupFieldBId)
        .withName(FieldName.create('CategoryName')._unsafeUnwrap())
        .done();
      foreignBuilderB.view().defaultGrid().done();

      const foreignTableB = foreignBuilderB.build()._unsafeUnwrap();
      foreignTableB
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_category_name')._unsafeUnwrap())
        ._unsafeUnwrap();

      // Link configs - let table builder generate FK configs
      const linkConfigA = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableAId.toString(),
        lookupFieldId: lookupFieldAId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_A_ID,
      })._unsafeUnwrap();

      const linkConfigB = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTableBId.toString(),
        lookupFieldId: lookupFieldBId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_B_ID,
      })._unsafeUnwrap();

      // Main table with two links to different tables
      const mainBuilder = Table.builder()
        .withId(mainTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Tasks')._unsafeUnwrap());
      mainBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldAId)
        .withName(FieldName.create('Project')._unsafeUnwrap())
        .withConfig(linkConfigA)
        .done();
      mainBuilder
        .field()
        .link()
        .withId(linkFieldBId)
        .withName(FieldName.create('Categories')._unsafeUnwrap())
        .withConfig(linkConfigB)
        .done();
      mainBuilder.view().defaultGrid().done();

      // Build with foreign tables so FK configs are generated
      const mainTable = mainBuilder
        .build({ foreignTables: [foreignTableA, foreignTableB] })
        ._unsafeUnwrap();
      mainTable
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_title')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link_project')._unsafeUnwrap())
        ._unsafeUnwrap();
      mainTable
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_link_categories')._unsafeUnwrap())
        ._unsafeUnwrap();

      return {
        mainTable,
        foreignTableA,
        foreignTableB,
        foreignTableAId,
        foreignTableBId,
      };
    };

    test('generates separate lateral joins with unique aliases for each link', () => {
      const db = createTestDb();
      const { mainTable, foreignTableA, foreignTableB, foreignTableAId, foreignTableBId } =
        createMultiLinkTable();

      const foreignTables = new Map([
        [foreignTableAId.toString(), foreignTableA],
        [foreignTableBId.toString(), foreignTableB],
      ]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          mainTable
        )
      );

      // Should have TWO lateral joins
      const lateralCount = (sql.match(/inner join lateral/g) || []).length;
      expect(lateralCount).toBe(2);

      // Each link field should have unique alias
      expect(sql).toContain(`lat_${LINK_FIELD_A_ID}`);
      expect(sql).toContain(`lat_${LINK_FIELD_B_ID}`);

      // Each should reference correct foreign table
      expect(sql).toContain(`"${FOREIGN_TABLE_A_ID}"`);
      expect(sql).toContain(`"${FOREIGN_TABLE_B_ID}"`);

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."__version" as "__version", "t"."col_title" as "col_title", "lat_fld1111111111111111_0"."col_link_project" as "col_link_project", "lat_fld2222222222222222_0"."col_link_categories" as "col_link_categories" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select (jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', ("f"."col_project_name")::text))))[0] as "col_link_project" from "bseaaaaaaaaaaaaaaaa"."tblaaaaaaaaaaaaaaaa" as "f" where "f"."__id" = "t"."__fk_fld1111111111111111") as "lat_fld1111111111111111_0" on true inner join lateral (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', ("f"."col_category_name")::text)) ORDER BY "f"."__fk_fld6666666666666666_order", "f"."__auto_number") as "col_link_categories" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "f" where "f"."__fk_fld6666666666666666" = "t"."__id") as "lat_fld2222222222222222_0" on true"`
      );
    });
  });

  describe('self-referential link (link to same table)', () => {
    const relationships = ['oneOne', 'oneMany', 'manyOne', 'manyMany'] as const;

    const createSelfRefTable = (relationship: (typeof relationships)[number]) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
      const primaryFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();

      // Link config - let table builder generate FK configs
      const linkConfig = LinkFieldConfig.create({
        relationship,
        foreignTableId: tableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      // Table that links to itself
      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('Employees')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withId(primaryFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      builder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Manager')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      builder.view().defaultGrid().done();

      // Build with includeSelf for self-referential link FK configs
      const table = builder.build({ includeSelf: true })._unsafeUnwrap();
      table
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link_manager')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { table, tableId };
    };

    test.each(relationships)('generates SQL for self-ref %s relationship', (relationship) => {
      const db = createTestDb();
      const { table, tableId } = createSelfRefTable(relationship);

      // Self-ref: foreign table is the same as main table
      const foreignTables = new Map([[tableId.toString(), table]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          table
        )
      );

      expect(sql).toContain('inner join lateral');
      expect(sql).toContain("jsonb_build_object('id'");
    });

    test.each(relationships)('self-ref %s relationship snapshot', (relationship) => {
      const db = createTestDb();
      const { table, tableId } = createSelfRefTable(relationship);

      const foreignTables = new Map([[tableId.toString(), table]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          table
        )
      );

      expect(sql).toMatchSnapshot(`self-ref-link-${relationship}`);
    });
  });

  describe('self-referential link with lookup and rollup', () => {
    const relationships = ['oneOne', 'oneMany', 'manyOne', 'manyMany'] as const;

    const createSelfRefWithLookupRollup = (relationship: (typeof relationships)[number]) => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
      const primaryFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const salaryFieldId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();

      // Link config - let table builder generate FK configs
      const linkConfig = LinkFieldConfig.create({
        relationship,
        foreignTableId: tableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      // Lookup options (lookup name of linked record)
      const lookupOptions = LookupOptions.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: tableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
      })._unsafeUnwrap();

      // Rollup config (sum salaries of linked records)
      const rollupConfig = RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: tableId.toString(),
        lookupFieldId: salaryFieldId.toString(),
      })._unsafeUnwrap();

      const rollupExpr = RollupExpression.create('sum({values})')._unsafeUnwrap();

      // Inner field for lookup
      const innerField = createSingleLineTextField({
        id: FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap(),
        name: FieldName.create('InnerText')._unsafeUnwrap(),
      })._unsafeUnwrap();

      // Table with self-ref link + lookup + rollup
      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('Employees')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withId(primaryFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      builder
        .field()
        .number()
        .withId(salaryFieldId)
        .withName(FieldName.create('Salary')._unsafeUnwrap())
        .done();
      builder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Reports')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      builder
        .field()
        .lookup()
        .withName(FieldName.create('ReportNames')._unsafeUnwrap())
        .withLookupOptions(lookupOptions)
        .withInnerField(innerField)
        .done();
      builder
        .field()
        .rollup()
        .withName(FieldName.create('TotalSalary')._unsafeUnwrap())
        .withConfig(rollupConfig)
        .withExpression(rollupExpr)
        .done();
      builder.view().defaultGrid().done();

      // Build with includeSelf for self-referential link FK configs
      const table = builder.build({ includeSelf: true })._unsafeUnwrap();

      table
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_salary')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_link_reports')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[3]
        .setDbFieldName(DbFieldName.rehydrate('col_lookup_names')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[4]
        .setDbFieldName(DbFieldName.rehydrate('col_rollup_salary')._unsafeUnwrap())
        ._unsafeUnwrap();

      return { table, tableId };
    };

    test.each(relationships)(
      'self-ref %s with lookup and rollup shares single lateral join',
      (relationship) => {
        const db = createTestDb();
        const { table, tableId } = createSelfRefWithLookupRollup(relationship);

        const foreignTables = new Map([[tableId.toString(), table]]);
        const { sql } = compileQuery(
          db,
          new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
            table
          )
        );

        // Should have only ONE lateral join (link, lookup, rollup share it)
        const lateralCount = (sql.match(/inner join lateral/g) || []).length;
        expect(lateralCount).toBe(1);

        // Should contain the rollup aggregate
        expect(sql).toContain('SUM("f"."col_salary")');

        // Should contain the lookup array (using jsonb_agg for JSONB storage)
        // Multi-value relationships (oneMany, manyMany) should have ORDER BY for stable ordering
        const isMultiValue = relationship === 'oneMany' || relationship === 'manyMany';
        if (isMultiValue) {
          expect(sql).toContain('jsonb_agg(to_jsonb("f"."col_name") order by');
        } else {
          expect(sql).toContain('jsonb_agg(to_jsonb("f"."col_name"))');
        }
      }
    );

    test('uses UTC ISO datetime strings for multi-value lookup aggregation', () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
      const lookupTargetFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: tableId.toString(),
        lookupFieldId: lookupTargetFieldId.toString(),
        symmetricFieldId: SYMMETRIC_FIELD_ID,
      })._unsafeUnwrap();

      const lookupOptions = LookupOptions.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: tableId.toString(),
        lookupFieldId: lookupTargetFieldId.toString(),
      })._unsafeUnwrap();

      const innerField = createDateField({
        id: FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap(),
        name: FieldName.create('InnerDate')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('SelfDateLookup')._unsafeUnwrap());
      builder
        .field()
        .date()
        .withId(lookupTargetFieldId)
        .withName(FieldName.create('Due')._unsafeUnwrap())
        .done();
      builder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Reports')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      builder
        .field()
        .lookup()
        .withName(FieldName.create('ReportDueDates')._unsafeUnwrap())
        .withLookupOptions(lookupOptions)
        .withInnerField(innerField)
        .done();
      builder.view().defaultGrid().done();

      const table = builder.build({ includeSelf: true })._unsafeUnwrap();
      table
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_due')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[1]
        .setDbFieldName(DbFieldName.rehydrate('col_link_reports')._unsafeUnwrap())
        ._unsafeUnwrap();
      table
        .getFields()[2]
        .setDbFieldName(DbFieldName.rehydrate('col_lookup_due')._unsafeUnwrap())
        ._unsafeUnwrap();

      const db = createTestDb();
      const foreignTables = new Map([[tableId.toString(), table]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          table
        )
      );

      expect(sql).toContain(
        `jsonb_agg(to_jsonb(to_char("f"."col_due" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by`
      );
    });

    test.each(relationships)('self-ref %s with lookup and rollup snapshot', (relationship) => {
      const db = createTestDb();
      const { table, tableId } = createSelfRefWithLookupRollup(relationship);

      const foreignTables = new Map([[tableId.toString(), table]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables, typeValidationStrategy }).from(
          table
        )
      );

      expect(sql).toMatchSnapshot(`self-ref-${relationship}-with-lookup-rollup`);
    });
  });

  describe('error handling', () => {
    test('returns error when from() not called', () => {
      const db = createTestDb();
      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });

      const result = qb.build();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Call from() first');
    });

    test('returns error when foreign table not provided', () => {
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(LOOKUP_TARGET_FIELD_ID)._unsafeUnwrap();
      const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('MainTable')._unsafeUnwrap());
      builder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      table
        .getFields()[0]
        .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
        ._unsafeUnwrap();

      const db = createTestDb();
      const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });

      const result = qb.from(table).build();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Foreign table not found');
    });
  });
});
