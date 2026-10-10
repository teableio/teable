import type { Field } from '@teable/v2-core';

import { FormulaCompileBudget } from './FormulaCompileBudget';
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
  readonly referenceDepths = new Map<string, number>();
  readonly nodeReferenceDepths = new Map<number, number>();
  constructor(readonly budget = new FormulaCompileBudget()) {}

  intern(node: NodeInput): FormulaExpressionNode {
    const key = this.key(node);
    const existing = this.nodes.get(key);
    if (existing) return existing;
    this.budget.check('uniqueNodes', this.nodes.size + 1);
    const result: FormulaExpressionNode = { ...node, id: this.nodes.size };
    let referenceDepth = 0;
    if (node.kind === 'field')
      referenceDepth = 1 + (this.nodeReferenceDepths.get(node.value.id) ?? 0);
    else if (node.kind === 'unary')
      referenceDepth = this.nodeReferenceDepths.get(node.operand.id) ?? 0;
    else if (node.kind === 'binary')
      referenceDepth = Math.max(
        this.nodeReferenceDepths.get(node.left.id) ?? 0,
        this.nodeReferenceDepths.get(node.right.id) ?? 0
      );
    else if (node.kind === 'call')
      for (const arg of node.args)
        referenceDepth = Math.max(referenceDepth, this.nodeReferenceDepths.get(arg.id) ?? 0);
    this.nodeReferenceDepths.set(result.id, referenceDepth);
    this.nodes.set(key, result);
    return result;
  }

  private key(node: NodeInput): string {
    switch (node.kind) {
      case 'leaf':
        return this.budget.json([
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
        return this.budget.json(['field', node.field.id().toString(), node.value.id]);
      case 'unary':
        return this.budget.json(['unary', node.operator, node.operand.id]);
      case 'binary':
        return this.budget.json(['binary', node.operator, node.left.id, node.right.id]);
      case 'call':
        // The supported formula functions are deterministic or statement-stable
        // (NOW/TODAY). A future volatile function must opt out of interning here.
        return this.budget.json(['call', node.name, node.args.map((arg) => arg.id)]);
    }
  }
}
