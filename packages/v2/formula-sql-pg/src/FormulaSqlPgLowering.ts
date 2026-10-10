import { FunctionName } from '@teable/v2-core';

import { buildFieldSqlMetadata } from './FieldSqlCoercionVisitor';
import { FormulaCompileBudget } from './FormulaCompileBudget';
import type { FormulaExpressionNode } from './FormulaExpressionGraph';
import { FormulaSqlPgArrayFusion } from './FormulaSqlPgArrayFusion';
import { FormulaSqlPgBindings } from './FormulaSqlPgBindings';
import { normalizeFormulaFieldExpression } from './FormulaSqlPgFieldExpression';
import { FormulaSqlPgFunctions } from './FormulaSqlPgFunctions';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { buildErrorLiteral } from './PgSqlHelpers';
import { makeExpr, type SqlExpr } from './SqlExpression';

/** Lower each shared graph node once, retaining type metadata alongside SQL references. */
export class FormulaSqlPgLowering {
  readonly bindings: FormulaSqlPgBindings;
  private readonly uses = new Map<number, number>();
  private readonly lowered = new Map<number, SqlExpr>();
  private readonly functions: FormulaSqlPgFunctions;
  private readonly arrayFusion: FormulaSqlPgArrayFusion;

  constructor(
    translator: FormulaSqlPgTranslator,
    readonly budget = new FormulaCompileBudget()
  ) {
    this.bindings = new FormulaSqlPgBindings(budget);
    this.functions = new FormulaSqlPgFunctions(translator, this.bindings);
    this.arrayFusion = new FormulaSqlPgArrayFusion(translator, this.bindings);
  }

  lowerAll(nodes: ReadonlyArray<FormulaExpressionNode>): ReadonlyArray<SqlExpr> {
    nodes.forEach((node) => this.countUses(node));
    return nodes.map((node) => this.lower(node));
  }

  lower(node: FormulaExpressionNode): SqlExpr {
    if (!this.uses.size) this.countUses(node);
    const cached = this.lowered.get(node.id);
    if (cached) return cached;
    const pending: Array<{ node: FormulaExpressionNode; expanded: boolean }> = [
      { node, expanded: false },
    ];
    while (pending.length) {
      const entry = pending.pop()!;
      const current = entry.node;
      if (this.lowered.has(current.id)) continue;
      if (!entry.expanded) {
        pending.push({ node: current, expanded: true });
        this.scheduleInputs(current, pending);
        continue;
      }
      this.lowered.set(current.id, this.bindNode(current));
    }
    return this.lowered.get(node.id)!;
  }

  private scheduleInputs(
    node: FormulaExpressionNode,
    pending: Array<{ node: FormulaExpressionNode; expanded: boolean }>
  ): void {
    const fused = this.arrayFusionInputs(node);
    if (fused) {
      for (let index = fused.length - 1; index >= 0; index--)
        pending.push({ node: fused[index], expanded: false });
      return;
    }
    switch (node.kind) {
      case 'field':
        pending.push({ node: node.value, expanded: false });
        break;
      case 'unary':
        pending.push({ node: node.operand, expanded: false });
        break;
      case 'binary':
        pending.push({ node: node.right, expanded: false }, { node: node.left, expanded: false });
        break;
      case 'call':
        for (let index = node.args.length - 1; index >= 0; index--)
          pending.push({ node: node.args[index], expanded: false });
        break;
    }
  }

  private bindNode(node: FormulaExpressionNode): SqlExpr {
    const expression = this.lowerNode(node);
    const shared = (this.uses.get(node.id) ?? 0) > 1;
    return {
      ...expression,
      valueSql: this.bindings.reference(expression.valueSql, shared),
      displayValueSql: expression.displayValueSql
        ? this.bindings.reference(expression.displayValueSql, shared)
        : undefined,
      errorConditionSql: expression.errorConditionSql
        ? this.bindings.reference(expression.errorConditionSql, shared)
        : undefined,
      errorMessageSql: expression.errorMessageSql
        ? this.bindings.reference(expression.errorMessageSql, shared)
        : undefined,
    };
  }

  private countUses(node: FormulaExpressionNode): void {
    const pending = [node];
    while (pending.length) {
      const current = pending.pop()!;
      const count = this.uses.get(current.id) ?? 0;
      this.uses.set(current.id, count + 1);
      if (count) continue;
      if (current.kind === 'field') pending.push(current.value);
      else if (current.kind === 'unary') pending.push(current.operand);
      else if (current.kind === 'binary') pending.push(current.right, current.left);
      else if (current.kind === 'call') for (const arg of current.args) pending.push(arg);
    }
  }

  private arrayFusionInputs(
    node: FormulaExpressionNode
  ): ReadonlyArray<FormulaExpressionNode> | undefined {
    if (node.kind !== 'call') return undefined;
    // Fuse only single-consumer intermediate arrays. Shared producers keep
    // their existing DAG binding instead of being recomputed by each sink.
    const compact = node.args[0];
    const split = compact?.kind === 'call' ? compact.args[0] : undefined;
    if (
      node.name === FunctionName.Sum &&
      node.args.length === 1 &&
      compact?.kind === 'call' &&
      compact.name === FunctionName.ArrayCompact &&
      compact.args.length === 1 &&
      (this.uses.get(compact.id) ?? 0) === 1 &&
      split?.kind === 'call' &&
      split.name === FunctionName.TextSplit &&
      split.args.length === 2 &&
      (this.uses.get(split.id) ?? 0) === 1
    ) {
      return split.args;
    }
    return undefined;
  }

  private lowerNode(node: FormulaExpressionNode): SqlExpr {
    switch (node.kind) {
      case 'leaf':
        return normalizeFormulaFieldExpression(node.expression, this.budget);
      case 'field': {
        const expression = this.lower(node.value);
        const metadataResult = buildFieldSqlMetadata(node.field);
        if (metadataResult.isErr()) return { ...expression, field: node.field };
        const metadata = metadataResult.value;
        return {
          ...expression,
          // Formula inference may declare text for a mixed blank/number IF,
          // while SQL branch coercion produces a numeric value. Match the
          // declared scalar representation before a parent combines branches;
          // otherwise PostgreSQL tries to parse its '' arm as a number.
          valueSql:
            metadata.valueType === 'string' &&
            !metadata.isArray &&
            expression.valueType !== 'string' &&
            expression.storageKind !== 'json'
              ? this.budget.sql`(${expression.valueSql})::text`
              : expression.valueSql,
          field: node.field,
          valueType: metadata.valueType,
          isArray: metadata.isArray,
          // Computed arrays already have a physical representation, regardless
          // of the field's eventual database storage metadata.
          storageKind: expression.storageKind ?? metadata.storageKind,
        };
      }
      case 'unary':
        return this.functions.applyUnaryOp(node.operator, this.lower(node.operand));
      case 'binary':
        return this.functions.applyBinaryOp(
          node.operator,
          this.lower(node.left),
          this.lower(node.right)
        );
      case 'call': {
        const fused = this.arrayFusionInputs(node);
        if (fused)
          return this.arrayFusion.sumCompactTextSplit(this.lower(fused[0]), this.lower(fused[1]));
        const handler = this.functions.getHandlers()[node.name as FunctionName];
        if (!handler)
          return makeExpr(
            'NULL',
            'unknown',
            false,
            'TRUE',
            buildErrorLiteral('NOT_IMPL', node.name, this.budget)
          );
        return handler(node.args.map((arg) => this.lower(arg)));
      }
    }
  }
}
