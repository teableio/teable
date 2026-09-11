import type { Field } from '@teable/v2-core';

import type { SqlExpr } from './SqlExpression';

export type FormulaExpressionNode = {
  readonly id: number;
} & (
  | { readonly kind: 'leaf'; readonly expression: SqlExpr }
  | { readonly kind: 'field'; readonly field: Field; readonly value: FormulaExpressionNode }
  | { readonly kind: 'unary'; readonly operator: 'minus'; readonly operand: FormulaExpressionNode }
  | {
      readonly kind: 'binary';
      readonly operator: string;
      readonly left: FormulaExpressionNode;
      readonly right: FormulaExpressionNode;
    }
  | {
      readonly kind: 'call';
      readonly name: string;
      readonly args: ReadonlyArray<FormulaExpressionNode>;
    }
);

type NodeInput = FormulaExpressionNode extends infer N
  ? N extends FormulaExpressionNode
    ? Omit<N, 'id'>
    : never
  : never;

/** A compilation owns one graph, including recursively referenced formula fields. */
export class FormulaExpressionGraph {
  private readonly nodes = new Map<string, FormulaExpressionNode>();
  readonly fields = new Map<string, FormulaExpressionNode>();
  readonly visitingFields = new Set<string>();

  intern(node: NodeInput): FormulaExpressionNode {
    const key = this.key(node);
    const existing = this.nodes.get(key);
    if (existing) return existing;
    const result: FormulaExpressionNode = { ...node, id: this.nodes.size };
    this.nodes.set(key, result);
    return result;
  }

  private key(node: NodeInput): string {
    switch (node.kind) {
      case 'leaf':
        return JSON.stringify([
          'leaf',
          node.expression.valueSql,
          node.expression.valueType,
          node.expression.isArray,
          node.expression.storageKind,
          node.expression.errorConditionSql,
          node.expression.errorMessageSql,
          node.expression.displayValueSql,
          node.expression.field?.id().toString(),
        ]);
      case 'field':
        return JSON.stringify(['field', node.field.id().toString(), node.value.id]);
      case 'unary':
        return JSON.stringify(['unary', node.operator, node.operand.id]);
      case 'binary':
        return JSON.stringify(['binary', node.operator, node.left.id, node.right.id]);
      case 'call':
        // The supported formula functions are deterministic or statement-stable
        // (NOW/TODAY). A future volatile function must opt out of interning here.
        return JSON.stringify(['call', node.name, node.args.map((arg) => arg.id)]);
    }
  }
}
