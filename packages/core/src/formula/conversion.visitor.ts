import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import type { FieldReferenceCurlyContext } from './parser/Formula';

export class ConversionVisitor extends AbstractParseTreeVisitor<void> {
  private result = '';

  defaultResult() {
    return undefined;
  }

  constructor(private conversionMap: { [fieldName: string]: string }) {
    super();
    this.conversionMap = conversionMap;
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext) {
    const originalText = ctx.text;
    let fieldName = originalText;

    if (originalText[0] === '{' && originalText[originalText.length - 1] === '}') {
      fieldName = fieldName.slice(1, -1);
    }
    const fieldId = this.conversionMap[fieldName];
    if (fieldId == null) {
      throw new Error(`Invalid field name or function name: "${fieldName}"`);
    }
    this.result += `{${fieldId}}`;
  }

  visitTerminal(node: TerminalNode) {
    const text = node.text;
    if (text === '<EOF>') {
      return;
    }
    this.result += text;
  }

  getResult() {
    return this.result;
  }
}
