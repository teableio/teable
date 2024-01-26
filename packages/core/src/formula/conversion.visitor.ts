import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import type { FieldReferenceCurlyContext } from './parser/Formula';

export class ConversionVisitor extends AbstractParseTreeVisitor<void> {
  private noThrow = false;
  private result = '';

  defaultResult() {
    return undefined;
  }

  constructor(private conversionMap: { [fieldName: string]: string }) {
    super();
    this.conversionMap = conversionMap;
  }

  safe() {
    this.noThrow = true;
    return this;
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext) {
    const originalText = ctx.text;
    let idOrName = originalText;

    if (originalText[0] === '{' && originalText[originalText.length - 1] === '}') {
      idOrName = idOrName.slice(1, -1);
    }
    const nameOrId = this.conversionMap[idOrName] || '#Error';
    if (this.conversionMap[idOrName] == null) {
      const errorTxt = `Invalid field name or function name: "${idOrName}"`;
      if (this.noThrow) {
        console.error(errorTxt);
      } else {
        throw new Error(errorTxt);
      }
    }
    this.result += `{${nameOrId}}`;
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
