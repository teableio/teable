import { describe, expect, it } from 'vitest';

import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import {
  RecordConditionDateValue,
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
  isRecordConditionDateValue,
  isRecordConditionFieldReferenceValue,
  isRecordConditionLiteralListValue,
  isRecordConditionLiteralValue,
} from './RecordConditionValues';

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

const createTextField = (seed: string, name: string) =>
  SingleLineTextField.create({ id: fieldId(seed), name: fieldName(name) })._unsafeUnwrap();

describe('RecordConditionValues', () => {
  it('creates and compares literal values', () => {
    const valueA = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
    const valueB = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
    const valueC = RecordConditionLiteralValue.create('world')._unsafeUnwrap();

    expect(valueA.equals(valueB)).toBe(true);
    expect(valueA.equals(valueC)).toBe(false);
    expect(valueA.toValue()).toBe('hello');
    expect(isRecordConditionLiteralValue(valueA)).toBe(true);
    expect(RecordConditionLiteralValue.create({}).isErr()).toBe(true);
  });

  it('creates and compares literal list values', () => {
    const list = RecordConditionLiteralListValue.create(['a', 'b'])._unsafeUnwrap();
    const same = RecordConditionLiteralListValue.create(['a', 'b'])._unsafeUnwrap();
    const different = RecordConditionLiteralListValue.create(['a', 'c'])._unsafeUnwrap();

    expect(list.equals(same)).toBe(true);
    expect(list.equals(different)).toBe(false);
    expect(list.toValues()).toEqual(['a', 'b']);
    expect(isRecordConditionLiteralListValue(list)).toBe(true);
    expect(RecordConditionLiteralListValue.create([]).isErr()).toBe(true);

    const snapshot = [...list.toValues()];
    snapshot.push('c');
    expect(list.toValues()).toEqual(['a', 'b']);
  });

  it('creates date values with validation', () => {
    expect(
      RecordConditionDateValue.create({
        mode: 'exactDate',
        timeZone: 'utc',
      }).isErr()
    ).toBe(true);

    expect(
      RecordConditionDateValue.create({
        mode: 'daysAgo',
        timeZone: 'utc',
      }).isErr()
    ).toBe(true);

    expect(
      RecordConditionDateValue.create({
        mode: 'exactDate',
        exactDate: '2024-01-02T00:00:00.000Z',
        timeZone: 'Bad/Zone',
      }).isErr()
    ).toBe(true);

    const dateValue = RecordConditionDateValue.create({
      mode: 'exactDate',
      exactDate: '2024-01-02T00:00:00.000Z',
      timeZone: 'utc',
    })._unsafeUnwrap();
    const same = RecordConditionDateValue.create({
      mode: 'exactDate',
      exactDate: '2024-01-02T00:00:00.000Z',
      timeZone: 'utc',
    })._unsafeUnwrap();
    const different = RecordConditionDateValue.create({
      mode: 'exactDate',
      exactDate: '2024-01-03T00:00:00.000Z',
      timeZone: 'utc',
    })._unsafeUnwrap();

    expect(dateValue.equals(same)).toBe(true);
    expect(dateValue.equals(different)).toBe(false);
    expect(dateValue.toConfig()).toEqual({
      mode: 'exactDate',
      numberOfDays: undefined,
      exactDate: '2024-01-02T00:00:00.000Z',
      timeZone: 'utc',
    });
    expect(isRecordConditionDateValue(dateValue)).toBe(true);
  });

  it('creates and compares field reference values', () => {
    const fieldA = createTextField('a', 'Title');
    const fieldB = createTextField('b', 'Ref');
    const refA = RecordConditionFieldReferenceValue.create(fieldA)._unsafeUnwrap();
    const refB = RecordConditionFieldReferenceValue.create(fieldA)._unsafeUnwrap();
    const refC = RecordConditionFieldReferenceValue.create(fieldB)._unsafeUnwrap();

    expect(refA.equals(refB)).toBe(true);
    expect(refA.equals(refC)).toBe(false);
    expect(refA.field().id().equals(fieldA.id())).toBe(true);
    expect(isRecordConditionFieldReferenceValue(refA)).toBe(true);
  });
});
