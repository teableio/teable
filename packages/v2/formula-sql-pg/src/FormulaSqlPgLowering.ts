import { FunctionName } from '@teable/v2-core';

import { buildFieldSqlMetadata } from './FieldSqlCoercionVisitor';
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
  readonly bindings = new FormulaSqlPgBindings();
  private readonly uses = new Map<number, number>();
  private readonly lowered = new Map<number, SqlExpr>();
  private readonly functions: FormulaSqlPgFunctions;
  private readonly arrayFusion: FormulaSqlPgArrayFusion;

  constructor(translator: FormulaSqlPgTranslator) {
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
    const expression = this.lowerNode(node);
    const shared = (this.uses.get(node.id) ?? 0) > 1;
    const result = {
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
    this.lowered.set(node.id, result);
    return result;
  }

  private countUses(node: FormulaExpressionNode): void {
    const count = this.uses.get(node.id) ?? 0;
    this.uses.set(node.id, count + 1);
    if (count) return;
    switch (node.kind) {
      case 'leaf':
        return;
      case 'field':
        this.countUses(node.value);
        return;
      case 'unary':
        this.countUses(node.operand);
        return;
      case 'binary':
        this.countUses(node.left);
        this.countUses(node.right);
        return;
      case 'call':
        node.args.forEach((arg) => this.countUses(arg));
        return;
    }
  }

  private lowerArrayFusion(node: FormulaExpressionNode): SqlExpr | undefined {
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
      return this.arrayFusion.sumCompactTextSplit(
        this.lower(split.args[0]),
        this.lower(split.args[1])
      );
    }
    return undefined;
  }

  private lowerNode(node: FormulaExpressionNode): SqlExpr {
    switch (node.kind) {
      case 'leaf':
        return normalizeFormulaFieldExpression(node.expression);
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
              ? `(${expression.valueSql})::text`
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
        const fused = this.lowerArrayFusion(node);
        if (fused) return fused;
        const handler = this.functions.getHandlers()[node.name as FunctionName];
        if (!handler)
          return makeExpr(
            'NULL',
            'unknown',
            false,
            'TRUE',
            buildErrorLiteral('NOT_IMPL', node.name)
          );
        return handler(node.args.map((arg) => this.lower(arg)));
      }
    }
  }
}
