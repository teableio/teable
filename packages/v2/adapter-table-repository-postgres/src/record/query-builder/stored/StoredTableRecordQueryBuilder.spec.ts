import {
  BaseId,
  DbFieldName,
  FieldName,
  FieldType,
  RecordConditionFieldReferenceValue,
  Table,
  TableId,
  TableName,
  UserConditionSpec,
  UserMultiplicity,
} from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
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

    test('applies limit and offset', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(db, qb.from(table).limit(10).offset(20));

      expect(sql).toContain('limit $1 offset $2');
      expect(parameters).toEqual([10, 20]);
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

    test('orders by system created time for createdTime field', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const createdTimeField = table
        .getFields()
        .find((field) => field.type().equals(FieldType.createdTime()));

      expect(createdTimeField).toBeDefined();
      if (!createdTimeField) return;

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy(createdTimeField.id(), 'desc'));

      // ORDER BY should use system column, not stored column
      expect(sql).toContain('order by "t"."__created_time"');
    });

    test('orders user field by title projection with ASC null-first semantics', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const userField = table.getFields().find((field) => field.type().equals(FieldType.user()));

      expect(userField).toBeDefined();
      if (!userField) return;

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy(userField.id(), 'asc'));

      expect(sql).toContain(
        'jsonb_path_query_array(CASE WHEN jsonb_typeof(to_jsonb("t"."col_user"))'
      );
      expect(sql).toContain("'$[*].title')::text");
      expect(sql).not.toContain('"t"."col_user"::jsonb');
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
        `coalesce(to_jsonb("t"."__created_by") ->> 'title', to_jsonb("t"."__created_by") ->> 'name', to_jsonb("t"."__created_by") #>> '{}') is null desc`
      );
      expect(sql).toContain(
        `coalesce(to_jsonb("t"."__created_by") ->> 'title', to_jsonb("t"."__created_by") ->> 'name', to_jsonb("t"."__created_by") #>> '{}') asc`
      );
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
      expect(sql).toContain('jsonb_path_query_array(COALESCE(to_jsonb("t"."col_assignees")');
      expect(sql).toContain("'$[*].id'");
    });

    test('orders multiple user field by titles array text with ASC null-first semantics', () => {
      const db = createTestDb();
      const { table, assigneesField } = createUserFilterTable();

      const qb = new StoredTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).orderBy(assigneesField.id(), 'asc'));

      expect(sql).toContain(
        'jsonb_path_query_array(CASE WHEN jsonb_typeof(to_jsonb("t"."col_assignees"))'
      );
      expect(sql).toContain("'$[*].title')::text");
      expect(sql).not.toContain('"t"."col_assignees"::jsonb');
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
