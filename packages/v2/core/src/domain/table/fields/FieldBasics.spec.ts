import { describe, expect, it } from 'vitest';

import { DbFieldName } from './DbFieldName';
import { FieldId } from './FieldId';
import { FieldName } from './FieldName';
import { FieldType } from './FieldType';
import { SingleLineTextField } from './types/SingleLineTextField';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('FieldName', () => {
  it('validates field names', () => {
    FieldName.create('Title')._unsafeUnwrap();
    FieldName.create('')._unsafeUnwrapErr();
  });

  it('compares field names by value', () => {
    const left = FieldName.create('A');
    const right = FieldName.create('A');
    const other = FieldName.create('B');
    [left, right, other].forEach((r) => r._unsafeUnwrap());
    left._unsafeUnwrap();
    right._unsafeUnwrap();
    other._unsafeUnwrap();
    expect(left.value.equals(right.value)).toBe(true);
    expect(left.value.equals(other.value)).toBe(false);
    expect(left.value.toString()).toBe('A');
  });
});

describe('DbFieldName', () => {
  it('rehydrates and validates', () => {
    DbFieldName.rehydrate('db_field')._unsafeUnwrap();
    DbFieldName.rehydrate('')._unsafeUnwrapErr();
  });

  it('requires rehydrate before access', () => {
    const empty = DbFieldName.empty();
    expect(empty.isRehydrated()).toBe(false);
    empty.value()._unsafeUnwrapErr();
  });
});

describe('FieldType', () => {
  it('accepts known types and rejects unknown', () => {
    FieldType.create('singleLineText')._unsafeUnwrap();
    FieldType.create('link')._unsafeUnwrap();
    FieldType.create('unknown')._unsafeUnwrapErr();
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
    expect(FieldType.link().toString()).toBe('link');
  });
});

describe('Field', () => {
  it('manages db field names', () => {
    const fieldIdResult = createFieldId('a');
    const fieldNameResult = FieldName.create('Title');
    [fieldIdResult, fieldNameResult].forEach((r) => r._unsafeUnwrap());
    fieldIdResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();

    const fieldResult = SingleLineTextField.create({
      id: fieldIdResult._unsafeUnwrap(),
      name: fieldNameResult._unsafeUnwrap(),
    });
    fieldResult._unsafeUnwrap();

    const field = fieldResult._unsafeUnwrap();

    field.dbFieldName()._unsafeUnwrapErr();
    field.setDbFieldName(DbFieldName.empty())._unsafeUnwrapErr();

    const dbNameResult = DbFieldName.rehydrate('db_field');
    const otherDbNameResult = DbFieldName.rehydrate('db_field_other');
    [dbNameResult, otherDbNameResult].forEach((r) => r._unsafeUnwrap());
    dbNameResult._unsafeUnwrap();
    otherDbNameResult._unsafeUnwrap();

    field.setDbFieldName(dbNameResult._unsafeUnwrap())._unsafeUnwrap();
    field.dbFieldName()._unsafeUnwrap();
    field.setDbFieldName(dbNameResult._unsafeUnwrap())._unsafeUnwrap();
    field.setDbFieldName(otherDbNameResult._unsafeUnwrap())._unsafeUnwrapErr();
  });
});
