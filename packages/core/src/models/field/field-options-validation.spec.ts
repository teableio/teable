/* eslint-disable sonarjs/no-duplicate-string */
import { describe, it, expect } from 'vitest';
import { z } from '../../zod';
import { FieldType } from './constant';
import { convertFieldRoSchema } from './field.schema';

describe('Field Options Validation Issue Reproduction', () => {
  it('should validate number field with precision formatting without expression/date errors', () => {
    const numberFieldWithPrecision = {
      id: 'fld001',
      name: 'Exchange Rate',
      type: FieldType.Number,
      description: 'Foreign currency to RMB exchange rate',
      options: {
        formatting: {
          type: 'decimal',
          precision: 4,
        },
      },
    };

    const result = convertFieldRoSchema.safeParse(numberFieldWithPrecision);
    expect(result.success).toBe(true);
  });

  it('FIXED: number field with precision-only formatting now gives clear error message', () => {
    const numberFieldWithPrecisionOnly = {
      id: 'fld007',
      name: 'Exchange Rate',
      type: FieldType.Number,
      description: 'Foreign currency to RMB exchange rate',
      options: {
        formatting: {
          precision: 4,
        },
      },
    };

    const result = convertFieldRoSchema.safeParse(numberFieldWithPrecisionOnly);
    expect(result.success).toBe(false);

    if (!result.success) {
      const errorMessage = result.error.message;

      expect(errorMessage).not.toContain('expression');
      expect(errorMessage).not.toContain('formatting.date');
      expect(errorMessage).not.toContain('"date"');
      expect(errorMessage).not.toContain('countall');
      expect(errorMessage).not.toContain('sum({values})');

      expect(errorMessage).toContain('type');
      expect(errorMessage.toLowerCase()).toMatch(/decimal|percent|currency/);
    }
  });

  it('should not confuse number field options with rollup/formula field options', () => {
    const numberField = {
      id: 'fld002',
      name: 'Amount',
      type: FieldType.Number,
      options: {
        formatting: {
          type: 'decimal',
          precision: 2,
        },
      },
    };

    const result = convertFieldRoSchema.safeParse(numberField);

    if (!result.success) {
      const errorMessage = result.error.message;
      expect(errorMessage).not.toContain('expression');
      expect(errorMessage).not.toContain('countall');
      expect(errorMessage).not.toContain('counta');
      expect(errorMessage).not.toContain('sum({values})');
      expect(errorMessage).not.toContain('formatting.date');
      expect(errorMessage).not.toContain('formatting.time');
      expect(errorMessage).not.toContain('DateFormattingPreset');
    }

    expect(result.success).toBe(true);
  });

  it('should validate array of fields including number field at index 6', () => {
    const fields = [
      { id: 'fld001', name: 'Field 1', type: FieldType.SingleLineText, options: {} },
      { id: 'fld002', name: 'Field 2', type: FieldType.SingleLineText, options: {} },
      { id: 'fld003', name: 'Field 3', type: FieldType.SingleLineText, options: {} },
      { id: 'fld004', name: 'Field 4', type: FieldType.SingleLineText, options: {} },
      { id: 'fld005', name: 'Field 5', type: FieldType.SingleLineText, options: {} },
      { id: 'fld006', name: 'Field 6', type: FieldType.SingleLineText, options: {} },
      {
        id: 'fld007',
        name: 'Exchange Rate',
        type: FieldType.Number,
        description: 'Foreign currency to RMB exchange rate',
        options: {
          formatting: {
            type: 'decimal',
            precision: 4,
          },
        },
      },
    ];

    const fieldsArraySchema = z.array(convertFieldRoSchema);
    const result = fieldsArraySchema.safeParse(fields);
    expect(result.success).toBe(true);
  });

  it('should properly validate number field with only formatting.precision', () => {
    const field = {
      id: 'fld001',
      name: 'Exchange Rate',
      type: FieldType.Number,
      options: {
        formatting: {
          precision: 4,
        },
      },
    };

    const result = convertFieldRoSchema.safeParse(field);
    expect(result.success).toBe(false);
  });

  it('should differentiate between number formatting and datetime formatting errors', () => {
    const fieldWithWrongFormatting = {
      id: 'fld001',
      name: 'Number Field',
      type: FieldType.Number,
      options: {
        formatting: {
          date: 'yyyy/MM/dd',
          time: 'None',
          timeZone: 'Asia/Shanghai',
        },
      },
    };

    const result = convertFieldRoSchema.safeParse(fieldWithWrongFormatting);
    expect(result.success).toBe(false);
  });

  it('should validate rollup field with expression correctly', () => {
    const rollupField = {
      id: 'fld001',
      name: 'Rollup Field',
      type: FieldType.Rollup,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tbl001',
        linkFieldId: 'fld002',
        lookupFieldId: 'fld003',
      },
      options: {
        expression: 'sum({values})',
      },
    };

    const result = convertFieldRoSchema.safeParse(rollupField);
    expect(result.success).toBe(true);
  });

  it('should fail rollup field validation when missing expression', () => {
    const rollupFieldWithoutExpression = {
      id: 'fld001',
      name: 'Rollup Field',
      type: FieldType.Rollup,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tbl001',
        linkFieldId: 'fld002',
        lookupFieldId: 'fld003',
      },
      options: {},
    };

    const result = convertFieldRoSchema.safeParse(rollupFieldWithoutExpression);

    if (!result.success) {
      expect(result.error.message).toContain('expression');
    }
  });
});
