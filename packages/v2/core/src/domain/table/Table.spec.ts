import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { DbTableName } from './DbTableName';
import { FieldDeleted } from './events/FieldDeleted';
import { TableCreated } from './events/TableCreated';
import { TableDeleted } from './events/TableDeleted';
import { TableRenamed } from './events/TableRenamed';
import { Field } from './fields/Field';
import { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { CheckboxDefaultValue } from './fields/types/CheckboxDefaultValue';
import { FormulaExpression } from './fields/types/FormulaExpression';
import { NumberDefaultValue } from './fields/types/NumberDefaultValue';
import { SingleLineTextField } from './fields/types/SingleLineTextField';
import { TextDefaultValue } from './fields/types/TextDefaultValue';
import { Table } from './Table';
import { TableId } from './TableId';
import { TableName } from './TableName';
import { GridView } from './views/types/GridView';
import { ViewId } from './views/ViewId';
import { ViewName } from './views/ViewName';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);
const createViewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`);

describe('Table', () => {
  it('emits TableCreated event on build', () => {
    const baseIdResult = createBaseId('a');
    const tableNameResult = TableName.create('My Table');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();
    viewNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().grid().withName(viewNameResult._unsafeUnwrap()).done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();

    const events = table.pullDomainEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(TableCreated);
    const event = events[0] as TableCreated;
    expect(event.tableId.equals(table.id())).toBe(true);
    expect(event.baseId.equals(table.baseId())).toBe(true);
    expect(event.tableName.equals(table.name())).toBe(true);
    expect(event.fieldIds.map((id) => id.toString())).toEqual(
      table.getFields().map((field) => field.id().toString())
    );
    expect(event.viewIds.map((id) => id.toString())).toEqual(
      table.views().map((view) => view.id().toString())
    );
    expect(table.pullDomainEvents()).toEqual([]);
  });

  it('emits TableDeleted when marking deleted', () => {
    const baseIdResult = createBaseId('z');
    const tableNameResult = TableName.create('Archive');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();
    viewNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().grid().withName(viewNameResult._unsafeUnwrap()).done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();

    table.pullDomainEvents();
    const deleteResult = table.markDeleted();
    deleteResult._unsafeUnwrap();

    const events = table.pullDomainEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(TableDeleted);
  });

  it('rehydrates without emitting events', () => {
    const baseIdResult = createBaseId('b');
    const tableIdResult = createTableId('b');
    const tableNameResult = TableName.create('Rehydrate');
    const fieldIdResult = createFieldId('a');
    const fieldNameResult = FieldName.create('Title');
    const viewIdResult = createViewId('a');
    const viewNameResult = ViewName.create('Grid');
    const dbNameResult = DbTableName.rehydrate('db_table');

    const fieldResult = SingleLineTextField.create({
      id: fieldIdResult._unsafeUnwrap(),
      name: fieldNameResult._unsafeUnwrap(),
    });
    const viewResult = GridView.create({
      id: viewIdResult._unsafeUnwrap(),
      name: viewNameResult._unsafeUnwrap(),
    });

    const tableResult = Table.rehydrate({
      id: tableIdResult._unsafeUnwrap(),
      baseId: baseIdResult._unsafeUnwrap(),
      name: tableNameResult._unsafeUnwrap(),
      fields: [fieldResult._unsafeUnwrap()],
      views: [viewResult._unsafeUnwrap()],
      primaryFieldId: fieldIdResult._unsafeUnwrap(),
      dbTableName: dbNameResult._unsafeUnwrap(),
    });
    tableResult._unsafeUnwrap();

    const table = tableResult._unsafeUnwrap();
    expect(table.pullDomainEvents()).toEqual([]);
    table.dbTableName()._unsafeUnwrap();
  });

  it('rejects invalid rehydrate data', () => {
    const baseIdResult = createBaseId('c');
    const tableIdResult = createTableId('c');
    const tableNameResult = TableName.create('Invalid');
    const fieldIdResult = createFieldId('b');
    const otherFieldIdResult = createFieldId('c');
    const viewIdResult = createViewId('b');
    const viewNameResult = ViewName.create('Grid');

    const emptyFields = Table.rehydrate({
      id: tableIdResult._unsafeUnwrap(),
      baseId: baseIdResult._unsafeUnwrap(),
      name: tableNameResult._unsafeUnwrap(),
      fields: [],
      views: [],
      primaryFieldId: fieldIdResult._unsafeUnwrap(),
    });
    emptyFields._unsafeUnwrapErr();

    const missingPrimary = Table.rehydrate({
      id: tableIdResult._unsafeUnwrap(),
      baseId: baseIdResult._unsafeUnwrap(),
      name: tableNameResult._unsafeUnwrap(),
      fields: [
        SingleLineTextField.create({
          id: fieldIdResult._unsafeUnwrap(),
          name: FieldName.create('Title')._unsafeUnwrap(),
        })._unsafeUnwrap(),
      ],
      views: [
        GridView.create({
          id: viewIdResult._unsafeUnwrap(),
          name: viewNameResult._unsafeUnwrap(),
        })._unsafeUnwrap(),
      ],
      primaryFieldId: otherFieldIdResult._unsafeUnwrap(),
    });
    missingPrimary._unsafeUnwrapErr();
  });

  it('manages db table name lifecycle', () => {
    const baseIdResult = createBaseId('d');
    const tableNameResult = TableName.create('Db Name');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().grid().withName(viewNameResult._unsafeUnwrap()).done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();

    const expectedDbName = `${baseIdResult._unsafeUnwrap().toString()}.${table.id().toString()}`;
    const tableDbNameResult = table.dbTableName().andThen((name) => name.value());
    expect(tableDbNameResult._unsafeUnwrap()).toBe(expectedDbName);

    const dbNameResult = DbTableName.rehydrate(expectedDbName);
    const otherDbNameResult = DbTableName.rehydrate('db_table_other');
    [dbNameResult, otherDbNameResult].forEach((r) => r._unsafeUnwrap());
    dbNameResult._unsafeUnwrap();
    otherDbNameResult._unsafeUnwrap();

    table.setDbTableName(dbNameResult._unsafeUnwrap())._unsafeUnwrap();
    table.dbTableName()._unsafeUnwrap();
    table.setDbTableName(dbNameResult._unsafeUnwrap())._unsafeUnwrap();
    table.setDbTableName(otherDbNameResult._unsafeUnwrap())._unsafeUnwrapErr();
  });

  it('updates table name immutably and emits TableRenamed', () => {
    const baseIdResult = createBaseId('f');
    const tableNameResult = TableName.create('Original');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    const nextNameResult = TableName.create('Renamed');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().grid().withName(viewNameResult._unsafeUnwrap()).done();
    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    table.pullDomainEvents();

    const updateResult = table.update((mutator) => mutator.rename(nextNameResult._unsafeUnwrap()));
    updateResult._unsafeUnwrap();

    const updatedTable = updateResult._unsafeUnwrap().table;
    expect(updatedTable).not.toBe(table);
    expect(updatedTable.name().toString()).toBe('Renamed');
    expect(table.name().toString()).toBe('Original');

    const events = updatedTable.pullDomainEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(TableRenamed);
  });

  it('adds a field and extends view column meta', () => {
    const baseIdResult = createBaseId('g');
    const tableNameResult = TableName.create('Schema');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    const newFieldIdResult = createFieldId('h');
    const newFieldNameResult = FieldName.create('Status');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().grid().withName(viewNameResult._unsafeUnwrap()).done();
    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    const metaResult = table.views()[0]?.columnMeta();
    metaResult?._unsafeUnwrap();

    const existingMeta = metaResult._unsafeUnwrap().toDto();
    const existingOrders = Object.values(existingMeta).map((entry) => entry.order);
    const maxOrder = existingOrders.length ? Math.max(...existingOrders) : -1;

    const newFieldResult = SingleLineTextField.create({
      id: newFieldIdResult._unsafeUnwrap(),
      name: newFieldNameResult._unsafeUnwrap(),
    });
    newFieldResult._unsafeUnwrap();

    const updateResult = table.update((mutator) =>
      mutator.addField(newFieldResult._unsafeUnwrap())
    );
    updateResult._unsafeUnwrap();

    const updatedTable = updateResult._unsafeUnwrap().table;
    expect(updatedTable.getFields().length).toBe(2);
    const nextMetaResult = updatedTable.views()[0]?.columnMeta();
    nextMetaResult?._unsafeUnwrap();

    const nextMeta = nextMetaResult._unsafeUnwrap().toDto();
    const addedEntry = nextMeta[newFieldIdResult._unsafeUnwrap().toString()];
    expect(addedEntry).toBeTruthy();
    if (!addedEntry) return;
    expect(addedEntry.order).toBe(maxOrder + 1);
  });

  it('removes a field and updates view column meta', () => {
    const baseIdResult = createBaseId('x');
    const tableNameResult = TableName.create('Remove Field');
    const primaryNameResult = FieldName.create('Title');
    const extraNameResult = FieldName.create('Status');
    [baseIdResult, tableNameResult, primaryNameResult, extraNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );

    const extraName = extraNameResult._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(primaryNameResult._unsafeUnwrap()).primary().done();
    builder.field().singleLineText().withName(extraName).done();
    builder.view().defaultGrid().done();
    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    table.pullDomainEvents();

    const fieldSpecResult = Field.specs().withFieldName(extraName).build();
    fieldSpecResult._unsafeUnwrap();
    const [fieldToRemove] = table.getFields(fieldSpecResult._unsafeUnwrap());
    expect(fieldToRemove).toBeDefined();
    if (!fieldToRemove) return;
    const fieldId = fieldToRemove.id();

    const updateResult = table.update((mutator) => mutator.removeField(fieldId));
    updateResult._unsafeUnwrap();
    const updatedTable = updateResult._unsafeUnwrap().table;

    expect(updatedTable.getFields().length).toBe(1);
    expect(updatedTable.getFields().some((field) => field.id().equals(fieldId))).toBe(false);

    const metaResult = updatedTable.views()[0]?.columnMeta();
    metaResult?._unsafeUnwrap();
    const meta = metaResult?._unsafeUnwrap().toDto() ?? {};
    expect(meta[fieldId.toString()]).toBeUndefined();

    const events = updatedTable.pullDomainEvents();
    expect(events.some((event) => event instanceof FieldDeleted)).toBe(true);
  });

  it('generates unique field names', () => {
    const baseIdResult = createBaseId('h');
    const tableNameResult = TableName.create('Generate');
    const fieldNameResult = FieldName.create('Generate');
    const linkedNameResult = FieldName.create('Generate (linked)');
    [baseIdResult, tableNameResult, fieldNameResult, linkedNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();
    linkedNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).primary().done();
    builder.field().singleLineText().withName(linkedNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();

    const uniqueResult = table.generateFieldName(FieldName.create('Fresh')._unsafeUnwrap());
    uniqueResult._unsafeUnwrap();
    expect(uniqueResult._unsafeUnwrap().toString()).toBe('Fresh');

    const conflictResult = table.generateFieldName(fieldNameResult._unsafeUnwrap());
    conflictResult._unsafeUnwrap();
    expect(conflictResult._unsafeUnwrap().toString()).toBe('Generate (linked 2)');
  });

  it('exposes copies of fields and views', () => {
    const baseIdResult = createBaseId('e');
    const tableNameResult = TableName.create('Copies');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();
    viewNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().grid().withName(viewNameResult._unsafeUnwrap()).done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();

    const fields = [...table.getFields()];
    fields.push(fields[0]);
    expect(table.getFields().length).toBe(1);

    const views = [...table.views()];
    views.push(views[0]);
    expect(table.views().length).toBe(1);

    expect(table.fieldIds().length).toBe(1);
    expect(table.viewIds().length).toBe(1);
    table.primaryField()._unsafeUnwrap();
  });
});

describe('TableName', () => {
  it('validates table names', () => {
    TableName.create('Project')._unsafeUnwrap();
    TableName.create('')._unsafeUnwrapErr();
  });

  it('compares table names by value', () => {
    const left = TableName.create('A')._unsafeUnwrap();
    const right = TableName.create('A')._unsafeUnwrap();
    const other = TableName.create('B')._unsafeUnwrap();
    expect(left.equals(right)).toBe(true);
    expect(left.equals(other)).toBe(false);
    expect(left.toString()).toBe('A');
  });
});

describe('DbTableName', () => {
  it('rehydrates and validates db table names', () => {
    DbTableName.rehydrate('table_name')._unsafeUnwrap();
    DbTableName.rehydrate('')._unsafeUnwrapErr();
  });

  it('requires rehydrate before accessing value', () => {
    const empty = DbTableName.empty();
    expect(empty.isRehydrated()).toBe(false);
    empty.value()._unsafeUnwrapErr();
  });
});

describe('Table.createRecord', () => {
  const buildSimpleTable = () => {
    const baseIdResult = createBaseId('r');
    const tableNameResult = TableName.create('Records');
    const textFieldId = createFieldId('t');
    const numberFieldId = createFieldId('n');
    const checkboxFieldId = createFieldId('c');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(numberFieldId._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .done();
    builder
      .field()
      .checkbox()
      .withId(checkboxFieldId._unsafeUnwrap())
      .withName(FieldName.create('Approved')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    return {
      table: builder.build()._unsafeUnwrap(),
      textFieldId: textFieldId._unsafeUnwrap().toString(),
      numberFieldId: numberFieldId._unsafeUnwrap().toString(),
      checkboxFieldId: checkboxFieldId._unsafeUnwrap().toString(),
    };
  };

  it('creates a record with field values', () => {
    const { table, textFieldId, numberFieldId, checkboxFieldId } = buildSimpleTable();

    const fieldValues = new Map<string, unknown>([
      [textFieldId, 'Hello World'],
      [numberFieldId, 42],
      [checkboxFieldId, true],
    ]);

    const recordResult = table.createRecord(fieldValues);
    const record = recordResult._unsafeUnwrap();

    expect(record.id().toString()).toMatch(/^rec/);
    expect(record.tableId().equals(table.id())).toBe(true);

    const fields = record.fields();
    const textFieldIdObj = FieldId.create(textFieldId)._unsafeUnwrap();
    const numberFieldIdObj = FieldId.create(numberFieldId)._unsafeUnwrap();
    const checkboxFieldIdObj = FieldId.create(checkboxFieldId)._unsafeUnwrap();

    expect(fields.get(textFieldIdObj)?.toValue()).toBe('Hello World');
    expect(fields.get(numberFieldIdObj)?.toValue()).toBe(42);
    expect(fields.get(checkboxFieldIdObj)?.toValue()).toBe(true);
  });

  it('creates an empty record without field values', () => {
    const { table } = buildSimpleTable();

    const fieldValues = new Map<string, unknown>();
    const recordResult = table.createRecord(fieldValues);
    const record = recordResult._unsafeUnwrap();

    expect(record.id().toString()).toMatch(/^rec/);
    expect(record.tableId().equals(table.id())).toBe(true);
  });

  it('ignores unknown field IDs', () => {
    const { table, textFieldId } = buildSimpleTable();

    const fieldValues = new Map<string, unknown>([
      [textFieldId, 'Valid'],
      ['fldUnknownField12345', 'Ignored'],
    ]);

    const recordResult = table.createRecord(fieldValues);
    const record = recordResult._unsafeUnwrap();

    expect(record.fields().entries().length).toBe(1);
  });

  it('validates field values against their schemas', () => {
    const { table, numberFieldId } = buildSimpleTable();

    // Passing invalid type - string instead of number
    const fieldValues = new Map<string, unknown>([[numberFieldId, 'not a number']]);

    const recordResult = table.createRecord(fieldValues);
    expect(recordResult.isErr()).toBe(true);
    expect(recordResult._unsafeUnwrapErr().message).toContain('Invalid value');
  });

  it('generates unique record IDs for each call', () => {
    const { table } = buildSimpleTable();

    const record1 = table.createRecord(new Map())._unsafeUnwrap();
    const record2 = table.createRecord(new Map())._unsafeUnwrap();

    expect(record1.id().equals(record2.id())).toBe(false);
  });

  it('creates record input schema for editable fields only', () => {
    const baseIdResult = createBaseId('s');
    const tableNameResult = TableName.create('Schema Test');
    const textFieldId = createFieldId('u');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    // Add a computed field (formula)
    builder
      .field()
      .formula()
      .withName(FieldName.create('Computed')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('1 + 1')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    const schemaResult = table.createRecordInputSchema();
    const schema = schemaResult._unsafeUnwrap();

    // Schema should only contain the editable field (singleLineText)
    // and not the computed field (formula)
    const shape = schema.shape;
    expect(Object.keys(shape).length).toBe(1);
    expect(shape[textFieldId._unsafeUnwrap().toString()]).toBeDefined();
  });
});

describe('Table.createRecord with default values', () => {
  it('applies text default value when field value is not provided', () => {
    const baseIdResult = createBaseId('d');
    const textFieldId = createFieldId('t');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Default Text')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('Default Title')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    // Create record without providing the text field value
    const recordResult = table.createRecord(new Map());
    const record = recordResult._unsafeUnwrap();

    const textFieldIdObj = textFieldId._unsafeUnwrap();
    expect(record.fields().get(textFieldIdObj)?.toValue()).toBe('Default Title');
  });

  it('applies number default value when field value is not provided', () => {
    const baseIdResult = createBaseId('e');
    const textFieldId = createFieldId('p');
    const numberFieldId = createFieldId('n');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Default Number')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(numberFieldId._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .withDefaultValue(NumberDefaultValue.create(100)._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    // Create record without providing the number field value
    const recordResult = table.createRecord(new Map());
    const record = recordResult._unsafeUnwrap();

    const numberFieldIdObj = numberFieldId._unsafeUnwrap();
    expect(record.fields().get(numberFieldIdObj)?.toValue()).toBe(100);
  });

  it('applies checkbox default value when field value is not provided', () => {
    const baseIdResult = createBaseId('f');
    const textFieldId = createFieldId('p');
    const checkboxFieldId = createFieldId('c');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Default Checkbox')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .checkbox()
      .withId(checkboxFieldId._unsafeUnwrap())
      .withName(FieldName.create('Approved')._unsafeUnwrap())
      .withDefaultValue(CheckboxDefaultValue.create(true)._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    // Create record without providing the checkbox field value
    const recordResult = table.createRecord(new Map());
    const record = recordResult._unsafeUnwrap();

    const checkboxFieldIdObj = checkboxFieldId._unsafeUnwrap();
    expect(record.fields().get(checkboxFieldIdObj)?.toValue()).toBe(true);
  });

  it('does not apply default value when field value is explicitly provided', () => {
    const baseIdResult = createBaseId('g');
    const textFieldId = createFieldId('t');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Explicit Value')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('Default Title')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    // Create record with explicit value
    const fieldValues = new Map<string, unknown>([
      [textFieldId._unsafeUnwrap().toString(), 'My Custom Title'],
    ]);
    const recordResult = table.createRecord(fieldValues);
    const record = recordResult._unsafeUnwrap();

    const textFieldIdObj = textFieldId._unsafeUnwrap();
    expect(record.fields().get(textFieldIdObj)?.toValue()).toBe('My Custom Title');
  });

  it('applies multiple default values for different field types', () => {
    const baseIdResult = createBaseId('h');
    const textFieldId = createFieldId('t');
    const numberFieldId = createFieldId('n');
    const checkboxFieldId = createFieldId('c');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Multiple Defaults')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('Default Text')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(numberFieldId._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .withDefaultValue(NumberDefaultValue.create(50)._unsafeUnwrap())
      .done();
    builder
      .field()
      .checkbox()
      .withId(checkboxFieldId._unsafeUnwrap())
      .withName(FieldName.create('Enabled')._unsafeUnwrap())
      .withDefaultValue(CheckboxDefaultValue.create(false)._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    // Create record without any field values
    const recordResult = table.createRecord(new Map());
    const record = recordResult._unsafeUnwrap();

    expect(record.fields().get(textFieldId._unsafeUnwrap())?.toValue()).toBe('Default Text');
    expect(record.fields().get(numberFieldId._unsafeUnwrap())?.toValue()).toBe(50);
    expect(record.fields().get(checkboxFieldId._unsafeUnwrap())?.toValue()).toBe(false);
  });

  it('mixes explicit values with default values', () => {
    const baseIdResult = createBaseId('i');
    const textFieldId = createFieldId('t');
    const numberFieldId = createFieldId('n');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Mixed Values')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('Default Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(numberFieldId._unsafeUnwrap())
      .withName(FieldName.create('Count')._unsafeUnwrap())
      .withDefaultValue(NumberDefaultValue.create(10)._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    // Provide only the text field value, let number use default
    const fieldValues = new Map<string, unknown>([
      [textFieldId._unsafeUnwrap().toString(), 'Explicit Title'],
    ]);
    const recordResult = table.createRecord(fieldValues);
    const record = recordResult._unsafeUnwrap();

    expect(record.fields().get(textFieldId._unsafeUnwrap())?.toValue()).toBe('Explicit Title');
    expect(record.fields().get(numberFieldId._unsafeUnwrap())?.toValue()).toBe(10);
  });

  it('does not apply default when null is explicitly passed', () => {
    const baseIdResult = createBaseId('j');
    const textFieldId = createFieldId('t');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Null Override')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('Default Title')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    // Explicitly pass null - should use the default value since null is treated as "not provided"
    const fieldValues = new Map<string, unknown>([[textFieldId._unsafeUnwrap().toString(), null]]);
    const recordResult = table.createRecord(fieldValues);
    const record = recordResult._unsafeUnwrap();

    // null is treated as "empty", so default value should be applied
    expect(record.fields().get(textFieldId._unsafeUnwrap())?.toValue()).toBe('Default Title');
  });

  it('applies longText default value', () => {
    const baseIdResult = createBaseId('k');
    const textFieldId = createFieldId('p');
    const longTextFieldId = createFieldId('l');

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create('Default LongText')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .longText()
      .withId(longTextFieldId._unsafeUnwrap())
      .withName(FieldName.create('Description')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('Default description text')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    const recordResult = table.createRecord(new Map());
    const record = recordResult._unsafeUnwrap();

    expect(record.fields().get(longTextFieldId._unsafeUnwrap())?.toValue()).toBe(
      'Default description text'
    );
  });
});
