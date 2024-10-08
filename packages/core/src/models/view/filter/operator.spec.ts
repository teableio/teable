/* eslint-disable @typescript-eslint/no-explicit-any */
import { CellValueType, FieldType } from '../../field';
import type { IDateTimeFieldOperator } from './operator';
import {
  booleanFieldValidOperators,
  contains,
  dateTimeFieldValidOperators,
  dateTimeFieldValidSubOperators,
  dateTimeFieldValidSubOperatorsByIsWithin,
  doesNotContain,
  getFilterOperatorMapping,
  getValidFilterOperators,
  getValidFilterSubOperators,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  isAfter,
  isAnyOf,
  isEmpty,
  isExactly,
  isNoneOf,
  isNotEmpty,
  isWithIn,
  numberFieldValidOperators,
  textFieldValidOperators,
} from './operator';

describe('Filter operators and sub-operators utility functions', () => {
  describe('getValidFilterOperators', () => {
    it('should return valid text field operators', () => {
      const textFieldField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.SingleLineText,
        isMultipleCellValue: false,
      };

      const validOps = getValidFilterOperators(textFieldField);
      expect(validOps).toEqual(expect.arrayContaining(textFieldValidOperators));
    });

    it('should return valid number field operators', () => {
      const numberField: any = {
        cellValueType: CellValueType.Number,
        type: FieldType.Number,
        isMultipleCellValue: false,
      };

      const validOps = getValidFilterOperators(numberField);
      expect(validOps).toEqual(expect.arrayContaining(numberFieldValidOperators));
    });

    it('should return valid checkbox field operators', () => {
      const checkboxField: any = {
        cellValueType: CellValueType.Boolean,
        type: FieldType.Checkbox,
        isMultipleCellValue: false,
      };

      const validOps = getValidFilterOperators(checkboxField);
      expect(validOps).toEqual(expect.arrayContaining(booleanFieldValidOperators));
    });

    it('should return valid date field operators', () => {
      const dateField: any = {
        cellValueType: CellValueType.DateTime,
        type: FieldType.Date,
        isMultipleCellValue: false,
      };

      const validOps = getValidFilterOperators(dateField);
      expect(validOps).toEqual(expect.arrayContaining(dateTimeFieldValidOperators));
    });

    it('should adjust operators based on the field type (SingleSelect)', () => {
      const singleSelectField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.SingleSelect,
        isMultipleCellValue: false,
      };
      const validOps = getValidFilterOperators(singleSelectField);
      expect(validOps).not.toContain(contains.value);
      expect(validOps).not.toContain(doesNotContain.value);
      expect(validOps).toContain(isAnyOf.value);
      expect(validOps).toContain(isNoneOf.value);

      const multipleSelectField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.SingleSelect,
        isMultipleCellValue: true,
      };

      const validOpsWithMultiple = getValidFilterOperators(multipleSelectField);

      // same with multiple select
      expect(validOpsWithMultiple).not.toContain(contains.value);
      expect(validOpsWithMultiple).not.toContain(doesNotContain.value);
      expect(validOpsWithMultiple).toContain(hasAnyOf.value);
      expect(validOpsWithMultiple).toContain(hasAllOf.value);
      expect(validOpsWithMultiple).toContain(isExactly.value);
      expect(validOpsWithMultiple).toContain(hasNoneOf.value);
    });

    it('should adjust operators based on the field type (MultipleSelect)', () => {
      const multipleSelectField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.MultipleSelect,
        isMultipleCellValue: true,
      };
      const validOps = getValidFilterOperators(multipleSelectField);
      expect(validOps).not.toContain(contains.value);
      expect(validOps).not.toContain(doesNotContain.value);
      expect(validOps).toContain(hasAnyOf.value);
      expect(validOps).toContain(hasAllOf.value);
      expect(validOps).toContain(isExactly.value);
      expect(validOps).toContain(hasNoneOf.value);
    });

    it('should adjust operators based on the field type (Attachment)', () => {
      const attachmentField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.Attachment,
        isMultipleCellValue: true,
      };
      const validOps = getValidFilterOperators(attachmentField);
      expect(validOps).toEqual(expect.arrayContaining([isEmpty.value, isNotEmpty.value]));
    });

    it('should adjust operators based on the field type (Link)', () => {
      const linkField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.Link,
        isMultipleCellValue: false,
      };
      const validOps = getValidFilterOperators(linkField);
      expect(validOps).toContain(contains.value);
      expect(validOps).toContain(doesNotContain.value);
    });

    it('should adjust operators based on the field type (User)', () => {
      const userField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.User,
        isMultipleCellValue: false,
      };
      const validOps = getValidFilterOperators(userField);
      expect(validOps).not.toContain(contains.value);
      expect(validOps).not.toContain(doesNotContain.value);
      expect(validOps).toContain(isAnyOf.value);
      expect(validOps).toContain(isNoneOf.value);

      const multipleUserField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.User,
        isMultipleCellValue: true,
      };
      const validOps1 = getValidFilterOperators(multipleUserField);
      expect(validOps1).not.toContain(contains.value);
      expect(validOps1).not.toContain(doesNotContain.value);
      expect(validOps1).toContain(hasAnyOf.value);
      expect(validOps1).toContain(hasAllOf.value);
      expect(validOps1).toContain(isExactly.value);
      expect(validOps1).toContain(hasNoneOf.value);
    });
  });

  describe('getFilterOperatorMapping', () => {
    it('should map valid filter operators to their corresponding symbols', () => {
      const sampleField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.SingleLineText,
        isMultipleCellValue: false,
      };

      const validOps = getValidFilterOperators(sampleField);
      const mapping = getFilterOperatorMapping(sampleField);

      validOps.forEach((op) => {
        expect(mapping[op]).toBeDefined();
      });
    });
  });

  describe('getValidFilterSubOperators', () => {
    it('should return undefined when fieldType is not Date', () => {
      const nonDateField: any = {
        cellValueType: CellValueType.String,
        type: FieldType.SingleLineText,
        isMultipleCellValue: false,
      };
      const parentOp: IDateTimeFieldOperator = isWithIn.value;

      const subOperators = getValidFilterSubOperators(nonDateField.type, parentOp);
      expect(subOperators).toBeUndefined();
    });

    it('should return valid date sub-operators when fieldType is Date and parent operator is "isWithin"', () => {
      const dateField: any = {
        cellValueType: CellValueType.DateTime,
        type: FieldType.Date,
        isMultipleCellValue: false,
      };
      const parentOp: IDateTimeFieldOperator = isWithIn.value;

      const subOperators = getValidFilterSubOperators(dateField.type, parentOp);
      expect(subOperators).toEqual(dateTimeFieldValidSubOperatorsByIsWithin);
    });

    it('should return valid date sub-operators when fieldType is Date and parent operator is NOT "isWithin"', () => {
      const dateField: any = {
        cellValueType: CellValueType.DateTime,
        type: FieldType.Date,
        isMultipleCellValue: false,
      };
      const parentOp: IDateTimeFieldOperator = isAfter.value;

      const subOperators = getValidFilterSubOperators(dateField.type, parentOp);
      expect(subOperators).toEqual(dateTimeFieldValidSubOperators);
    });
  });
});
