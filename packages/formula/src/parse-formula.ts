import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { Formula } from './parser/Formula';
import type { ExprContext } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';

/**
 * Parse a formula expression string into an AST
 * @param expression The formula expression to parse
 * @returns The parsed AST root context
 */
export function parseFormula(expression: string): ExprContext {
  const inputStream = CharStreams.fromString(expression);
  const lexer = new FormulaLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new Formula(tokenStream);

  return parser.root();
}

/**
 * Parse a formula expression and convert it to SQL using the provided visitor
 * @param expression The formula expression to parse
 * @param visitor The SQL conversion visitor to use
 * @returns The generated SQL string
 */
export function parseFormulaToSQL<T>(
  expression: string,
  visitor: { visit(tree: ExprContext): T }
): T {
  const tree = parseFormula(expression);
  return visitor.visit(tree);
}
