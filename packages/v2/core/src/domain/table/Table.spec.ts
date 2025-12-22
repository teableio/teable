import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { DbTableName } from './DbTableName';
import { TableCreated } from './events/TableCreated';
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
    expect(
      [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldNameResult.isErr() ||
      viewNameResult.isErr()
    )
      return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().grid().withName(viewNameResult.value).done();

    const buildResult = builder.build();
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;
    const table = buildResult.value;

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

  it('rehydrates without emitting events', () => {
    const baseIdResult = createBaseId('b');
    const tableIdResult = createTableId('b');
    const tableNameResult = TableName.create('Rehydrate');
    const fieldIdResult = createFieldId('a');
    const fieldNameResult = FieldName.create('Title');
    const viewIdResult = createViewId('a');
    const viewNameResult = ViewName.create('Grid');
    const dbNameResult = DbTableName.rehydrate('db_table');

    expect(
      [
        baseIdResult,
        tableIdResult,
        tableNameResult,
        fieldIdResult,
        fieldNameResult,
        viewIdResult,
        viewNameResult,
        dbNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldIdResult.isErr() ||
      fieldNameResult.isErr() ||
      viewIdResult.isErr() ||
      viewNameResult.isErr() ||
      dbNameResult.isErr()
    )
      return;

    const fieldResult = SingleLineTextField.create({
      id: fieldIdResult.value,
      name: fieldNameResult.value,
    });
    const viewResult = GridView.create({
      id: viewIdResult.value,
      name: viewNameResult.value,
    });
    expect([fieldResult, viewResult].every((r) => r.isOk())).toBe(true);
    if (fieldResult.isErr() || viewResult.isErr()) return;

    const tableResult = Table.rehydrate({
      id: tableIdResult.value,
      baseId: baseIdResult.value,
      name: tableNameResult.value,
      fields: [fieldResult.value],
      views: [viewResult.value],
      primaryFieldId: fieldIdResult.value,
      dbTableName: dbNameResult.value,
    });
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;

    const table = tableResult.value;
    expect(table.pullDomainEvents()).toEqual([]);
    expect(table.dbTableName().isOk()).toBe(true);
  });

  it('rejects invalid rehydrate data', () => {
    const baseIdResult = createBaseId('c');
    const tableIdResult = createTableId('c');
    const tableNameResult = TableName.create('Invalid');
    const fieldIdResult = createFieldId('b');
    const otherFieldIdResult = createFieldId('c');
    const viewIdResult = createViewId('b');
    const viewNameResult = ViewName.create('Grid');
    expect(
      [
        baseIdResult,
        tableIdResult,
        tableNameResult,
        fieldIdResult,
        otherFieldIdResult,
        viewIdResult,
        viewNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldIdResult.isErr() ||
      otherFieldIdResult.isErr() ||
      viewIdResult.isErr() ||
      viewNameResult.isErr()
    )
      return;

    const emptyFields = Table.rehydrate({
      id: tableIdResult.value,
      baseId: baseIdResult.value,
      name: tableNameResult.value,
      fields: [],
      views: [],
      primaryFieldId: fieldIdResult.value,
    });
    expect(emptyFields.isErr()).toBe(true);

    const missingPrimary = Table.rehydrate({
      id: tableIdResult.value,
      baseId: baseIdResult.value,
      name: tableNameResult.value,
      fields: [
        SingleLineTextField.create({
          id: fieldIdResult.value,
          name: FieldName.create('Title')._unsafeUnwrap(),
        })._unsafeUnwrap(),
      ],
      views: [
        GridView.create({ id: viewIdResult.value, name: viewNameResult.value })._unsafeUnwrap(),
      ],
      primaryFieldId: otherFieldIdResult.value,
    });
    expect(missingPrimary.isErr()).toBe(true);
  });

  it('manages db table name lifecycle', () => {
    const baseIdResult = createBaseId('d');
    const tableNameResult = TableName.create('Db Name');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    expect(
      [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldNameResult.isErr() ||
      viewNameResult.isErr()
    )
      return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().grid().withName(viewNameResult.value).done();

    const buildResult = builder.build();
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;
    const table = buildResult.value;

    expect(table.dbTableName().isErr()).toBe(true);

    const dbNameResult = DbTableName.rehydrate('db_table');
    const otherDbNameResult = DbTableName.rehydrate('db_table_other');
    expect([dbNameResult, otherDbNameResult].every((r) => r.isOk())).toBe(true);
    if (dbNameResult.isErr() || otherDbNameResult.isErr()) return;

    expect(table.setDbTableName(dbNameResult.value).isOk()).toBe(true);
    expect(table.dbTableName().isOk()).toBe(true);
    expect(table.setDbTableName(dbNameResult.value).isOk()).toBe(true);
    expect(table.setDbTableName(otherDbNameResult.value).isErr()).toBe(true);
  });

  it('exposes copies of fields and views', () => {
    const baseIdResult = createBaseId('e');
    const tableNameResult = TableName.create('Copies');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    expect(
      [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldNameResult.isErr() ||
      viewNameResult.isErr()
    )
      return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().grid().withName(viewNameResult.value).done();

    const buildResult = builder.build();
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;
    const table = buildResult.value;

    const fields = [...table.fields()];
    fields.push(fields[0]);
    expect(table.fields().length).toBe(1);

    const views = [...table.views()];
    views.push(views[0]);
    expect(table.views().length).toBe(1);

    expect(table.fieldIds().length).toBe(1);
    expect(table.viewIds().length).toBe(1);
    expect(table.primaryField().isOk()).toBe(true);
  });
});

describe('TableName', () => {
  it('validates table names', () => {
    expect(TableName.create('Project').isOk()).toBe(true);
    expect(TableName.create('').isErr()).toBe(true);
  });

  it('compares table names by value', () => {
    const left = TableName.create('A');
    const right = TableName.create('A');
    const other = TableName.create('B');
    expect([left, right, other].every((r) => r.isOk())).toBe(true);
    if (left.isErr() || right.isErr() || other.isErr()) return;
    expect(left.value.equals(right.value)).toBe(true);
    expect(left.value.equals(other.value)).toBe(false);
    expect(left.value.toString()).toBe('A');
  });
});

describe('DbTableName', () => {
  it('rehydrates and validates db table names', () => {
    expect(DbTableName.rehydrate('table_name').isOk()).toBe(true);
    expect(DbTableName.rehydrate('').isErr()).toBe(true);
  });

  it('requires rehydrate before accessing value', () => {
    const empty = DbTableName.empty();
    expect(empty.isRehydrated()).toBe(false);
    expect(empty.value().isErr()).toBe(true);
  });
});
