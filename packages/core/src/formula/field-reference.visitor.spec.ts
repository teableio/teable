/* eslint-disable @typescript-eslint/no-explicit-any */
import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { FieldReferenceVisitor } from './field-reference.visitor';
import { Formula } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';

describe('FieldReferenceVisitor', () => {
  it('should collect field reference', () => {
    const inputStream = CharStreams.fromString('concat({fld123} + 1, {fld456}) /**/');
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);

    const tree = parser.root(); // parsing rule entry point

    const visitor = new FieldReferenceVisitor();

    // Use the custom Visitor to traverse the AST and replace field references
    const fieldIds = visitor.visit(tree);

    // Get the replaced code string
    expect(fieldIds).toEqual(['fld123', 'fld456']);
  });
});
