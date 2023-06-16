/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import type { FieldCore, IRecord } from '../models';
import { FieldType, DbFieldType, CellValueType, NumberFieldCore } from '../models';
import { evaluate } from './evaluate';

describe('EvalVisitor', () => {
  let fieldContext: { [fieldId: string]: FieldCore } = {};
  const record: IRecord = {
    id: 'recTest',
    fields: {
      fldTest: 8,
    },
    createdTime: new Date().toISOString(),
    recordOrder: { viwTest: 1 },
  };

  beforeAll(() => {
    const fieldJson = {
      id: 'fldTest',
      name: 'f1',
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
      cellValueType: CellValueType.Number,
      isComputed: false,
    };

    const field = plainToInstance(NumberFieldCore, fieldJson);
    fieldContext = {
      [field.id]: field,
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
    expect(evalFormula('1 + 2')).toBe(3);
  });

  it('subtraction', () => {
    expect(evalFormula('5 - 3')).toBe(2);
  });

  it('multiplication', () => {
    expect(evalFormula('3 * 4')).toBe(12);
  });

  it('division', () => {
    expect(evalFormula('12 / 4')).toBe(3);
  });

  it('mode', () => {
    expect(evalFormula('8 % 3')).toBe(2);
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
    expect(evalFormula('1 == 1')).toBe(true);
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
    expect(evalFormula('{fldTest}', fieldContext, record)).toBe(8);
    expect(evalFormula('{fldTest} + 1', fieldContext, record)).toBe(9);
  });

  it('function call', () => {
    expect(evalFormula('sum({fldTest}, 1, 2, 3)', fieldContext, record)).toBe(14);
  });
});
