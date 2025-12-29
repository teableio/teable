import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { DbTableName } from './DbTableName';
import { FieldDeleted } from './events/FieldDeleted';
import { TableCreated } from './events/TableCreated';
import { TableDeleted } from './events/TableDeleted';
import { TableRenamed } from './events/TableRenamed';
import { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { SingleLineTextField } from './fields/types/SingleLineTextField';
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
      table.fields().map((field) => field.id().toString())
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

    table.dbTableName()._unsafeUnwrapErr();

    const dbNameResult = DbTableName.rehydrate('db_table');
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
    expect(updatedTable.fields().length).toBe(2);
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

    const fieldToRemove = table.fields().find((field) => field.name().equals(extraName));
    if (!fieldToRemove) throw new Error('Missing field to remove');
    const fieldId = fieldToRemove.id();

    const updateResult = table.update((mutator) => mutator.removeField(fieldId));
    updateResult._unsafeUnwrap();
    const updatedTable = updateResult._unsafeUnwrap().table;

    expect(updatedTable.fields().length).toBe(1);
    expect(updatedTable.fields().some((field) => field.id().equals(fieldId))).toBe(false);

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

    const fields = [...table.fields()];
    fields.push(fields[0]);
    expect(table.fields().length).toBe(1);

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
