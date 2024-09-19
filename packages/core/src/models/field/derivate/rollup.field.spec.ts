/* eslint-disable sonarjs/no-duplicate-string */
import { plainToInstance } from 'class-transformer';
import { Colors } from '../colors';
import { DbFieldType, FieldType, CellValueType } from '../constant';
import { DateFormattingPreset, NumberFormattingType, TimeFormatting } from '../formatting';
import {
  MultiNumberDisplayType,
  SingleLineTextDisplayType,
  SingleNumberDisplayType,
} from '../show-as';
import { NumberFieldCore } from './number.field';
import { RollupFieldCore } from './rollup.field';

describe('RollupFieldCore', () => {
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

  const numberRollupJson = {
    id: 'fld666',
    name: 'formulaField',
    description: 'A test formula field',
    type: FieldType.Rollup,
    dbFieldType: DbFieldType.Real,
    options: {
      expression: 'countall({values})',
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      showAs: singleNumberShowAsProps,
    },
    cellValueType: CellValueType.Number,
    isComputed: true,
  };

  const numberField = plainToInstance(NumberFieldCore, {
    id: 'values',
    name: 'values',
    description: 'A test number field',
    type: FieldType.Number,
    options: {
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
    },
    cellValueType: CellValueType.Number,
    isMultipleCellValue: true,
  });

  const numberRollupField = plainToInstance(RollupFieldCore, numberRollupJson);

  const stringRollupField = plainToInstance(RollupFieldCore, {
    ...numberRollupJson,
    options: {
      expression: 'concatenate({values})',
      showAs: {
        type: SingleLineTextDisplayType.Url,
      },
    },
    cellValueType: CellValueType.String,
  });

  const booleanRollupField = plainToInstance(RollupFieldCore, {
    ...numberRollupJson,
    options: {
      ...numberRollupJson.options,
      formatting: undefined,
      showAs: undefined,
    },
    cellValueType: CellValueType.Boolean,
  });

  const lookupMultipleRollupField = plainToInstance(RollupFieldCore, {
    ...numberRollupJson,
    options: {
      ...numberRollupJson.options,
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      showAs: multiNumberShowAsProps,
    },
    cellValueType: CellValueType.Number,
    isLookup: true,
    isMultipleCellValue: true,
  });

  const invalidShowAsTestCases = [
    {
      ...numberRollupJson,
      options: {
        ...numberRollupJson.options,
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.Number,
      isMultipleCellValue: true,
      isLookup: true,
    },
    {
      ...numberRollupJson,
      options: {
        ...numberRollupJson.options,
        showAs: multiNumberShowAsProps,
      },
      cellValueType: CellValueType.Number,
      isMultipleCellValue: false,
    },
    {
      ...numberRollupJson,
      options: {
        expression: 'array_join({values})',
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
    },
    {
      ...numberRollupJson,
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
      ...numberRollupJson,
      options: {
        ...numberRollupJson.options,
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.DateTime,
      isMultipleCellValue: false,
    },
    {
      ...numberRollupJson,
      options: {
        ...numberRollupJson.options,
        showAs: singleNumberShowAsProps,
      },
      cellValueType: CellValueType.Boolean,
      isMultipleCellValue: false,
    },
  ];

  describe('basic function', () => {
    it('should convert cellValue to string', () => {
      expect(numberRollupField.cellValue2String(1)).toBe('1.00');
      expect(stringRollupField.cellValue2String('text')).toBe('text');
      expect(booleanRollupField.cellValue2String(true)).toBe('true');
      expect(lookupMultipleRollupField.cellValue2String([1, 2, 3])).toBe('1.00, 2.00, 3.00');
    });

    it('should validate cellValue', () => {
      expect(numberRollupField.validateCellValue(1).success).toBe(true);
      expect(numberRollupField.validateCellValue('1').success).toBe(false);
      expect(stringRollupField.validateCellValue('text').success).toBe(true);
      expect(stringRollupField.validateCellValue(666).success).toBe(false);
      expect(booleanRollupField.validateCellValue(true).success).toBe(true);
      expect(booleanRollupField.validateCellValue('true').success).toBe(false);
      expect(lookupMultipleRollupField.validateCellValue([1]).success).toBe(true);
      expect(lookupMultipleRollupField.validateCellValue(1).success).toBe(false);
    });

    it('should convert string to cellValue', () => {
      expect(numberRollupField.convertStringToCellValue('1')).toBe(null);
    });

    it('should repair invalid value', () => {
      expect(numberRollupField.repair(1)).toBe(null);
    });
  });

  describe('calculation', () => {
    it('should parse the expression correctly', () => {
      const expression = '2 + 2';
      const parsed = RollupFieldCore.parse(expression);
      expect(parsed).toBeDefined();
      // add more specific checks based on the return type of parse()
    });

    it('should return current typed value with field context', () => {
      expect(
        RollupFieldCore.getParsedValueType('countall({values})', CellValueType.Number, false)
      ).toEqual({
        cellValueType: CellValueType.Number,
      });

      expect(
        RollupFieldCore.getParsedValueType('sum({values})', CellValueType.Number, false)
      ).toEqual({
        cellValueType: CellValueType.Number,
      });

      expect(
        RollupFieldCore.getParsedValueType('sum({values})', CellValueType.Number, false)
      ).toEqual({
        cellValueType: CellValueType.Number,
      });

      expect(
        RollupFieldCore.getParsedValueType('concatenate({values})', CellValueType.Number, false)
      ).toEqual({
        cellValueType: CellValueType.String,
      });

      expect(
        RollupFieldCore.getParsedValueType('and({values})', CellValueType.Number, false)
      ).toEqual({
        cellValueType: CellValueType.Boolean,
      });
    });

    it('should return eval result by evaluate', () => {
      expect(
        numberRollupField
          .evaluate(
            {
              values: numberField,
            },
            {
              id: 'rec123',
              fields: {
                values: [1, 2],
              },
            }
          )
          .toPlain()
      ).toEqual(2);
    });
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log((numberRollupField.validateOptions() as any).error);
      expect(numberRollupField.validateOptions().success).toBeTruthy();
      expect(stringRollupField.validateOptions().success).toBeTruthy();
      expect(booleanRollupField.validateOptions().success).toBeTruthy();
      expect(lookupMultipleRollupField.validateOptions().success).toBeTruthy();
    });

    it('should return failure if options are invalid', () => {
      expect(
        plainToInstance(RollupFieldCore, {
          ...numberRollupJson,
          options: {
            ...numberRollupJson.options,
            expression: '',
          },
          cellValueType: CellValueType.Number,
          isMultipleCellValue: false,
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(RollupFieldCore, {
          ...numberRollupJson,
          options: {
            expression: '',
          },
          cellValueType: CellValueType.Number,
          isMultipleCellValue: false,
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(RollupFieldCore, {
          ...numberRollupJson,
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
        plainToInstance(RollupFieldCore, {
          ...numberRollupJson,
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
        plainToInstance(RollupFieldCore, {
          ...numberRollupJson,
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
        expect(plainToInstance(RollupFieldCore, field).validateOptions().success).toBeFalsy();
      });
    });

    it('should get default options', () => {
      expect(RollupFieldCore.defaultOptions(CellValueType.Number)).toMatchObject({
        expression: 'countall({values})',
        formatting: {
          type: NumberFormattingType.Decimal,
          precision: 2,
        },
      });
    });
  });
});
