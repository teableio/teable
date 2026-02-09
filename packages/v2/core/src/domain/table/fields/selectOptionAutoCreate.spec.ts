import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { FieldId } from './FieldId';
import { FieldName } from './FieldName';
import { fieldColorValues } from './types/FieldColor';
import { SelectAutoNewOptions } from './types/SelectAutoNewOptions';
import { SelectOption } from './types/SelectOption';
import { RecordWriteSideEffectVisitor } from './visitors/RecordWriteSideEffectVisitor';

const createSelectOption = (name: string, color = 'blue') =>
  SelectOption.create({ name, color })._unsafeUnwrap();

const buildTable = (options: { preventAutoNewOptions?: boolean } = {}) => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Select Auto Create')._unsafeUnwrap();
  const titleFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const singleSelectFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const multiSelectFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();

  const preventAuto = options.preventAutoNewOptions
    ? SelectAutoNewOptions.prevent()
    : SelectAutoNewOptions.allow();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);

  builder
    .field()
    .singleLineText()
    .withId(titleFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();

  builder
    .field()
    .singleSelect()
    .withId(singleSelectFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([createSelectOption('Open')])
    .withPreventAutoNewOptions(preventAuto)
    .done();

  builder
    .field()
    .multipleSelect()
    .withId(multiSelectFieldId)
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([createSelectOption('Tag A'), createSelectOption('Tag B')])
    .withPreventAutoNewOptions(preventAuto)
    .done();

  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    singleSelectFieldId,
    multiSelectFieldId,
  };
};

describe('RecordWriteSideEffectVisitor', () => {
  it('collects new select options when typecast is enabled', () => {
    const { table, singleSelectFieldId, multiSelectFieldId } = buildTable();

    const recordFieldValues = [
      new Map([
        [singleSelectFieldId.toString(), 'In Progress'],
        [multiSelectFieldId.toString(), 'Tag A, Tag C'],
      ]),
      new Map([[multiSelectFieldId.toString(), ['Tag B', 'Tag D']]]),
    ];

    const result = RecordWriteSideEffectVisitor.collect(
      table,
      recordFieldValues,
      true
    )._unsafeUnwrap();
    const effectsByFieldId = new Map(result.map((effect) => [effect.fieldId.toString(), effect]));

    const singleOptions = effectsByFieldId.get(singleSelectFieldId.toString())?.options ?? [];
    const singleNames = singleOptions.map((option) => option.name().toString());
    expect(singleNames).toEqual(['In Progress']);

    const multiOptions = effectsByFieldId.get(multiSelectFieldId.toString())?.options ?? [];
    const multiNames = multiOptions.map((option) => option.name().toString()).sort();
    expect(multiNames).toEqual(['Tag C', 'Tag D']);

    for (const option of [...singleOptions, ...multiOptions]) {
      expect(fieldColorValues).toContain(option.color().toString());
    }
  });

  it('returns empty when auto-create is prevented', () => {
    const { table, singleSelectFieldId } = buildTable({ preventAutoNewOptions: true });
    const recordFieldValues = [new Map([[singleSelectFieldId.toString(), 'Blocked']])];

    const result = RecordWriteSideEffectVisitor.collect(
      table,
      recordFieldValues,
      true
    )._unsafeUnwrap();
    expect(result).toHaveLength(0);
  });

  it('returns empty when typecast is disabled', () => {
    const { table, singleSelectFieldId } = buildTable();
    const recordFieldValues = [new Map([[singleSelectFieldId.toString(), 'Ignored']])];

    const result = RecordWriteSideEffectVisitor.collect(
      table,
      recordFieldValues,
      false
    )._unsafeUnwrap();
    expect(result).toHaveLength(0);
  });

  it('extracts display text from object values instead of [object Object]', () => {
    const { table, singleSelectFieldId } = buildTable();
    const recordFieldValues = [
      new Map([
        [
          singleSelectFieldId.toString(),
          {
            id: 'usr_test',
            title: 'Test User',
            email: 'test@example.com',
          },
        ],
      ]),
    ];

    const result = RecordWriteSideEffectVisitor.collect(
      table,
      recordFieldValues,
      true
    )._unsafeUnwrap();
    const effect = result.find(
      (item) => item.fieldId.toString() === singleSelectFieldId.toString()
    );
    const optionNames = (effect?.options ?? []).map((option) => option.name().toString());

    expect(optionNames).toContain('Test User');
    expect(optionNames).not.toContain('[object Object]');
  });

  it('does not create duplicated option when display text already exists', () => {
    const { table, singleSelectFieldId } = buildTable();
    const recordFieldValues = [
      new Map([[singleSelectFieldId.toString(), { id: 'usr_open', title: 'Open' }]]),
    ];

    const result = RecordWriteSideEffectVisitor.collect(
      table,
      recordFieldValues,
      true
    )._unsafeUnwrap();

    const effect = result.find(
      (item) => item.fieldId.toString() === singleSelectFieldId.toString()
    );
    expect(effect).toBeUndefined();
  });
});
