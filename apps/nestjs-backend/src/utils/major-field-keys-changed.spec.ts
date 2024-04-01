import { FieldType, Relationship, NumberFormattingType } from '@teable/core';
import type {
  ILinkFieldOptions,
  INumberFormatting,
  IFieldVo,
  IConvertFieldRo,
  IFormulaFieldOptions,
} from '@teable/core';
import { majorFieldKeysChanged } from './major-field-keys-changed';

// Mock data setup
const linkField = {
  type: FieldType.Link,
  name: 'link',
  dbFieldName: 'link_field',
  options: {
    relationship: Relationship.ManyOne,
    foreignTableId: 'foreignTable',
    lookupFieldId: 'lookupField',
    isOneWay: true,
    fkHostTableName: 'hostTable',
    selfKeyName: 'selfKey',
    foreignKeyName: 'foreignKey',
    symmetricFieldId: 'symmetricField',
  } as ILinkFieldOptions,
} as IFieldVo;

const formulaField = {
  type: FieldType.Formula,
  name: 'name',
  dbFieldName: 'dbFieldName',
  options: {
    expression: '1 + 1',
    formatting: {
      precision: 1,
      type: NumberFormattingType.Decimal,
    } as INumberFormatting,
  },
} as IFieldVo;

const newFieldSame: IConvertFieldRo = {
  type: FieldType.Link,
  name: 'link',
  dbFieldName: 'link_field',
  options: {
    relationship: Relationship.ManyOne,
    foreignTableId: 'foreignTable',
  },
};

// Test cases
describe('majorFieldKeysChanged', () => {
  it('should return false if the field has not changed', () => {
    expect(majorFieldKeysChanged(linkField, newFieldSame)).toBe(false);
  });

  it('should return true if a major field property like type has changed', () => {
    expect(majorFieldKeysChanged(linkField, formulaField)).toBe(true);
  });

  it('should return false if non-major options like formatting have changed', () => {
    expect(
      majorFieldKeysChanged(formulaField, {
        ...formulaField,
        options: {
          ...formulaField.options,
          formatting: {
            ...(formulaField.options as IFormulaFieldOptions).formatting,
            precision: 2,
          },
        },
      })
    ).toBe(false);
  });

  it('should return true if major options like expression have changed', () => {
    expect(
      majorFieldKeysChanged(formulaField, {
        ...formulaField,
        options: { ...formulaField.options, expression: '2+2' },
      })
    ).toBe(true);
  });
});
