import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { FieldName } from '../domain/table/fields/FieldName';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { RecordFilter } from './RecordFilterDto';
import { buildRecordConditionSpec } from './RecordFilterMapper';

const baseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const cell = (value: unknown) => TableRecordCellValue.create(value)._unsafeUnwrap();
const selectOption = (name: string) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(baseId('a'))
    .withName(TableName.create('Records')._unsafeUnwrap());

  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('Ref')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Due')._unsafeUnwrap()).done();
  builder
    .field()
    .singleSelect()
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([selectOption('Open')])
    .done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

const buildRecord = (table: Table) => {
  const titleField = table.getField((field) => field.name().toString() === 'Title')._unsafeUnwrap();
  const refField = table.getField((field) => field.name().toString() === 'Ref')._unsafeUnwrap();
  const dueField = table.getField((field) => field.name().toString() === 'Due')._unsafeUnwrap();
  const statusField = table
    .getField((field) => field.name().toString() === 'Status')
    ._unsafeUnwrap();

  const record = TableRecord.create({
    id: recordId('a'),
    tableId: table.id(),
    fieldValues: [
      { fieldId: titleField.id(), value: cell('Hello world') },
      { fieldId: refField.id(), value: cell('Hello world') },
      { fieldId: dueField.id(), value: cell('2024-01-02T00:00:00.000Z') },
      { fieldId: statusField.id(), value: cell('Open') },
    ],
  })._unsafeUnwrap();

  return { record, titleField, refField, dueField, statusField };
};

describe('RecordFilterMapper', () => {
  it('builds specs for literal, list, and date values', () => {
    const table = buildTable();
    const { record, titleField, dueField, statusField } = buildRecord(table);

    const filter: RecordFilter = {
      conjunction: 'and',
      items: [
        {
          fieldId: titleField.id().toString(),
          operator: 'contains',
          value: 'Hello',
        },
        {
          fieldId: statusField.id().toString(),
          operator: 'isAnyOf',
          value: ['Open'],
        },
        {
          fieldId: dueField.id().toString(),
          operator: 'isOnOrAfter',
          value: {
            mode: 'exactDate',
            exactDate: '2024-01-01T00:00:00.000Z',
            timeZone: 'utc',
          },
        },
      ],
    };

    const result = buildRecordConditionSpec(table, filter);
    expect(result.isOk()).toBe(true);
    const spec = result._unsafeUnwrap();
    expect(spec.isSatisfiedBy(record)).toBe(true);
  });

  it('builds specs for field reference values', () => {
    const table = buildTable();
    const { record, titleField, refField } = buildRecord(table);

    const filter: RecordFilter = {
      fieldId: titleField.id().toString(),
      operator: 'is',
      value: {
        type: 'field',
        fieldId: refField.id().toString(),
      },
    };

    const result = buildRecordConditionSpec(table, filter);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(record)).toBe(true);
  });

  it('supports not and or groups', () => {
    const table = buildTable();
    const { record, titleField, dueField } = buildRecord(table);

    const filter: RecordFilter = {
      conjunction: 'or',
      items: [
        {
          fieldId: titleField.id().toString(),
          operator: 'contains',
          value: 'Missing',
        },
        {
          not: {
            fieldId: dueField.id().toString(),
            operator: 'isBefore',
            value: {
              mode: 'exactDate',
              exactDate: '2024-01-01T00:00:00.000Z',
              timeZone: 'utc',
            },
          },
        },
      ],
    };

    const result = buildRecordConditionSpec(table, filter);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(record)).toBe(true);
  });

  it('returns errors for invalid filters', () => {
    const table = buildTable();
    const { refField } = buildRecord(table);

    const empty = buildRecordConditionSpec(table, null);
    expect(empty._unsafeUnwrapErr().message).toContain('Filter is empty');

    const missingField = buildRecordConditionSpec(table, {
      fieldId: 'fldmissing123456789',
      operator: 'is',
      value: 'x',
    } as RecordFilter);
    expect(missingField._unsafeUnwrapErr().message).toContain('Filter field not found');

    const mismatchedTable = buildRecordConditionSpec(table, {
      fieldId: refField.id().toString(),
      operator: 'is',
      value: {
        type: 'field',
        fieldId: refField.id().toString(),
        tableId: TableId.create(`tbl${'z'.repeat(16)}`)
          ._unsafeUnwrap()
          .toString(),
      },
    });
    expect(mismatchedTable._unsafeUnwrapErr().message).toContain('Filter field table mismatch');

    const invalidNode = buildRecordConditionSpec(table, { foo: 'bar' } as unknown as RecordFilter);
    expect(invalidNode._unsafeUnwrapErr().message).toContain('Invalid record filter node');
  });
});
