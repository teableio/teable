/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { DateFormattingPreset, TimeFormatting } from '../models';
import { CellValueType, DbFieldType, FieldType } from '../models/field/constant';
import {
  LinkFieldCore,
  FormulaFieldCore,
  NumberFieldCore,
  DateFieldCore,
} from '../models/field/derivate';
import type { FieldCore } from '../models/field/field';
import type { IRecord } from '../models/record';
import { evaluate } from './evaluate';

describe('EvalVisitor', () => {
  let fieldContext: { [fieldId: string]: FieldCore } = {};
  const record: IRecord = {
    id: 'recTest',
    fields: {
      fldNumber: 8,
      fldMultipleNumber: [1, 2, 3],
      fldMultipleLink: [{ id: 'recxxxxxxx' }, { id: 'recyyyyyyy', title: 'A2' }],
      fldDate: new Date('2024-01-01'),
    },
    createdTime: new Date().toISOString(),
  };

  beforeAll(() => {
    const numberFieldJson = {
      id: 'fldNumber',
      name: 'fldNumberName',
      description: 'A test number field',
      type: FieldType.Number,
      options: {
        precision: 2,
      },
      cellValueType: CellValueType.Number,
    };

    const dateFieldJson = {
      id: 'fldDate',
      name: 'fldDateName',
      description: 'A test date field',
      type: FieldType.Date,
      options: {
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.None,
          timeZone: 'Asia/Shanghai',
        },
      },
      cellValueType: CellValueType.DateTime,
    };

    const multipleNumberFieldJson = {
      id: 'fldMultipleNumber',
      name: 'fldMultipleNumberName',
      description: 'A test number field',
      type: FieldType.Number,
      options: {
        precision: 2,
      },
      cellValueType: CellValueType.Number,
      isMultipleCellValue: true,
    };

    const multipleLinkFieldJson = {
      id: 'fldMultipleLink',
      name: 'fldMultipleLinkName',
      description: 'A test number field',
      type: FieldType.Link,
      options: {
        precision: 2,
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
    };

    const numberField = plainToInstance(NumberFieldCore, numberFieldJson);
    const multipleNumberField = plainToInstance(NumberFieldCore, multipleNumberFieldJson);
    const multipleLinkField = plainToInstance(LinkFieldCore, multipleLinkFieldJson);
    const dateField = plainToInstance(DateFieldCore, dateFieldJson);
    fieldContext = {
      [numberField.id]: numberField,
      [multipleNumberField.id]: multipleNumberField,
      [multipleLinkField.id]: multipleLinkField,
      [dateField.id]: dateField,
    };
  });

  const evalFormula = (
    input: string,
    fieldMap: { [fieldId: string]: FieldCore } = {},
    record?: IRecord
  ) => {
    return evaluate(input, fieldMap, record).value;
  };

  it('integer literal', () => {
    expect(evalFormula('42')).toBe(42);
  });

  it('decimal literal', () => {
    expect(evalFormula('3.14')).toBeCloseTo(3.14);
  });

  it('single quoted string literal', () => {
    expect(evalFormula("'hello world'")).toBe('hello world');
  });

  it('double quoted string literal', () => {
    expect(evalFormula('"hello world"')).toBe('hello world');
  });

  it('boolean literal true', () => {
    expect(evalFormula('TRUE')).toBe(true);
  });

  it('boolean literal false', () => {
    expect(evalFormula('FALSE')).toBe(false);
  });

  it('addition', () => {
    const record: IRecord = {
      id: 'recTest',
      fields: {
        fldMultipleNumber: [1],
        fldMultipleLink: [{ id: 'recxxxxxxx' }, { id: 'recyyyyyyy', title: 'A2' }],
      },
      createdTime: new Date().toISOString(),
    };

    expect(evalFormula('1 + 2')).toBe(3);
    expect(evalFormula('1 + {fldNumber}', fieldContext, record)).toBe(1);
    expect(evalFormula('1 + {fldMultipleNumber}', fieldContext, record)).toBe(2);
  });

  it('unary operator', () => {
    const record: IRecord = {
      id: 'recTest',
      fields: {
        fldNumber: 3,
        fldMultipleNumber: [1],
        fldMultipleLink: [{ id: 'recxxxxxxx' }, { id: 'recyyyyyyy', title: 'A2' }],
      },
      createdTime: new Date().toISOString(),
    };

    expect(evalFormula('-1')).toBe(-1);
    expect(evalFormula('-(1)')).toBe(-1);
    expect(evalFormula('-{fldNumber}', fieldContext, record)).toBe(-3);
    expect(evalFormula('-{fldMultipleNumber}', fieldContext, record)).toBe(-1);
    expect(evalFormula('-{fldMultipleLink}', fieldContext, record)).toBe(null);
  });

  it('subtraction', () => {
    expect(evalFormula('5 - 3')).toBe(2);
    expect(evalFormula('5-3')).toBe(2);
  });

  it('multiplication', () => {
    expect(evalFormula('3 * 4')).toBe(12);
  });

  it('division', () => {
    expect(evalFormula('12 / 4')).toBe(3);
    expect(evalFormula('12 / 0')).toBe(null);
  });

  it('mode', () => {
    expect(evalFormula('8 % 3')).toBe(2);
    expect(evalFormula('12 % 0')).toBe(null);
  });

  it('concat', () => {
    expect(evalFormula('"x" & "Y"')).toBe('xY');
  });

  it('and', () => {
    expect(evalFormula('true && true')).toBe(true);
    expect(evalFormula('false && true')).toBe(false);
  });

  it('or', () => {
    expect(evalFormula('true || false')).toBe(true);
    expect(evalFormula('false && false')).toBe(false);
  });

  it('comparison', () => {
    expect(evalFormula('1 < 2')).toBe(true);
    expect(evalFormula('1 > 2')).toBe(false);
    expect(evalFormula('2 <= 2')).toBe(true);
    expect(evalFormula('2 >= 2')).toBe(true);
    expect(evalFormula('1 = 1')).toBe(true);
    expect(evalFormula('1 != 2')).toBe(true);
  });

  it('parentheses', () => {
    expect(evalFormula('(3 + 5) * 2')).toBe(16);
  });

  it('whitespace and comments', () => {
    expect(evalFormula(' 1 + 2 // inline comment')).toBe(3);
    expect(evalFormula('/* block comment */1 + 2')).toBe(3);
  });

  it('field reference', () => {
    expect(evalFormula('{fldNumber}', fieldContext, record)).toBe(8);
    expect(evalFormula('{fldNumber} + 1', fieldContext, record)).toBe(9);
  });

  it('function call', () => {
    expect(evalFormula('sum({fldNumber}, 1, 2, 3)', fieldContext, record)).toBe(14);
  });

  it('rollup call', () => {
    const virtualField = {
      id: 'values',
      type: FieldType.Formula,
      name: 'values',
      description: 'A test text field',
      notNull: true,
      unique: true,
      columnMeta: {
        index: 0,
        columnIndex: 0,
      },
      dbFieldType: DbFieldType.Text,
      cellValueType: CellValueType.String,
      isComputed: false,
      isMultipleCellValue: true,
    };

    const result = evaluate(
      'text_all({values})',
      { values: plainToInstance(FormulaFieldCore, virtualField) },
      { ...record, fields: { ...record.fields, values: ['CX, C2', 'C3'] } }
    );
    expect(result.toPlain()).toEqual(['CX, C2', 'C3']);
  });

  it('should throw exception', () => {
    expect(() => evalFormula('{}', fieldContext, record)).toThrowError();
  });

  it('should calculate date field when value type is Date', () => {
    expect(evalFormula('{fldDate}', fieldContext, record)).toEqual('2024-01-01');
  });

  it('should calculate multiple number field', () => {
    expect(evalFormula('{fldMultipleNumber}', fieldContext, record)).toEqual([1, 2, 3]);
  });

  it('should calculate multiple link field', () => {
    expect(evalFormula('{fldMultipleLink} & "x"', fieldContext, record)).toEqual(',A2x');
  });

  it('should return null when the value is false', () => {
    const result = evaluate('1 > 2', {});
    expect(result.toPlain()).toEqual(null);
  });

  it('should calculate string with escape characters', () => {
    expect(evalFormula("'Hello\nWorld'")).toBe(`Hello\nWorld`);
    expect(evalFormula("'Hello\rWorld'")).toBe(`Hello\rWorld`);
    expect(evalFormula("'Hello\bWorld'")).toBe(`Hello\bWorld`);
    expect(evalFormula("'Hello\fWorld'")).toBe(`Hello\fWorld`);
    expect(evalFormula("'Hello\vWorld'")).toBe(`Hello\vWorld`);
    expect(evalFormula("'Hello\tWorld'")).toBe('Hello\tWorld');
    expect(evalFormula("'Hello\\World'")).toBe('Hello\\World');
    expect(evalFormula("'Hello\"World'")).toBe('Hello"World');
  });
});
