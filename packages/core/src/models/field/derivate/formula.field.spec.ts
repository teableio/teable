import { plainToInstance } from 'class-transformer';
import { Colors } from '../colors';
import { DbFieldType, FieldType, CellValueType } from '../constant';
import { DateFormattingPreset, NumberFormattingType, TimeFormatting } from '../formatting';
import {
  MultiNumberDisplayType,
  SingleLineTextDisplayType,
  SingleNumberDisplayType,
} from '../show-as';
import { FormulaFieldCore } from './formula.field';
import { NumberFieldCore } from './number.field';

describe('FormulaFieldCore', () => {
  const singleNumberShowAsProps = {
    type: SingleNumberDisplayType.Ring,
    color: Colors.TealBright,
    showValue: false,
    maxValue: 100,
  };

  const multiNumberShowAsProps = {
    type: MultiNumberDisplayType.Line,
    color: Colors.TealBright,
  };

  const numberFormulaJson = {
    id: 'fld666',
    name: 'formulaField',
    description: 'A test formula field',
    notNull: false,
    unique: false,
    isPrimary: false,
    columnMeta: {
      index: 0,
      columnIndex: 0,
    },
    type: FieldType.Formula,
    dbFieldType: DbFieldType.Real,
    options: {
      expression: '{fld123} + 2',
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      timeZone: 'Asia/Shanghai',
      showAs: singleNumberShowAsProps,
    },
    cellValueType: CellValueType.Number,
    isComputed: true,
  };

  const numberFormulaField = plainToInstance(FormulaFieldCore, numberFormulaJson);

  const numberField = plainToInstance(NumberFieldCore, {
    id: 'fld123',
    name: 'testField',
    description: 'A test number field',
    notNull: true,
    unique: true,
    isPrimary: true,
    columnMeta: {
      index: 0,
      columnIndex: 0,
    },
    type: FieldType.Number,
    dbFieldType: DbFieldType.Real,
    options: {
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
    },
    cellValueType: CellValueType.Number,
    isComputed: false,
  });

  const stringFormulaField = plainToInstance(FormulaFieldCore, {
    ...numberFormulaJson,
    options: {
      expression: 'text',
      showAs: {
        type: SingleLineTextDisplayType.Url,
      },
    },
    cellValueType: CellValueType.String,
  });

  const dateFormulaField = plainToInstance(FormulaFieldCore, {
    ...numberFormulaJson,
    options: {
      ...numberFormulaJson.options,
      formatting: {
        date: DateFormattingPreset.US,
        time: TimeFormatting.None,
        timeZone: 'utc',
      },
      showAs: undefined,
    },
    cellValueType: CellValueType.DateTime,
  });

  const booleanFormulaField = plainToInstance(FormulaFieldCore, {
    ...numberFormulaJson,
    options: {
      ...numberFormulaJson.options,
      formatting: undefined,
      showAs: undefined,
    },
    cellValueType: CellValueType.Boolean,
  });

  const lookupMultipleFormulaField = plainToInstance(FormulaFieldCore, {
    ...numberFormulaJson,
    options: {
      ...numberFormulaJson.options,
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      showAs: multiNumberShowAsProps,
    },
    cellValueType: CellValueType.Number,
    isLookup: true,
    isMultipleCellValue: true,
  });

  const invalidShowAsTestCases = [
    {
      ...numberFormulaJson,
      options: {
        ...numberFormulaJson.options,
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.Number,
      isMultipleCellValue: true,
      isLookup: true,
    },
    {
      ...numberFormulaJson,
      options: {
        ...numberFormulaJson.options,
        showAs: multiNumberShowAsProps,
      },
      cellValueType: CellValueType.Number,
      isMultipleCellValue: false,
    },
    {
      ...numberFormulaJson,
      options: {
        ...numberFormulaJson.options,
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
    },
    {
      ...numberFormulaJson,
      options: {
        expression: '"abc"',
        showAs: {
          type: 'test',
        },
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
    },
    {
      ...numberFormulaJson,
      options: {
        ...numberFormulaJson.options,
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.DateTime,
      isMultipleCellValue: false,
    },
    {
      ...numberFormulaJson,
      options: {
        ...numberFormulaJson.options,
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.Boolean,
      isMultipleCellValue: false,
    },
  ];

  describe('basic function', () => {
    it('should convert cellValue to string', () => {
      expect(numberFormulaField.cellValue2String(1)).toBe('1.00');
      expect(stringFormulaField.cellValue2String('text')).toBe('text');
      expect(dateFormulaField.cellValue2String('2023-06-19T06:50:48.017Z')).toBe('6/19/2023');
      expect(booleanFormulaField.cellValue2String(true)).toBe('true');
      expect(lookupMultipleFormulaField.cellValue2String([1, 2, 3])).toBe('1.00, 2.00, 3.00');
    });

    it('should validate cellValue', () => {
      expect(numberFormulaField.validateCellValue(1).success).toBe(true);
      expect(numberFormulaField.validateCellValue('1').success).toBe(false);
      expect(stringFormulaField.validateCellValue('text').success).toBe(true);
      expect(stringFormulaField.validateCellValue(666).success).toBe(false);
      expect(dateFormulaField.validateCellValue('date').success).toBe(false);
      expect(dateFormulaField.validateCellValue('2023-06-19T06:50:48.017Z').success).toBe(true);
      expect(booleanFormulaField.validateCellValue(true).success).toBe(true);
      expect(booleanFormulaField.validateCellValue('true').success).toBe(false);
      expect(lookupMultipleFormulaField.validateCellValue([1]).success).toBe(true);
      expect(lookupMultipleFormulaField.validateCellValue(1).success).toBe(false);
    });

    it('should convert string to cellValue', () => {
      expect(numberFormulaField.convertStringToCellValue('1')).toBe(null);
    });

    it('should repair invalid value', () => {
      expect(numberFormulaField.repair(1)).toBe(null);
    });
  });

  describe('calculation', () => {
    it('should parse the expression correctly', () => {
      const expression = '2 + 2';
      const parsed = FormulaFieldCore.parse(expression);
      expect(parsed).toBeDefined();
      // add more specific checks based on the return type of parse()
    });

    it('should convert field ids to names correctly', () => {
      const expression = '{fld123} + 1';
      const dependFieldMap = {
        fld123: { name: 'testField' },
        // add more fields if needed
      };
      const converted = FormulaFieldCore.convertExpressionIdToName(expression, dependFieldMap);
      expect(converted).toBe('{testField} + 1');
    });

    it('should convert field names to ids correctly', () => {
      const expression = '{testField} + 1';
      const dependFieldMap = {
        fld123: { name: 'testField' },
        // add more fields if needed
      };
      const converted = FormulaFieldCore.convertExpressionNameToId(expression, dependFieldMap);
      expect(converted).toBe('{fld123} + 1');
    });

    it('should return current typed value with field context', () => {
      expect(FormulaFieldCore.getParsedValueType('2 + 2', {})).toEqual({
        cellValueType: CellValueType.Number,
      });

      expect(
        FormulaFieldCore.getParsedValueType('{fld123}', {
          fld123: numberField,
        })
      ).toEqual({
        cellValueType: CellValueType.Number,
      });

      expect(
        FormulaFieldCore.getParsedValueType('{fld123}', {
          fld123: numberField,
        })
      ).toEqual({
        cellValueType: CellValueType.Number,
      });
    });

    it('should return current fieldIds by getReferenceFieldIds', () => {
      expect(numberFormulaField.getReferenceFieldIds()).toEqual(['fld123']);
    });

    it('should return eval result by evaluate', () => {
      expect(
        numberFormulaField
          .evaluate(
            {
              fld123: numberField,
            },
            {
              id: 'rec123',
              fields: {
                fld123: 1,
              },
            }
          )
          .toPlain()
      ).toEqual(3);
    });
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(numberFormulaField.validateOptions().success).toBeTruthy();
      expect(stringFormulaField.validateOptions().success).toBeTruthy();
      expect(dateFormulaField.validateOptions().success).toBeTruthy();
      expect(booleanFormulaField.validateOptions().success).toBeTruthy();
      expect(lookupMultipleFormulaField.validateOptions().success).toBeTruthy();
    });

    it('should return failure if options are invalid', () => {
      expect(
        plainToInstance(FormulaFieldCore, {
          ...numberFormulaJson,
          options: {
            expression: '',
          },
          cellValueType: CellValueType.Number,
          isMultipleCellValue: false,
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(FormulaFieldCore, {
          ...numberFormulaJson,
          options: {
            expression: '',
            formatting: {
              date: DateFormattingPreset.US,
              time: TimeFormatting.None,
              timeZone: 'xxx/xxx',
            },
          },
          cellValueType: CellValueType.DateTime,
          isMultipleCellValue: false,
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(FormulaFieldCore, {
          ...numberFormulaJson,
          options: {
            expression: '',
            formatting: {
              type: NumberFormattingType.Decimal,
              precision: 2,
            },
          },
          cellValueType: CellValueType.String,
          isMultipleCellValue: false,
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(FormulaFieldCore, {
          ...numberFormulaJson,
          options: {
            expression: '',
            formatting: {
              type: NumberFormattingType.Decimal,
              precision: 2,
            },
          },
          cellValueType: CellValueType.Boolean,
          isMultipleCellValue: false,
        }).validateOptions().success
      ).toBeFalsy();

      invalidShowAsTestCases.forEach((field) => {
        expect(plainToInstance(FormulaFieldCore, field).validateOptions().success).toBeFalsy();
      });
    });

    it('should get default options', () => {
      expect(FormulaFieldCore.defaultOptions(CellValueType.Number)).toMatchObject({
        expression: '',
        formatting: {
          type: NumberFormattingType.Decimal,
          precision: 2,
        },
      });
    });
  });
});
