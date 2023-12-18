import { CellValueType, FieldType } from './constant';
import { RollupFieldCore, SingleLineTextFieldCore, NumberFieldCore } from './derivate';
import { fieldRoSchema, unionFieldOptionsRoSchema } from './field.schema';
import { NumberFormattingType } from './formatting';

describe('field Schema Test', () => {
  it('should return true when options validate', () => {
    const options = {
      expression: '1 + 1',
      formatting: {
        type: NumberFormattingType.Decimal,
        precision: 2,
      },
    };

    const result = unionFieldOptionsRoSchema.safeParse(options);
    expect(result.success).toBe(true);
    result.success && expect(result.data).toEqual(options);
  });

  it('should return true when options and type match', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
    };

    const result = fieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return false when options and type mismatch', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: NumberFieldCore.defaultOptions(),
    };

    const result = fieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });

  it('should return true when isLookup with lookupOptions', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = fieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return false when isLookup without lookupOptions', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      isLookup: true,
    };

    const result = fieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });

  it('should return false when lookupOptions without isLookup', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = fieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });

  it('should return true when lookupOptions without isLookup in rollup field', () => {
    const fieldRo = {
      type: FieldType.Rollup,
      options: RollupFieldCore.defaultOptions(CellValueType.String),
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = fieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });
});
