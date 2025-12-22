import { describe, expect, it } from 'vitest';

import { DbFieldName } from './DbFieldName';
import { FieldId } from './FieldId';
import { FieldName } from './FieldName';
import { FieldType } from './FieldType';
import { SingleLineTextField } from './types/SingleLineTextField';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('FieldName', () => {
  it('validates field names', () => {
    expect(FieldName.create('Title').isOk()).toBe(true);
    expect(FieldName.create('').isErr()).toBe(true);
  });

  it('compares field names by value', () => {
    const left = FieldName.create('A');
    const right = FieldName.create('A');
    const other = FieldName.create('B');
    expect([left, right, other].every((r) => r.isOk())).toBe(true);
    if (left.isErr() || right.isErr() || other.isErr()) return;
    expect(left.value.equals(right.value)).toBe(true);
    expect(left.value.equals(other.value)).toBe(false);
    expect(left.value.toString()).toBe('A');
  });
});

describe('DbFieldName', () => {
  it('rehydrates and validates', () => {
    expect(DbFieldName.rehydrate('db_field').isOk()).toBe(true);
    expect(DbFieldName.rehydrate('').isErr()).toBe(true);
  });

  it('requires rehydrate before access', () => {
    const empty = DbFieldName.empty();
    expect(empty.isRehydrated()).toBe(false);
    expect(empty.value().isErr()).toBe(true);
  });
});

describe('FieldType', () => {
  it('accepts known types and rejects unknown', () => {
    expect(FieldType.create('singleLineText').isOk()).toBe(true);
    expect(FieldType.create('unknown').isErr()).toBe(true);
  });

  it('exposes constructors', () => {
    expect(FieldType.singleLineText().toString()).toBe('singleLineText');
    expect(FieldType.longText().toString()).toBe('longText');
    expect(FieldType.number().toString()).toBe('number');
    expect(FieldType.rating().toString()).toBe('rating');
    expect(FieldType.singleSelect().toString()).toBe('singleSelect');
    expect(FieldType.multipleSelect().toString()).toBe('multipleSelect');
    expect(FieldType.checkbox().toString()).toBe('checkbox');
    expect(FieldType.attachment().toString()).toBe('attachment');
    expect(FieldType.date().toString()).toBe('date');
    expect(FieldType.user().toString()).toBe('user');
    expect(FieldType.button().toString()).toBe('button');
  });
});

describe('Field', () => {
  it('manages db field names', () => {
    const fieldIdResult = createFieldId('a');
    const fieldNameResult = FieldName.create('Title');
    expect([fieldIdResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
    if (fieldIdResult.isErr() || fieldNameResult.isErr()) return;

    const fieldResult = SingleLineTextField.create({
      id: fieldIdResult.value,
      name: fieldNameResult.value,
    });
    expect(fieldResult.isOk()).toBe(true);
    if (fieldResult.isErr()) return;
    const field = fieldResult.value;

    expect(field.dbFieldName().isErr()).toBe(true);
    expect(field.setDbFieldName(DbFieldName.empty()).isErr()).toBe(true);

    const dbNameResult = DbFieldName.rehydrate('db_field');
    const otherDbNameResult = DbFieldName.rehydrate('db_field_other');
    expect([dbNameResult, otherDbNameResult].every((r) => r.isOk())).toBe(true);
    if (dbNameResult.isErr() || otherDbNameResult.isErr()) return;

    expect(field.setDbFieldName(dbNameResult.value).isOk()).toBe(true);
    expect(field.dbFieldName().isOk()).toBe(true);
    expect(field.setDbFieldName(dbNameResult.value).isOk()).toBe(true);
    expect(field.setDbFieldName(otherDbNameResult.value).isErr()).toBe(true);
  });
});
