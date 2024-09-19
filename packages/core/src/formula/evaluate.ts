import { CharStreams, CommonTokenStream } from 'antlr4ts';
import type { FieldCore } from '../models/field/field';
import type { IRecord } from '../models/record';
import { FormulaErrorListener } from './error.listener';
import { Formula } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';
import type { TypedValue } from './typed-value';
import { EvalVisitor } from './visitor';

export const evaluate = (
  input: string,
  dependFieldMap: { [fieldId: string]: FieldCore },
  record?: IRecord,
  timeZone?: string
): TypedValue => {
  const inputStream = CharStreams.fromString(input);
  const lexer = new FormulaLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new Formula(tokenStream);
  parser.removeErrorListeners();
  const errorListener = new FormulaErrorListener();
  parser.addErrorListener(errorListener);
  const tree = parser.root();
  const visitor = new EvalVisitor(dependFieldMap, record, timeZone);
  return visitor.visit(tree);
};
