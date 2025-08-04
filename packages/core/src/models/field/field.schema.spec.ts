import { Colors } from './colors';
import { CellValueType, FieldType } from './constant';
import { RollupFieldCore, SingleLineTextFieldCore } from './derivate';
import { createFieldRoSchema, unionFieldOptionsRoSchema } from './field.schema';
import { NumberFormattingType } from './formatting';
import type { IUnionShowAs } from './show-as';
import { SingleNumberDisplayType } from './show-as';

describe('field Schema Test', () => {
  it('should return true when options validate', () => {
    const options = {
      expression: '1 + 1',
      formatting: {
        type: NumberFormattingType.Decimal,
        precision: 2,
      },
      timeZone: 'Asia/Shanghai',
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

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
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

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return false when isLookup without lookupOptions', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      isLookup: true,
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
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

    const result = createFieldRoSchema.safeParse(fieldRo);
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

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return true when isLookup field with formatting or showAs options', () => {
    const fieldRo = {
      type: FieldType.Rollup,
      options: {
        formatting: {
          type: NumberFormattingType.Decimal,
          precision: 2,
        },
        showAs: {
          type: SingleNumberDisplayType.Ring,
          color: Colors.Blue,
          showValue: true,
          maxValue: 100,
        } as IUnionShowAs,
      },
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);

    const lookUpFieldRo = {
      isLookup: true,
      ...fieldRo,
    };

    const result2 = createFieldRoSchema.safeParse(lookUpFieldRo);
    expect(result2.success).toBe(true);
  });
});
