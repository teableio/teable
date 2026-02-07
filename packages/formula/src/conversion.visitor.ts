import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor.js';
import type { TerminalNode } from 'antlr4ts/tree/TerminalNode.js';
import { extractFieldReferenceId } from './field-reference.util';
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
    const idOrName = extractFieldReferenceId(ctx);
    const normalized = idOrName ?? '';
    const nameOrId = this.conversionMap[normalized] || '#Error';
    if (this.conversionMap[normalized] == null) {
      const errorTxt = `Invalid field name or function name: "${normalized}"`;
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
