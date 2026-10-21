import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { BaseId } from '../../domain/base/BaseId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';

const createSelectOption = (name: string, color = 'blue') =>
  SelectOption.create({ name, color })._unsafeUnwrap();

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Select Auto Create')._unsafeUnwrap();
  const titleFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const singleSelectFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const multiSelectFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();

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
    .done();

  builder
    .field()
    .multipleSelect()
    .withId(multiSelectFieldId)
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([createSelectOption('Tag A'), createSelectOption('Tag B')])
    .done();

  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    titleFieldId,
    singleSelectFieldId,
    multiSelectFieldId,
  };
};

const contextWithLimits = (
  maxSelectChoices: number,
  maxNameLength?: number
): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
  config: {
    tableLimits: {
      fieldOptions: {
        maxSelectChoices,
        ...(maxNameLength != null ? { maxSelectChoiceNameLength: maxNameLength } : {}),
      },
    },
  },
});

describe('RecordWriteSideEffectService', () => {
  const service = new RecordWriteSideEffectService();

  it('fails the write when the only cell would create an option over the cap', () => {
    const { table, singleSelectFieldId } = buildTable();
    const records = [new Map<string, unknown>([[singleSelectFieldId.toString(), 'In Progress']])];

    const result = service.execute(contextWithLimits(1), table, records, true);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.field.select_options_limit');
  });

  it('keeps other fields and skips the overflowing select cell', () => {
    const { table, titleFieldId, singleSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([
        [titleFieldId.toString(), 'Kept Title'],
        [singleSelectFieldId.toString(), 'In Progress'],
      ]),
    ];

    const result = service.execute(contextWithLimits(1), table, records, true)._unsafeUnwrap();

    expect(result.effects).toHaveLength(0);
    expect(result.updateResult).toBeUndefined();
    expect(records[0]?.get(titleFieldId.toString())).toBe('Kept Title');
    expect(records[0]?.has(singleSelectFieldId.toString())).toBe(false);
  });

  it('creates options up to the remaining cap and skips later names', () => {
    const { table, singleSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([[singleSelectFieldId.toString(), 'First']]),
      new Map<string, unknown>([[singleSelectFieldId.toString(), 'Second']]),
    ];

    const result = service.execute(contextWithLimits(2), table, records, true)._unsafeUnwrap();

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]?.options.map((option) => option.name().toString())).toEqual(['First']);
    expect(records[0]?.get(singleSelectFieldId.toString())).toBe('First');
    expect(records[1]?.has(singleSelectFieldId.toString())).toBe(false);

    const updatedField = result.table
      .getField((field) => field.id().equals(singleSelectFieldId))
      ._unsafeUnwrap() as SingleSelectField;
    expect(updatedField.selectOptions().map((option) => option.name().toString())).toEqual([
      'Open',
      'First',
    ]);
  });

  it('keeps existing multi-select values when a new name does not fit', () => {
    const { table, multiSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([[multiSelectFieldId.toString(), ['Tag A', 'Tag C']]]),
    ];

    const result = service.execute(contextWithLimits(2), table, records, true)._unsafeUnwrap();

    expect(result.effects).toHaveLength(0);
    expect(records[0]?.get(multiSelectFieldId.toString())).toEqual(['Tag A']);

    const updatedField = result.table
      .getField((field) => field.id().equals(multiSelectFieldId))
      ._unsafeUnwrap() as MultipleSelectField;
    expect(updatedField.selectOptions().map((option) => option.name().toString())).toEqual([
      'Tag A',
      'Tag B',
    ]);
  });

  it('skips option names that exceed the configured length when other cells remain', () => {
    const { table, titleFieldId, singleSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([
        [titleFieldId.toString(), 'Kept Title'],
        [singleSelectFieldId.toString(), 'A'.repeat(101)],
      ]),
    ];

    const result = service
      .execute(contextWithLimits(1000, 100), table, records, true)
      ._unsafeUnwrap();

    expect(result.effects).toHaveLength(0);
    expect(records[0]?.get(titleFieldId.toString())).toBe('Kept Title');
    expect(records[0]?.has(singleSelectFieldId.toString())).toBe(false);
  });
});
