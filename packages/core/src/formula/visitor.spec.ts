/* eslint-disable @typescript-eslint/no-explicit-any */
import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';
import { plainToInstance } from 'class-transformer';
import type { IRecord } from '../models';
import { FieldType, DbFieldType, CellValueType, NumberFieldCore } from '../models';
import { Formula } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';
import { EvalVisitor } from './visitor';

describe('EvalVisitor', () => {
  let fieldContext = {};
  const record: IRecord = {
    id: 'recTest',
    fields: {
      fldTest: 8,
    },
    createdTime: Date.now(),
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
      calculatedType: FieldType.Number,
      cellValueType: CellValueType.Number,
      isComputed: false,
    };

    const field = plainToInstance(NumberFieldCore, fieldJson);
    fieldContext = {
      [field.id]: field,
    };
  });

  const evalFormula = (input: string, context?: any, record?: IRecord) => {
    const inputStream = new ANTLRInputStream(input);
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);
    const tree = parser.root();
    const visitor = new EvalVisitor(context, record);
    return visitor.visit(tree);
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

  it.only('field reference', () => {
    expect(evalFormula('field("fldTest")', fieldContext, record)?.value).toBe(8);
    expect(evalFormula('field("fldTest") + 1', fieldContext, record)?.value).toBe(9);
  });

  // Add tests for field references, lookup field references, and function calls
  // based on your specific data model and available functions.
});
