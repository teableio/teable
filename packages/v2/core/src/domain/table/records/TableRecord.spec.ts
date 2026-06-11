import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { SelectOption } from '../fields/types/SelectOption';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { RecordId } from './RecordId';
import { TableRecord } from './TableRecord';
import { TableRecordCellValue } from './TableRecordFields';

const baseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const cell = (value: unknown) => TableRecordCellValue.create(value)._unsafeUnwrap();
const selectOption = (name: string) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

const buildSinglePrimaryTable = () => {
  const builder = Table.builder()
    .withBaseId(baseId('a'))
    .withName(TableName.create('Single Primary')._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

const buildMultiplePrimaryTable = () => {
  const builder = Table.builder()
    .withBaseId(baseId('b'))
    .withName(TableName.create('Multiple Primary')._unsafeUnwrap());

  builder
    .field()
    .multipleSelect()
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([selectOption('Alpha'), selectOption('Beta')])
    .primary()
    .done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

describe('TableRecord.displayName', () => {
  it('returns the primary field display name for a single-value primary field', () => {
    const table = buildSinglePrimaryTable();
    const primaryField = table.primaryField()._unsafeUnwrap();
    const record = TableRecord.create({
      id: recordId('a'),
      tableId: table.id(),
      fieldValues: [{ fieldId: primaryField.id(), value: cell('Alpha') }],
    })._unsafeUnwrap();

    const result = record.displayName(table);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('Alpha');
  });

  it('joins multiple primary display values for multi-value primary fields', () => {
    const table = buildMultiplePrimaryTable();
    const primaryField = table.primaryField()._unsafeUnwrap();
    const record = TableRecord.create({
      id: recordId('b'),
      tableId: table.id(),
      fieldValues: [{ fieldId: primaryField.id(), value: cell(['Alpha', 'Beta']) }],
    })._unsafeUnwrap();

    const result = record.displayName(table);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('Alpha, Beta');
  });

  it('returns an error when resolving display name with another table', () => {
    const sourceTable = buildSinglePrimaryTable();
    const primaryField = sourceTable.primaryField()._unsafeUnwrap();
    const otherTable = buildMultiplePrimaryTable();
    const record = TableRecord.create({
      id: recordId('c'),
      tableId: sourceTable.id(),
      fieldValues: [{ fieldId: primaryField.id(), value: cell('Alpha') }],
    })._unsafeUnwrap();

    const result = record.displayName(otherTable);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.table_mismatch');
  });
});
