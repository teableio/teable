import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import type { FieldReferenceCurlyContext } from './parser/Formula';

/**
 * Interface for field expansion mapping
 */
export interface IFieldExpansionMap {
  [fieldId: string]: string;
}

/**
 * A visitor that expands formula field references by replacing them with their expanded expressions.
 *
 * This visitor traverses the parsed formula AST and replaces field references ({fieldId}) with
 * their corresponding expanded expressions. It's designed to handle formula expansion for
 * avoiding PostgreSQL generated column limitations.
 *
 * @example
 * ```typescript
 * // Given expansion map: { 'field2': '({field1} + 10)' }
 * // Input formula: '{field2} * 2'
 * // Output: '({field1} + 10) * 2'
 *
 * const expansionMap = { 'field2': '({field1} + 10)' };
 * const visitor = new FormulaExpansionVisitor(expansionMap);
 * visitor.visit(parsedTree);
 * const result = visitor.getResult(); // '({field1} + 10) * 2'
 * ```
 */
export class FormulaExpansionVisitor extends AbstractParseTreeVisitor<void> {
  private result = '';
  private readonly expansionMap: IFieldExpansionMap;

  constructor(expansionMap: IFieldExpansionMap) {
    super();
    this.expansionMap = expansionMap;
  }

  defaultResult() {
    return undefined;
  }

  /**
   * Handles field reference nodes in the AST
   * @param ctx The field reference context from ANTLR
   */
  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext) {
    const originalText = ctx.text;

    // Extract field ID from {fieldId} format
    // The ANTLR grammar defines IDENTIFIER_VARIABLE as '{' .*? '}'
    let fieldId = originalText;
    if (originalText.startsWith('{') && originalText.endsWith('}')) {
      fieldId = originalText.slice(1, -1);
    }

    // Check if we have an expansion for this field
    const expansion = this.expansionMap[fieldId];
    if (expansion !== undefined) {
      // Use the expanded expression
      this.result += expansion;
    } else {
      // Keep the original field reference if no expansion is available
      this.result += originalText;
    }
  }

  /**
   * Handles terminal nodes (tokens) in the AST
   * @param node The terminal node
   */
  visitTerminal(node: TerminalNode) {
    const text = node.text;
    if (text === '<EOF>') {
      return;
    }
    this.result += text;
  }

  /**
   * Gets the final expanded formula result
   * @returns The formula with field references expanded
   */
  getResult(): string {
    return this.result;
  }

  /**
   * Resets the visitor state for reuse
   */
  reset(): void {
    this.result = '';
  }
}
