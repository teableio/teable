import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';
import type { FieldCore, IRecord } from '../models';
import { Formula } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';
import { EvalVisitor } from './visitor';

export const evaluate = (
  input: string,
  dependFieldMap: { [fieldId: string]: FieldCore },
  record?: IRecord
) => {
  const inputStream = new ANTLRInputStream(input);
  const lexer = new FormulaLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new Formula(tokenStream);
  const tree = parser.root();
  const visitor = new EvalVisitor(dependFieldMap, record);
  return visitor.visit(tree);
};
