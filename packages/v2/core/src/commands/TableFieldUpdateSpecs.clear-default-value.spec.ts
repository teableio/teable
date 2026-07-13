import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { CheckboxDefaultValue } from '../domain/table/fields/types/CheckboxDefaultValue';
import { DateDefaultValue } from '../domain/table/fields/types/DateDefaultValue';
import { NumberDefaultValue } from '../domain/table/fields/types/NumberDefaultValue';
import { SelectDefaultValue } from '../domain/table/fields/types/SelectDefaultValue';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { UserDefaultValue } from '../domain/table/fields/types/UserDefaultValue';
import { UpdateCheckboxDefaultValueSpec } from '../domain/table/specs/field-updates/UpdateCheckboxDefaultValueSpec';
import { UpdateDateDefaultValueSpec } from '../domain/table/specs/field-updates/UpdateDateDefaultValueSpec';
import { UpdateMultipleSelectDefaultValueSpec } from '../domain/table/specs/field-updates/UpdateMultipleSelectDefaultValueSpec';
import { UpdateNumberDefaultValueSpec } from '../domain/table/specs/field-updates/UpdateNumberDefaultValueSpec';
import { UpdateSingleSelectDefaultValueSpec } from '../domain/table/specs/field-updates/UpdateSingleSelectDefaultValueSpec';
import { UpdateUserDefaultValueSpec } from '../domain/table/specs/field-updates/UpdateUserDefaultValueSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { buildUpdateFieldSpecs } from './TableFieldUpdateSpecs';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const setStableDbFieldName = (field: Field, name: string) => {
  field.setDbFieldName(DbFieldName.rehydrate(name)._unsafeUnwrap())._unsafeUnwrap();
};

type Builder = ReturnType<typeof Table.builder>;

const buildField = (
  seed: string,
  configure: (builder: Builder, fieldId: FieldId) => void
): Field => {
  const baseId = createBaseId(seed);
  const tableId = createTableId(seed);
  const fieldId = createFieldId(seed);
  const primaryFieldId = createFieldId('p');
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(`Clear Default ${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  configure(builder, fieldId);
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  return table.getField((field) => field.id().equals(fieldId))._unsafeUnwrap();
};

describe('TableFieldUpdateSpecs clear defaultValue T6107', () => {
  it('clears number defaultValue when UI sends null', () => {
    const currentField = buildField('n', (builder, fieldId) => {
      builder
        .field()
        .number()
        .withId(fieldId)
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .withDefaultValue(NumberDefaultValue.create(42)._unsafeUnwrap())
        .done();
    });
    setStableDbFieldName(currentField, 'amount');

    const specsResult = buildUpdateFieldSpecs(currentField, {
      options: { defaultValue: null },
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) return;

    const clearSpec = specsResult.value.find(
      (spec): spec is UpdateNumberDefaultValueSpec => spec instanceof UpdateNumberDefaultValueSpec
    );
    expect(clearSpec).toBeDefined();
    expect(clearSpec?.nextDefaultValue()).toBeUndefined();
  });

  it('clears date auto-fill defaultValue when UI sends null', () => {
    const currentField = buildField('d', (builder, fieldId) => {
      builder
        .field()
        .date()
        .withId(fieldId)
        .withName(FieldName.create('Due')._unsafeUnwrap())
        .withDefaultValue(DateDefaultValue.create('now')._unsafeUnwrap())
        .done();
    });
    setStableDbFieldName(currentField, 'due');

    const specsResult = buildUpdateFieldSpecs(currentField, {
      options: { defaultValue: null },
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) return;

    const clearSpec = specsResult.value.find(
      (spec): spec is UpdateDateDefaultValueSpec => spec instanceof UpdateDateDefaultValueSpec
    );
    expect(clearSpec).toBeDefined();
    expect(clearSpec?.nextDefaultValue()).toBeUndefined();
  });

  it('clears checkbox defaultValue when UI sends null', () => {
    const currentField = buildField('c', (builder, fieldId) => {
      builder
        .field()
        .checkbox()
        .withId(fieldId)
        .withName(FieldName.create('Done')._unsafeUnwrap())
        .withDefaultValue(CheckboxDefaultValue.create(true)._unsafeUnwrap())
        .done();
    });
    setStableDbFieldName(currentField, 'done');

    const specsResult = buildUpdateFieldSpecs(currentField, {
      options: { defaultValue: null },
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) return;

    const clearSpec = specsResult.value.find(
      (spec): spec is UpdateCheckboxDefaultValueSpec =>
        spec instanceof UpdateCheckboxDefaultValueSpec
    );
    expect(clearSpec).toBeDefined();
    expect(clearSpec?.nextDefaultValue()).toBeUndefined();
  });

  it('clears singleSelect defaultValue when UI sends null', () => {
    const todo = SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap();
    const currentField = buildField('s', (builder, fieldId) => {
      builder
        .field()
        .singleSelect()
        .withId(fieldId)
        .withName(FieldName.create('Status')._unsafeUnwrap())
        .withOptions([todo])
        .withDefaultValue(SelectDefaultValue.create('Todo')._unsafeUnwrap())
        .done();
    });
    setStableDbFieldName(currentField, 'status');

    const specsResult = buildUpdateFieldSpecs(currentField, {
      options: { defaultValue: null },
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) return;

    const clearSpec = specsResult.value.find(
      (spec): spec is UpdateSingleSelectDefaultValueSpec =>
        spec instanceof UpdateSingleSelectDefaultValueSpec
    );
    expect(clearSpec).toBeDefined();
    expect(clearSpec?.nextDefaultValue()).toBeUndefined();
  });

  it('clears multipleSelect defaultValue when UI sends null', () => {
    const alpha = SelectOption.create({ name: 'Alpha', color: 'blue' })._unsafeUnwrap();
    const currentField = buildField('m', (builder, fieldId) => {
      builder
        .field()
        .multipleSelect()
        .withId(fieldId)
        .withName(FieldName.create('Tags')._unsafeUnwrap())
        .withOptions([alpha])
        .withDefaultValue(SelectDefaultValue.create(['Alpha'])._unsafeUnwrap())
        .done();
    });
    setStableDbFieldName(currentField, 'tags');

    const specsResult = buildUpdateFieldSpecs(currentField, {
      options: { defaultValue: null },
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) return;

    const clearSpec = specsResult.value.find(
      (spec): spec is UpdateMultipleSelectDefaultValueSpec =>
        spec instanceof UpdateMultipleSelectDefaultValueSpec
    );
    expect(clearSpec).toBeDefined();
    expect(clearSpec?.nextDefaultValue()).toBeUndefined();
  });

  it('clears user defaultValue when UI sends null', () => {
    const currentField = buildField('u', (builder, fieldId) => {
      builder
        .field()
        .user()
        .withId(fieldId)
        .withName(FieldName.create('Owner')._unsafeUnwrap())
        .withDefaultValue(UserDefaultValue.create('me')._unsafeUnwrap())
        .done();
    });
    setStableDbFieldName(currentField, 'owner');

    const specsResult = buildUpdateFieldSpecs(currentField, {
      options: { defaultValue: null },
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) return;

    const clearSpec = specsResult.value.find(
      (spec): spec is UpdateUserDefaultValueSpec => spec instanceof UpdateUserDefaultValueSpec
    );
    expect(clearSpec).toBeDefined();
    expect(clearSpec?.nextDefaultValue()).toBeUndefined();
  });

  it('does not emit clear when defaultValue key is omitted', () => {
    const currentField = buildField('x', (builder, fieldId) => {
      builder
        .field()
        .number()
        .withId(fieldId)
        .withName(FieldName.create('Amount')._unsafeUnwrap())
        .withDefaultValue(NumberDefaultValue.create(1)._unsafeUnwrap())
        .done();
    });
    setStableDbFieldName(currentField, 'amount');

    const specsResult = buildUpdateFieldSpecs(currentField, {
      name: 'Amount Renamed',
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) return;

    const clearSpec = specsResult.value.find(
      (spec) => spec instanceof UpdateNumberDefaultValueSpec
    );
    expect(clearSpec).toBeUndefined();
  });
});
