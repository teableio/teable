import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { NumberField } from '../../fields/types/NumberField';
import { NumberFormatting } from '../../fields/types/NumberFormatting';
import { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import { TableUpdateFieldDescriptionSpec } from '../TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldNameSpec } from '../TableUpdateFieldNameSpec';
import { TableUpdateFieldTypeSpec } from '../TableUpdateFieldTypeSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildTable = (fieldId: FieldId) => {
  const baseId = createBaseId('a');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const primaryName = FieldName.create('Title')._unsafeUnwrap();
  const numberName = FieldName.create('Amount')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(primaryName).done();
  builder.field().number().withId(fieldId).withName(numberName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('TableUpdateFieldNameSpec', () => {
  it('mutates table to rename field', () => {
    const fieldId = createFieldId('1');
    const table = buildTable(fieldId);

    const prevName = FieldName.create('Amount')._unsafeUnwrap();
    const nextName = FieldName.create('Total')._unsafeUnwrap();

    const spec = TableUpdateFieldNameSpec.create(fieldId, prevName, nextName);

    expect(spec.fieldId().equals(fieldId)).toBe(true);
    expect(spec.previousName().toString()).toBe('Amount');
    expect(spec.nextName().toString()).toBe('Total');

    const result = spec.mutate(table);
    const updated = result._unsafeUnwrap();
    const field = updated.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
    expect(field.name().toString()).toBe('Total');
  });

  it('accepts visitor', () => {
    const fieldId = createFieldId('2');
    const prevName = FieldName.create('A')._unsafeUnwrap();
    const nextName = FieldName.create('B')._unsafeUnwrap();

    const spec = TableUpdateFieldNameSpec.create(fieldId, prevName, nextName);
    const visitor = { visitTableUpdateFieldName: () => ok(undefined) };
    spec.accept(visitor as any)._unsafeUnwrap();
  });
});

describe('TableUpdateFieldDescriptionSpec', () => {
  it('mutates table to update field description', () => {
    const fieldId = createFieldId('8');
    const table = buildTable(fieldId);
    const field = table.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
    field.setDescription('before')._unsafeUnwrap();

    const spec = TableUpdateFieldDescriptionSpec.create(fieldId, null, 'after');

    expect(spec.fieldId().equals(fieldId)).toBe(true);
    expect(spec.nextDescription()).toBe('after');

    const result = spec.mutate(table);
    const updated = result._unsafeUnwrap();
    const updatedField = updated.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
    expect(updatedField.description()).toBe('after');
  });

  it('accepts visitor', () => {
    const fieldId = createFieldId('9');
    const spec = TableUpdateFieldDescriptionSpec.create(fieldId, null, 'desc');
    const visitor = { visitTableUpdateFieldDescription: () => ok(undefined) };
    spec.accept(visitor as any)._unsafeUnwrap();
  });
});

describe('TableUpdateFieldTypeSpec', () => {
  it('detects type conversion when types differ', () => {
    const fieldId = createFieldId('3');
    const fieldName = FieldName.create('Field')._unsafeUnwrap();

    const textField = SingleLineTextField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();
    const numberField = NumberField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();

    const spec = TableUpdateFieldTypeSpec.create(textField, numberField);
    expect(spec.isTypeConversion()).toBe(true);
    expect(spec.requiresDataMigration()).toBe(true);
  });

  it('returns false for same type', () => {
    const fieldId = createFieldId('4');
    const fieldName = FieldName.create('Field')._unsafeUnwrap();

    const field1 = NumberField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();
    const field2 = NumberField.create({
      id: fieldId,
      name: fieldName,
      formatting: NumberFormatting.default(),
    })._unsafeUnwrap();

    const spec = TableUpdateFieldTypeSpec.create(field1, field2);
    expect(spec.isTypeConversion()).toBe(false);
  });

  it('exposes old and new fields', () => {
    const fieldId = createFieldId('5');
    const fieldName = FieldName.create('Field')._unsafeUnwrap();

    const textField = SingleLineTextField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();
    const numberField = NumberField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();

    const spec = TableUpdateFieldTypeSpec.create(textField, numberField);
    expect(spec.oldField()).toBe(textField);
    expect(spec.newField().id().equals(fieldId)).toBe(true);
  });

  it('mutates table to replace field', () => {
    const fieldId = createFieldId('6');
    const table = buildTable(fieldId);
    const fieldName = FieldName.create('Amount')._unsafeUnwrap();

    const oldField = table.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
    const newField = SingleLineTextField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();

    const spec = TableUpdateFieldTypeSpec.create(oldField, newField);
    const result = spec.mutate(table);
    const updated = result._unsafeUnwrap();
    const field = updated.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
    expect(field).toBeInstanceOf(SingleLineTextField);
  });

  it('accepts visitor', () => {
    const fieldId = createFieldId('7');
    const fieldName = FieldName.create('Field')._unsafeUnwrap();

    const textField = SingleLineTextField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();
    const numberField = NumberField.create({ id: fieldId, name: fieldName })._unsafeUnwrap();

    const spec = TableUpdateFieldTypeSpec.create(textField, numberField);
    const visitor = { visitTableUpdateFieldType: () => ok(undefined) };
    spec.accept(visitor as any)._unsafeUnwrap();
  });
});
