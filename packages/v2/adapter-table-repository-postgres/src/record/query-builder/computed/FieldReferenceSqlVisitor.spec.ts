import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  Table,
  TableId,
  TableName,
  UserMultiplicity,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import type { ILateralContext, LateralColumnType } from './ComputedFieldSelectExpressionVisitor';
import { FieldReferenceSqlVisitor } from './FieldReferenceSqlVisitor';

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const MAIN_TABLE_ID = `tbl${'m'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'f'.repeat(16)}`;
const FOREIGN_TITLE_FIELD_ID = `fld${'t'.repeat(16)}`;
const LINK_FIELD_ID = `fld${'k'.repeat(16)}`;
const LINK_MULTI_FIELD_ID = `fld${'l'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'s'.repeat(16)}`;
const SYMMETRIC_MULTI_FIELD_ID = `fld${'y'.repeat(16)}`;

// Mock lateral context that tracks calls
class MockLateralContext implements ILateralContext {
  public readonly calls: Array<{
    type: 'addColumn' | 'addConditionalColumn';
    linkFieldId: string;
    foreignTableId: string;
    outputAlias: string;
    columnType: LateralColumnType;
  }> = [];

  private counter = 0;

  addColumn(
    linkFieldId: FieldId,
    foreignTableId: string,
    outputAlias: string,
    columnType: LateralColumnType
  ): string {
    const alias = `lat_${this.counter++}`;
    this.calls.push({
      type: 'addColumn',
      linkFieldId: linkFieldId.toString(),
      foreignTableId,
      outputAlias,
      columnType,
    });
    return alias;
  }

  addConditionalColumn(
    conditionalFieldId: FieldId,
    foreignTableId: string,
    outputAlias: string,
    columnType: LateralColumnType
  ): string {
    const alias = `cond_lat_${this.counter++}`;
    this.calls.push({
      type: 'addConditionalColumn',
      linkFieldId: conditionalFieldId.toString(),
      foreignTableId,
      outputAlias,
      columnType,
    });
    return alias;
  }

  clear(): void {
    this.calls.length = 0;
    this.counter = 0;
  }
}

// Create test table with various field types
const createTestTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(MAIN_TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();

  // Foreign table for link
  const foreignTitleFieldId = FieldId.create(FOREIGN_TITLE_FIELD_ID)._unsafeUnwrap();
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

  // Main table
  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('TestTable')._unsafeUnwrap());

  // Scalar fields
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('SingleLineText')._unsafeUnwrap())
    .done();
  builder.field().number().withName(FieldName.create('Number')._unsafeUnwrap()).done();
  builder.field().checkbox().withName(FieldName.create('Checkbox')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Date')._unsafeUnwrap()).done();

  // System fields
  builder.field().createdTime().withName(FieldName.create('CreatedTime')._unsafeUnwrap()).done();
  builder
    .field()
    .lastModifiedTime()
    .withName(FieldName.create('LastModifiedTime')._unsafeUnwrap())
    .done();
  builder.field().createdBy().withName(FieldName.create('CreatedBy')._unsafeUnwrap()).done();
  builder
    .field()
    .lastModifiedBy()
    .withName(FieldName.create('LastModifiedBy')._unsafeUnwrap())
    .done();

  // JSON fields
  builder.field().user().withName(FieldName.create('SingleUser')._unsafeUnwrap()).done();
  builder
    .field()
    .user()
    .withName(FieldName.create('MultipleUser')._unsafeUnwrap())
    .withMultiplicity(UserMultiplicity.multiple())
    .done();
  builder.field().attachment().withName(FieldName.create('Attachment')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Button')._unsafeUnwrap()).done();

  // Single-value link field (manyOne)
  const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: foreignTable.getFields()[0].id().toString(),
    symmetricFieldId: SYMMETRIC_FIELD_ID,
  })._unsafeUnwrap();

  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('LinkSingle')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();

  // Multi-value link field (oneMany)
  const linkMultiFieldId = FieldId.create(LINK_MULTI_FIELD_ID)._unsafeUnwrap();
  const linkConfigMulti = LinkFieldConfig.create({
    relationship: 'oneMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: foreignTable.getFields()[0].id().toString(),
    symmetricFieldId: SYMMETRIC_MULTI_FIELD_ID,
  })._unsafeUnwrap();

  builder
    .field()
    .link()
    .withId(linkMultiFieldId)
    .withName(FieldName.create('LinkMultiple')._unsafeUnwrap())
    .withConfig(linkConfigMulti)
    .done();

  builder.view().defaultGrid().done();
  const table = builder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();

  // Set db field names after build
  const fields = table.getFields();
  fields[0]
    .setDbFieldName(DbFieldName.rehydrate('col_single_line_text')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[1].setDbFieldName(DbFieldName.rehydrate('col_number')._unsafeUnwrap())._unsafeUnwrap();
  fields[2].setDbFieldName(DbFieldName.rehydrate('col_checkbox')._unsafeUnwrap())._unsafeUnwrap();
  fields[3].setDbFieldName(DbFieldName.rehydrate('col_date')._unsafeUnwrap())._unsafeUnwrap();
  fields[4]
    .setDbFieldName(DbFieldName.rehydrate('col_created_time')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[5]
    .setDbFieldName(DbFieldName.rehydrate('col_last_modified_time')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[6].setDbFieldName(DbFieldName.rehydrate('col_created_by')._unsafeUnwrap())._unsafeUnwrap();
  fields[7]
    .setDbFieldName(DbFieldName.rehydrate('col_last_modified_by')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[8]
    .setDbFieldName(DbFieldName.rehydrate('col_single_user')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[9]
    .setDbFieldName(DbFieldName.rehydrate('col_multiple_user')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[10]
    .setDbFieldName(DbFieldName.rehydrate('col_attachment')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[11].setDbFieldName(DbFieldName.rehydrate('col_button')._unsafeUnwrap())._unsafeUnwrap();
  fields[12]
    .setDbFieldName(DbFieldName.rehydrate('col_link_single')._unsafeUnwrap())
    ._unsafeUnwrap();
  fields[13]
    .setDbFieldName(DbFieldName.rehydrate('col_link_multiple')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { table, foreignTable };
};

describe('FieldReferenceSqlVisitor', () => {
  const { table, foreignTable } = createTestTable();
  const mockLateral = new MockLateralContext();

  const createVisitor = () => {
    mockLateral.clear();
    return new FieldReferenceSqlVisitor({
      table,
      tableAlias: 't',
      lateral: mockLateral,
    });
  };

  const getFieldByName = (name: string) => {
    const field = table.getFields().find((f) => f.name().toString() === name);
    if (!field) throw new Error(`Field not found: ${name}`);
    return field;
  };

  describe('scalar fields', () => {
    it.each([
      ['SingleLineText'],
      ['Number'],
      ['Checkbox'],
      ['Date'],
      ['CreatedTime'],
      ['LastModifiedTime'],
    ])('should return direct column reference for %s field', (fieldName) => {
      const visitor = createVisitor();
      const field = getFieldByName(fieldName);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        fieldName,
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
        storageKind: expr.storageKind,
      }).toMatchSnapshot();
    });
  });

  describe('user ID fields', () => {
    it('should generate user name lookup SQL for CreatedBy field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('CreatedBy');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
      }).toMatchSnapshot();
    });

    it('should generate user name lookup SQL for LastModifiedBy field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('LastModifiedBy');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
      }).toMatchSnapshot();
    });
  });

  describe('JSON fields with display value extraction', () => {
    it('should extract title/name from single user field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('SingleUser');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
        storageKind: expr.storageKind,
      }).toMatchSnapshot();
    });

    it('should aggregate names from multiple user field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('MultipleUser');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
        storageKind: expr.storageKind,
      }).toMatchSnapshot();
    });

    it('should aggregate names from attachment field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('Attachment');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
        storageKind: expr.storageKind,
      }).toMatchSnapshot();
    });

    it('should extract title from button field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('Button');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
        storageKind: expr.storageKind,
      }).toMatchSnapshot();
    });
  });

  describe('link fields', () => {
    it('should extract title from single-value link field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('LinkSingle');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
        storageKind: expr.storageKind,
        lateralCalls: mockLateral.calls,
      }).toMatchSnapshot();
    });

    it('should aggregate titles from multi-value link field', () => {
      const visitor = createVisitor();
      const field = getFieldByName('LinkMultiple');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const expr = result._unsafeUnwrap();

      expect({
        valueSql: expr.valueSql,
        valueType: expr.valueType,
        isArray: expr.isArray,
        storageKind: expr.storageKind,
        lateralCalls: mockLateral.calls,
      }).toMatchSnapshot();
    });
  });
});
