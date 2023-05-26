import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import type { FieldReferenceCurlyContext } from './parser/Formula';

export class ConversionVisitor extends AbstractParseTreeVisitor<void> {
  private result = '';

  defaultResult() {
    return undefined;
  }

  constructor(private conversionMap: { [key: string]: string }) {
    super();
    this.conversionMap = conversionMap;
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext) {
    const originalText = ctx.text;
    const fieldId = originalText.slice(1, -1); // remove the curly braces
    const fieldName = this.conversionMap[fieldId] || fieldId;
    this.result += `{${fieldName}}`;
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
