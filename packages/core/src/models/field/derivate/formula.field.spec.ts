import { plainToInstance } from 'class-transformer';
import { DbFieldType, FieldType } from '../constant';
import { CellValueType } from '../field';
import { FormulaFieldCore } from './formula.field';
import { NumberFieldCore } from './number.field';

describe('FormulaFieldCore', () => {
  const formulaField = plainToInstance(FormulaFieldCore, {
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
    },
    defaultValue: 0,
    calculatedType: FieldType.Formula,
    cellValueType: CellValueType.Number,
    isComputed: false,
  });

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
      precision: 2,
    },
    defaultValue: 0,
    calculatedType: FieldType.Number,
    cellValueType: CellValueType.Number,
    isComputed: false,
  });

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
      cellValueElementType: undefined,
    });

    expect(
      FormulaFieldCore.getParsedValueType('{fld123}', {
        fld123: numberField,
      })
    ).toEqual({
      cellValueType: CellValueType.Number,
      cellValueElementType: undefined,
    });

    expect(
      FormulaFieldCore.getParsedValueType('{fld123}', {
        fld123: numberField,
      })
    ).toEqual({
      cellValueType: CellValueType.Number,
      cellValueElementType: undefined,
    });
  });

  it('should return current fieldIds by getReferenceFieldIds', () => {
    expect(formulaField.getReferenceFieldIds()).toEqual(['fld123']);
  });

  it('should return eval result by evaluate', () => {
    expect(
      formulaField
        .evaluate(
          {
            fld123: numberField,
          },
          {
            id: 'rec123',
            fields: {
              fld123: 1,
            },
            recordOrder: {},
          }
        )
        .toPlain()
    ).toEqual(3);
  });
});
