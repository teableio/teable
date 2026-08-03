import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { IDomainContext } from '../../../../shared/DomainContext';
import { BaseId } from '../../../../base/BaseId';
import { DbFieldName } from '../../../fields/DbFieldName';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { MultipleSelectField } from '../../../fields/types/MultipleSelectField';
import { SelectAutoNewOptions } from '../../../fields/types/SelectAutoNewOptions';
import { SelectOption } from '../../../fields/types/SelectOption';
import { Table } from '../../../Table';
import { TableName } from '../../../TableName';
import type { ITableSpecVisitor } from '../../ITableSpecVisitor';
import { UpdateMultipleSelectOptionsSpec } from '../UpdateMultipleSelectOptionsSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildOption = (id: string, name: string, color: string) =>
  SelectOption.create({ id, name, color })._unsafeUnwrap();

const buildTableWithMultipleSelectField = (
  fieldId: FieldId,
  options: ReadonlyArray<SelectOption>
) => {
  const builder = Table.builder()
    .withBaseId(createBaseId('a'))
    .withName(TableName.create('Multiple Select Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .multipleSelect()
    .withId(fieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions(options)
    .withPreventAutoNewOptions(SelectAutoNewOptions.allow())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTableWithNumberField = (fieldId: FieldId) => {
  const builder = Table.builder()
    .withBaseId(createBaseId('b'))
    .withName(TableName.create('Wrong Type Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(fieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('UpdateMultipleSelectOptionsSpec', () => {
  const fieldId = createFieldId('c');
  const dbFieldName = DbFieldName.rehydrate('status_choices')._unsafeUnwrap();
  const previousTodo = buildOption('cho_todo', 'Todo', 'blue');
  const previousDone = buildOption('cho_done', 'Done', 'green');
  const nextTodo = buildOption('cho_todo', 'Todo Later', 'yellow');
  const nextBlocked = buildOption('cho_block', 'Blocked', 'red');

  it('tracks added, removed, renamed, and modified options', () => {
    const spec = UpdateMultipleSelectOptionsSpec.create(
      fieldId,
      dbFieldName,
      [previousTodo, previousDone],
      [nextTodo, nextBlocked]
    );

    expect(spec.fieldId().equals(fieldId)).toBe(true);
    expect(spec.dbFieldName().equals(dbFieldName)).toBe(true);
    expect(spec.previousOptions()).toEqual([previousTodo, previousDone]);
    expect(spec.nextOptions()).toEqual([nextTodo, nextBlocked]);
    expect(spec.addedOptions()).toEqual([nextBlocked]);
    expect(spec.removedOptions()).toEqual([previousDone]);
    expect(spec.renamedOptions()).toEqual([{ previous: previousTodo, next: nextTodo }]);
    expect(spec.modifiedOptions()).toEqual([{ previous: previousTodo, next: nextTodo }]);
  });

  it('mutates the table to replace the multiple select options', () => {
    const table = buildTableWithMultipleSelectField(fieldId, [previousTodo, previousDone]);
    const spec = UpdateMultipleSelectOptionsSpec.create(
      fieldId,
      dbFieldName,
      [previousTodo, previousDone],
      [nextTodo, nextBlocked]
    );

    const result = spec.mutate(table);

    expect(result.isOk()).toBe(true);
    const updatedField = result
      ._unsafeUnwrap()
      .getField((candidate) => candidate.id().equals(fieldId))
      ._unsafeUnwrap();
    expect(updatedField).toBeInstanceOf(MultipleSelectField);
    expect((updatedField as MultipleSelectField).selectOptions()).toEqual([nextTodo, nextBlocked]);
  });

  it('rejects updates that exceed the configured option limit', () => {
    const domainContext: IDomainContext = {
      config: {
        selectFieldOptions: {
          maxChoicesPerField: 1,
        },
      },
    };
    const table = buildTableWithMultipleSelectField(fieldId, [previousTodo]);
    const spec = UpdateMultipleSelectOptionsSpec.create(
      fieldId,
      dbFieldName,
      [previousTodo],
      [previousTodo, nextBlocked],
      domainContext
    );

    const result = spec.mutate(table);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('cannot exceed 1 choices');
  });

  it('errors when the target field is missing', () => {
    const table = buildTableWithMultipleSelectField(createFieldId('d'), [previousTodo]);
    const spec = UpdateMultipleSelectOptionsSpec.create(
      fieldId,
      dbFieldName,
      [previousTodo],
      [nextTodo]
    );

    expect(spec.mutate(table).isErr()).toBe(true);
  });

  it('errors when the target field is not a multiple select field', () => {
    const table = buildTableWithNumberField(fieldId);
    const spec = UpdateMultipleSelectOptionsSpec.create(
      fieldId,
      dbFieldName,
      [previousTodo],
      [nextTodo]
    );

    const result = spec.mutate(table);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not a multiple select field');
  });

  it('accepts the table spec visitor', () => {
    let visited = false;
    const spec = UpdateMultipleSelectOptionsSpec.create(
      fieldId,
      dbFieldName,
      [previousTodo],
      [nextTodo]
    );

    const visitor = {
      visitUpdateMultipleSelectOptions: () => {
        visited = true;
        return ok(undefined);
      },
    };

    expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
    expect(visited).toBe(true);
  });
});
