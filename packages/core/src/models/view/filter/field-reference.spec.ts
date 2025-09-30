import { CellValueType, FieldType } from '../../field/constant';
import {
  getFieldReferenceSupportedOperators,
  isFieldReferenceOperatorSupported,
} from './field-reference';
import {
  is,
  isAfter,
  isBefore,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isNot,
  isOnOrAfter,
  isOnOrBefore,
} from './operator';

describe('field reference operator helpers', () => {
  const stringField = {
    cellValueType: CellValueType.String,
    type: FieldType.SingleLineText,
  } as const;

  const numberField = {
    cellValueType: CellValueType.Number,
    type: FieldType.Number,
  } as const;

  const dateField = {
    cellValueType: CellValueType.DateTime,
    type: FieldType.Date,
  } as const;

  const multiUserField = {
    cellValueType: CellValueType.String,
    type: FieldType.User,
    isMultipleCellValue: true,
  } as const;

  it('returns equality operators for string fields', () => {
    expect(getFieldReferenceSupportedOperators(stringField)).toEqual([is.value, isNot.value]);
  });

  it('returns comparison operators for number fields', () => {
    expect(getFieldReferenceSupportedOperators(numberField)).toEqual([
      is.value,
      isNot.value,
      isGreater.value,
      isGreaterEqual.value,
      isLess.value,
      isLessEqual.value,
    ]);
  });

  it('returns range operators for date fields', () => {
    expect(getFieldReferenceSupportedOperators(dateField)).toEqual([
      is.value,
      isNot.value,
      isBefore.value,
      isAfter.value,
      isOnOrBefore.value,
      isOnOrAfter.value,
    ]);
  });

  it('excludes operators for multi-value user field', () => {
    expect(getFieldReferenceSupportedOperators(multiUserField)).toEqual([]);
  });

  it('checks operator support', () => {
    expect(isFieldReferenceOperatorSupported(dateField, isBefore.value)).toBe(true);
    expect(isFieldReferenceOperatorSupported(stringField, isAfter.value)).toBe(false);
    expect(isFieldReferenceOperatorSupported(multiUserField, is.value)).toBe(false);
    expect(isFieldReferenceOperatorSupported(numberField, null)).toBe(false);
  });
});
