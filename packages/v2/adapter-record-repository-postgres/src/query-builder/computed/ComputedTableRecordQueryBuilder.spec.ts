import {
  BaseId,
  createSingleLineTextField,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  LookupOptions,
  RollupExpression,
  RollupFieldConfig,
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
} from 'kysely';
import { describe, expect, test } from 'vitest';

import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';

// ============================================================================
// Test Utilities
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

const compileQuery = (
  db: Kysely<Record<string, Record<string, unknown>>>,
  builder: ComputedTableRecordQueryBuilder
) => {
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

      const qb = new ComputedTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(db, qb.from(table));

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."col_single_line_text" as "col_single_line_text", "t"."col_long_text" as "col_long_text", "t"."col_number" as "col_number", "t"."col_rating" as "col_rating", "t"."col_single_select" as "col_single_select", "t"."col_multiple_select" as "col_multiple_select", "t"."col_checkbox" as "col_checkbox", "t"."col_attachment" as "col_attachment", "t"."col_date" as "col_date", "t"."col_created_time" as "col_created_time", "t"."col_last_modified_time" as "col_last_modified_time", "t"."col_user" as "col_user", "t"."col_created_by" as "col_created_by", "t"."col_last_modified_by" as "col_last_modified_by", "t"."col_auto_number" as "col_auto_number", "t"."col_button" as "col_button" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""`
      );
      expect(parameters).toEqual([]);
    });

    test('applies limit and offset', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();

      const qb = new ComputedTableRecordQueryBuilder(db);
      const { sql, parameters } = compileQuery(db, qb.from(table).limit(10).offset(20));

      expect(sql).toContain('limit $1 offset $2');
      expect(parameters).toEqual([10, 20]);
    });

    test('filters by projection', () => {
      const db = createTestDb();
      const table = createTableWithAllFields();
      const firstFieldId = table.getFields()[0].id();

      const qb = new ComputedTableRecordQueryBuilder(db);
      const { sql } = compileQuery(db, qb.from(table).select([firstFieldId]));

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."col_single_line_text" as "col_single_line_text" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t""`
      );
    });
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
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(mainTable)
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
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(mainTable)
      );

      expect(sql).toMatchSnapshot(`link-${relationship}`);
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

    test('shares LATERAL JOIN between link and lookup on same link', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLookupTable();

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(mainTable)
      );

      // Should have only ONE lateral join (shared)
      const lateralCount = (sql.match(/inner join lateral/g) || []).length;
      expect(lateralCount).toBe(1);

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."col_single_line_text" as "col_single_line_text", "lat_fldkkkkkkkkkkkkkkkk"."col_link" as "col_link", "lat_fldkkkkkkkkkkkkkkkk"."col_lookup" as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select (json_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', "f"."col_single_line_text"))))[0] as "col_link", ARRAY_AGG("f"."col_single_line_text") as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."__id" = "t"."__fk_fldkkkkkkkkkkkkkkkk") as "lat_fldkkkkkkkkkkkkkkkk" on true"`
      );
    });

    test('projection with only lookup field (no link field) generates correct lateral join', () => {
      const db = createTestDb();
      const { mainTable, foreignTable, foreignTableId } = createLookupTable();

      // Get lookup field id (index 2)
      const lookupFieldId = mainTable.getFields()[2].id();

      const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables })
          .from(mainTable)
          .select([lookupFieldId])
      );

      // Should still have lateral join for lookup
      expect(sql).toContain('inner join lateral');

      // Should only select lookup column (not link column)
      expect(sql).toContain('"col_lookup"');
      expect(sql).not.toContain('"col_link"');

      // Lateral subquery should only contain lookup aggregate
      expect(sql).toContain('ARRAY_AGG');
      expect(sql).not.toContain('json_agg');

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "lat_fldkkkkkkkkkkkkkkkk"."col_lookup" as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select ARRAY_AGG("f"."col_single_line_text") as "col_lookup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."__id" = "t"."__fk_fldkkkkkkkkkkkkkkkk") as "lat_fldkkkkkkkkkkkkkkkk" on true"`
      );
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

    test.each(rollupFunctions)(
      'generates $sqlAggregate for $expression',
      ({ expression, sqlAggregate }) => {
        const db = createTestDb();
        const { mainTable, foreignTable, foreignTableId } = createRollupTable(expression);

        const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
        const { sql } = compileQuery(
          db,
          new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(mainTable)
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
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(mainTable)
      );

      expect(sql).toMatchInlineSnapshot(
        `"select "t"."__id" as "__id", "t"."col_single_line_text" as "col_single_line_text", "lat_fldkkkkkkkkkkkkkkkk"."col_link" as "col_link", "lat_fldkkkkkkkkkkkkkkkk"."col_rollup" as "col_rollup" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select json_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', "f"."col_number"))) as "col_link", SUM("f"."col_number") as "col_rollup" from "bseaaaaaaaaaaaaaaaa"."tblffffffffffffffff" as "f" where "f"."__fk_fldssssssssssssssss" = "t"."__id") as "lat_fldkkkkkkkkkkkkkkkk" on true"`
      );
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
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(mainTable)
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
        `"select "t"."__id" as "__id", "t"."col_title" as "col_title", "lat_fld1111111111111111"."col_link_project" as "col_link_project", "lat_fld2222222222222222"."col_link_categories" as "col_link_categories" from "bseaaaaaaaaaaaaaaaa"."tblmmmmmmmmmmmmmmmm" as "t" inner join lateral (select (json_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', "f"."col_project_name"))))[0] as "col_link_project" from "bseaaaaaaaaaaaaaaaa"."tblaaaaaaaaaaaaaaaa" as "f" where "f"."__id" = "t"."__fk_fld1111111111111111") as "lat_fld1111111111111111" on true inner join lateral (select json_agg(jsonb_strip_nulls(jsonb_build_object('id', "f"."__id", 'title', "f"."col_category_name"))) as "col_link_categories" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "f" where "f"."__fk_fld6666666666666666" = "t"."__id") as "lat_fld2222222222222222" on true"`
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
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(table)
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
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(table)
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
          new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(table)
        );

        // Should have only ONE lateral join (link, lookup, rollup share it)
        const lateralCount = (sql.match(/inner join lateral/g) || []).length;
        expect(lateralCount).toBe(1);

        // Should contain the rollup aggregate
        expect(sql).toContain('SUM("f"."col_salary")');

        // Should contain the lookup array
        expect(sql).toContain('ARRAY_AGG("f"."col_name")');
      }
    );

    test.each(relationships)('self-ref %s with lookup and rollup snapshot', (relationship) => {
      const db = createTestDb();
      const { table, tableId } = createSelfRefWithLookupRollup(relationship);

      const foreignTables = new Map([[tableId.toString(), table]]);
      const { sql } = compileQuery(
        db,
        new ComputedTableRecordQueryBuilder(db, { foreignTables }).from(table)
      );

      expect(sql).toMatchSnapshot(`self-ref-${relationship}-with-lookup-rollup`);
    });
  });

  describe('error handling', () => {
    test('returns error when from() not called', () => {
      const db = createTestDb();
      const qb = new ComputedTableRecordQueryBuilder(db);

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
      const qb = new ComputedTableRecordQueryBuilder(db);

      const result = qb.from(table).build();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Foreign table not found');
    });
  });
});
