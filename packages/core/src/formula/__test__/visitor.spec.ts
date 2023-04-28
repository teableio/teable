import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';
import { Formula } from '../parser/Formula';
import { FormulaLexer } from '../parser/FormulaLexer';
import { EvalVisitor } from '../visitor';

describe('EvalVisitor', () => {
  const evalFormula = (input: string) => {
    const inputStream = new ANTLRInputStream(input);
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);
    const tree = parser.root();
    const visitor = new EvalVisitor();
    return visitor.visit(tree);
  };

  test('integer literal', () => {
    expect(evalFormula('42')).toBe(42);
  });

  test('decimal literal', () => {
    expect(evalFormula('3.14')).toBeCloseTo(3.14);
  });

  test('single quoted string literal', () => {
    expect(evalFormula("'hello world'")).toBe('hello world');
  });

  test('double quoted string literal', () => {
    expect(evalFormula('"hello world"')).toBe('hello world');
  });

  test('boolean literal true', () => {
    expect(evalFormula('TRUE')).toBe(true);
  });

  test('boolean literal false', () => {
    expect(evalFormula('FALSE')).toBe(false);
  });

  test('addition', () => {
    expect(evalFormula('1 + 2')).toBe(3);
  });

  test('subtraction', () => {
    expect(evalFormula('5 - 3')).toBe(2);
  });

  test('multiplication', () => {
    expect(evalFormula('3 * 4')).toBe(12);
  });

  test('division', () => {
    expect(evalFormula('12 / 4')).toBe(3);
  });

  test('comparison', () => {
    expect(evalFormula('1 < 2')).toBe(true);
    expect(evalFormula('1 > 2')).toBe(false);
    expect(evalFormula('2 <= 2')).toBe(true);
    expect(evalFormula('2 >= 2')).toBe(true);
    expect(evalFormula('1 == 1')).toBe(true);
    expect(evalFormula('1 != 2')).toBe(true);
  });

  test('parentheses', () => {
    expect(evalFormula('(3 + 5) * 2')).toBe(16);
  });

  test('whitespace and comments', () => {
    expect(evalFormula(' 1 + 2 // inline comment')).toBe(3);
    expect(evalFormula('/* block comment */1 + 2')).toBe(3);
  });

  // Add tests for field references, lookup field references, and function calls
  // based on your specific data model and available functions.
});
