/* eslint-disable @typescript-eslint/no-explicit-any */
import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { ConversionVisitor } from './conversion.visitor';
import { Formula } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';

describe('ConversionVisitor', () => {
  it('should convert id to name', () => {
    const inputStream = CharStreams.fromString('concat({fld123} + 1, {fld456}) /**/');
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);

    const tree = parser.root(); // parsing rule entry point

    // Initialize the custom Visitor with the mapping object
    const idToName = {
      fld123: 'textField',
      fld456: 'linkField',
      // more mappings
    };

    const visitor = new ConversionVisitor(idToName);

    // Use the custom Visitor to traverse the AST and replace field references
    visitor.visit(tree);

    // Get the replaced code string
    const replacedCode = visitor.getResult();
    expect(replacedCode).toBe('concat({textField} + 1, {linkField}) /**/');
  });
});
