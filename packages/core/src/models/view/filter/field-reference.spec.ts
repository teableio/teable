import { CellValueType, FieldType } from '../../field/constant';
import {
  getFieldReferenceComparisonKind,
  getFieldReferenceSupportedOperators,
  isFieldReferenceComparable,
  isFieldReferenceOperatorSupported,
} from './field-reference';
import {
  contains,
  doesNotContain,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  is,
  isAfter,
  isAnyOf,
  isBefore,
  isExactly,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isNot,
  isNotExactly,
  isNoneOf,
  isOnOrAfter,
  isOnOrBefore,
  isWithIn,
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
  const ratingField = {
    cellValueType: CellValueType.Number,
    type: FieldType.Rating,
  } as const;
  const createdByField = {
    cellValueType: CellValueType.String,
    type: FieldType.CreatedBy,
  } as const;

  it('returns text operators for string fields', () => {
    expect(getFieldReferenceSupportedOperators(stringField)).toEqual([
      is.value,
      isNot.value,
      contains.value,
      doesNotContain.value,
    ]);
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
      isWithIn.value,
      isBefore.value,
      isAfter.value,
      isOnOrBefore.value,
      isOnOrAfter.value,
    ]);
  });

  it('returns collection operators for multi-value user field', () => {
    expect(getFieldReferenceSupportedOperators(multiUserField)).toEqual([
      hasAnyOf.value,
      hasAllOf.value,
      isExactly.value,
      hasNoneOf.value,
      isNotExactly.value,
    ]);
  });

  it('checks operator support', () => {
    expect(isFieldReferenceOperatorSupported(dateField, isBefore.value)).toBe(true);
    expect(isFieldReferenceOperatorSupported(stringField, isAfter.value)).toBe(false);
    expect(isFieldReferenceOperatorSupported(multiUserField, hasAnyOf.value)).toBe(true);
    expect(isFieldReferenceOperatorSupported(stringField, isAnyOf.value)).toBe(false);
    expect(isFieldReferenceOperatorSupported(stringField, isNoneOf.value)).toBe(false);
    expect(isFieldReferenceOperatorSupported(numberField, null)).toBe(false);
  });

  describe('comparison helpers', () => {
    it('classifies fields by semantic type', () => {
      expect(getFieldReferenceComparisonKind(numberField)).toBe('number');
      expect(getFieldReferenceComparisonKind(stringField)).toBe('string');
      expect(getFieldReferenceComparisonKind(dateField)).toBe('dateTime');
      expect(getFieldReferenceComparisonKind(createdByField)).toBe('user');
    });

    it('allows comparisons between numeric field families', () => {
      expect(isFieldReferenceComparable(numberField, ratingField)).toBe(true);
    });

    it('disallows comparisons between incompatible semantic types', () => {
      expect(isFieldReferenceComparable(createdByField, stringField)).toBe(false);
      expect(isFieldReferenceComparable(numberField, stringField)).toBe(false);
    });

    it('requires user-like fields on both sides', () => {
      const userField = {
        cellValueType: CellValueType.String,
        type: FieldType.User,
      } as const;
      expect(isFieldReferenceComparable(userField, createdByField)).toBe(true);
      expect(isFieldReferenceComparable(userField, stringField)).toBe(false);
    });
  });
});
