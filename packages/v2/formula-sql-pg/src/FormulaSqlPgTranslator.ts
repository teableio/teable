import {
  FunctionCallCollectorVisitor,
  inspectFormulaStructure,
  inspectFormulaAst,
  type RootContext,
} from '@teable/formula';
import {
  domainError,
  type DomainError,
  FieldType,
  type Field,
  type FormulaField,
  type LookupField,
  type Table,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { buildFieldSqlMetadata } from './FieldSqlCoercionVisitor';
import {
  assertFormulaCompileBudgetOptions,
  FormulaCompileBudget,
  type FormulaCompileBudgetOptions,
} from './FormulaCompileBudget';
import { FormulaExpressionGraph, type FormulaExpressionNode } from './FormulaExpressionGraph';
import { formulaParseCache } from './FormulaParseCache';
import type { FormulaSqlPgBindings } from './FormulaSqlPgBindings';
import { FormulaSqlPgLowering } from './FormulaSqlPgLowering';
import { FormulaSqlPgVisitor } from './FormulaSqlPgVisitor';
import { buildErrorLiteral } from './PgSqlHelpers';
import type { IPgTypeValidationStrategy } from './PgTypeValidationStrategy';
import { makeExpr, type SqlExpr, type SqlStorageKind } from './SqlExpression';

export type FieldSqlResolver = (field: Field) => Result<SqlExpr, DomainError>;

/**
 * Prefer the storage kind produced by resolveFieldSql when it already coerced a
 * JSON snapshot field (createdBy / lastModifiedBy) into a string scalar title.
 * Overwriting with metadata.storageKind 'json' causes downstream `::jsonb` casts
 * on title text and fails with "invalid input syntax for type json".
 */
const resolveFieldStorageKind = (
  expr: SqlExpr,
  metadataStorageKind: SqlStorageKind | undefined
): SqlStorageKind | undefined => {
  if (expr.storageKind === 'scalar' && expr.valueType === 'string' && !expr.isArray) {
    return 'scalar';
  }
  return metadataStorageKind ?? expr.storageKind;
};

export type FormulaSqlPgTranslatorOptions = {
  table: Table;
  compileBudget?: FormulaCompileBudgetOptions;
  /** Share only within one host statement (for example, a multi-level CTE batch). */
  budget?: FormulaCompileBudget;
  tableAlias: string;
  resolveFieldSql: FieldSqlResolver;
  timeZone?: string;
  allowFieldNameFallback?: boolean;
  /**
   * When true, formula field references are resolved via resolveFieldSql instead
   * of recursively translating the formula expression.
   *
   * Use case: CTE batch updates where formula fields at earlier levels are already
   * computed and stored in CTE columns. The formula reference should point to the
   * CTE column (e.g., level_0.col_formula_a) instead of re-computing the expression.
   *
   * Default: false (recursively expand formula expressions)
   */
  skipFormulaExpansion?: boolean;
  /**
   * PostgreSQL version type validation strategy.
   * Required parameter - must be injected from the DI container.
   *
   * - PG 16+: Use Pg16TypeValidationStrategy (uses native pg_input_is_valid)
   * - PG < 16: Use PgLegacyTypeValidationStrategy (uses polyfill function)
   */
  typeValidationStrategy: IPgTypeValidationStrategy;
};

export class FormulaSqlPgTranslator {
  readonly tableAlias: string;
  readonly typeValidationStrategy: IPgTypeValidationStrategy;
  readonly timeZone: string;
  private readonly fieldById: Map<string, Field>;
  private readonly fieldByName: Map<string, Field>;
  private readonly resolveFieldSql: FieldSqlResolver;
  private readonly allowNameFallback: boolean;
  private readonly skipFormulaExpansion: boolean;
  private readonly compileBudgetOptions: FormulaCompileBudgetOptions | undefined;
  private readonly budget?: FormulaCompileBudget;

  constructor(options: FormulaSqlPgTranslatorOptions) {
    if (options.compileBudget) assertFormulaCompileBudgetOptions(options.compileBudget);
    if (
      options.budget &&
      options.compileBudget &&
      (options.budget.options.mode !== options.compileBudget.mode ||
        options.budget.options.policyVersion !== options.compileBudget.policyVersion ||
        options.budget.options.policy !== options.compileBudget.policy)
    )
      throw new Error('Formula compilation meter does not match configured policy');
    this.budget = options.budget;
    const compileBudget = options.compileBudget ?? options.budget?.options;
    this.compileBudgetOptions = compileBudget ? Object.freeze({ ...compileBudget }) : undefined;
    this.tableAlias = options.tableAlias;
    this.resolveFieldSql = options.resolveFieldSql;
    this.allowNameFallback = options.allowFieldNameFallback ?? true;
    this.skipFormulaExpansion = options.skipFormulaExpansion ?? false;
    this.typeValidationStrategy = options.typeValidationStrategy;
    this.timeZone = options.timeZone ?? 'utc';
    const fields = options.table.getFields();
    this.fieldById = new Map(fields.map((field) => [field.id().toString(), field]));
    this.fieldByName = new Map(
      fields.map((field) => [field.name().toString().trim().toLowerCase(), field])
    );
  }

  private readonly compiled = new WeakMap<
    SqlExpr,
    { expression: SqlExpr; bindings: FormulaSqlPgBindings; renderedSql?: string }
  >();

  translateExpression(expression: string): Result<SqlExpr, DomainError> {
    return this.translateExpressions([expression]).map((expressions) => expressions[0]);
  }
  /** Metrics from the original compilation and explicit renders, without recompiling. */
  getCompileBudgetMetrics(expression: SqlExpr) {
    return this.compiled.get(expression)?.bindings.budget.snapshot();
  }

  /** Compile independent outputs together to share their common subexpressions. */
  translateExpressions(
    expressions: ReadonlyArray<string>
  ): Result<ReadonlyArray<SqlExpr>, DomainError> {
    const budget = this.budget ?? new FormulaCompileBudget(this.compileBudgetOptions);
    return budget
      .boundary(() => {
        const graph = new FormulaExpressionGraph(budget);
        const nodes: FormulaExpressionNode[] = [];
        for (const expression of expressions) {
          const parsed = this.parseExpression(expression, budget);
          if (parsed.isErr()) return err(parsed.error);
          nodes.push(parsed.value.accept(new FormulaSqlPgVisitor(this, graph)));
        }
        const lowering = new FormulaSqlPgLowering(this, budget);
        const bindings = lowering.bindings;
        return ok(
          lowering.lowerAll(nodes).map((raw) => {
            const render = (sql: string | undefined) =>
              sql === undefined ? undefined : bindings.render(sql);
            const result: SqlExpr = {
              ...raw,
              valueSql: bindings.render(raw.valueSql),
              displayValueSql: render(raw.displayValueSql),
              errorConditionSql: render(raw.errorConditionSql),
              errorMessageSql: render(raw.errorMessageSql),
            };
            this.compiled.set(result, { expression: raw, bindings });
            return result;
          })
        );
      })
      .andThen((result) => result);
  }

  buildExpressionGraph(expression: string): Result<FormulaExpressionNode, DomainError> {
    const budget = this.budget ?? new FormulaCompileBudget(this.compileBudgetOptions);
    return budget
      .boundary(() => {
        const graph = new FormulaExpressionGraph(budget);
        return this.parseExpression(expression, budget).map((tree) =>
          tree.accept(new FormulaSqlPgVisitor(this, graph))
        );
      })
      .andThen((result) => result);
  }

  resolveFieldNode(
    fieldIdOrName: string,
    graph: FormulaExpressionGraph
  ): Result<FormulaExpressionNode, DomainError> {
    const field = this.findField(fieldIdOrName);
    if (!field) return err(domainError.notFound({ message: `Field not found: ${fieldIdOrName}` }));
    const id = field.id().toString();
    const cached = graph.fields.get(id);
    if (cached) {
      graph.budget.check(
        'referenceDepth',
        graph.visitingFields.size + (graph.referenceDepths.get(id) ?? 0)
      );
      return ok(cached);
    }
    if (graph.visitingFields.has(id))
      return err(domainError.invariant({ message: `Formula dependency cycle detected at ${id}` }));
    const formula = field.type().equals(FieldType.formula()) ? (field as FormulaField) : undefined;
    const parsed =
      formula && !this.skipFormulaExpansion
        ? this.parseExpression(formula.expression().toString(), graph.budget)
        : undefined;
    if (parsed?.isErr()) return err(parsed.error);
    const useStored =
      parsed?.isOk() &&
      parsed.value
        .accept(new FunctionCallCollectorVisitor())
        .some((call) => call.name === 'LAST_MODIFIED_TIME' && call.paramCount > 0);
    if (formula && parsed && !useStored) {
      graph.budget.check('referenceDepth', graph.visitingFields.size + 1);
      graph.visitingFields.add(id);
    }
    const result =
      formula && parsed && !useStored
        ? parsed.map((tree) =>
            graph.intern({
              kind: 'field',
              field,
              value: tree.accept(new FormulaSqlPgVisitor(this, graph)),
            })
          )
        : this.resolveField(field, false).map((expression) =>
            graph.intern({ kind: 'leaf', expression })
          );
    graph.visitingFields.delete(id);
    if (result.isOk()) {
      graph.fields.set(id, result.value);
      graph.referenceDepths.set(id, graph.nodeReferenceDepths.get(result.value.id) ?? 0);
    }
    return result;
  }

  /** Compose host casts/error guards before rendering, sharing one binding scope. */
  renderExpression(
    expr: SqlExpr,
    select: (expression: SqlExpr, budget: FormulaCompileBudget) => string
  ): Result<string, DomainError> {
    const compiled = this.compiled.get(expr);
    const budget =
      compiled?.bindings.budget ??
      this.budget ??
      new FormulaCompileBudget(this.compileBudgetOptions);
    return budget.boundary(() => {
      const sql = select(compiled?.expression ?? expr, budget);
      if (compiled) return compiled.bindings.render(sql);
      budget.check('sqlBytes', budget.bytes(sql));
      return sql;
    });
  }

  /** A one-row SELECT for a lateral projection of a jointly compiled program. */
  renderExpressions(
    expressions: ReadonlyArray<SqlExpr>,
    select: (raw: ReadonlyArray<SqlExpr>, budget: FormulaCompileBudget) => string
  ): Result<string, DomainError> {
    const compiled = expressions.map((expression) => this.compiled.get(expression));
    const bindings = compiled[0]?.bindings;
    const budget =
      bindings?.budget ?? this.budget ?? new FormulaCompileBudget(this.compileBudgetOptions);
    return budget.boundary(() => {
      if (!bindings || compiled.some((entry) => entry?.bindings !== bindings)) {
        const sql = select(expressions, budget);
        budget.check('sqlBytes', budget.bytes(sql) + 9);
        return budget.sql`(SELECT ${sql})`;
      }
      return bindings.render(
        select(
          compiled.map((entry) => entry!.expression),
          budget
        ),
        true
      );
    });
  }

  renderSql(expr: SqlExpr): Result<string, DomainError> {
    const compiled = this.compiled.get(expr);
    if (compiled?.renderedSql !== undefined) return ok(compiled.renderedSql);
    const rendered = this.renderExpression(expr, (value, budget) =>
      this.renderValueSql(value, budget)
    );
    if (compiled && rendered.isOk()) compiled.renderedSql = rendered.value;
    return rendered;
  }

  private renderValueSql(expr: SqlExpr, budget: FormulaCompileBudget): string {
    const renderedValueSql = expr.displayValueSql ?? expr.valueSql;
    if (!expr.errorConditionSql) return renderedValueSql;
    const errorMessage =
      expr.errorMessageSql ?? buildErrorLiteral('INTERNAL', 'unknown_error', budget);
    if (expr.displayValueSql) {
      return budget.sql`CASE WHEN ${expr.errorConditionSql} THEN ${errorMessage} ELSE ${renderedValueSql} END`;
    }
    if (expr.isArray) {
      return budget.sql`CASE WHEN ${expr.errorConditionSql} THEN jsonb_build_array(${errorMessage}) ELSE ${expr.valueSql} END`;
    }
    const valueSql =
      expr.valueType === 'string' ? expr.valueSql : budget.sql`(${expr.valueSql})::text`;
    return budget.sql`CASE WHEN ${expr.errorConditionSql} THEN ${errorMessage} ELSE ${valueSql} END`;
  }

  resolveFieldById(fieldIdOrName: string): Result<SqlExpr, DomainError> {
    const field = this.findField(fieldIdOrName);
    if (!field) return err(domainError.notFound({ message: `Field not found: ${fieldIdOrName}` }));
    return this.resolveField(field);
  }

  private findField(fieldIdOrName: string): Field | undefined {
    return (
      this.fieldById.get(fieldIdOrName) ??
      (this.allowNameFallback
        ? this.fieldByName.get(fieldIdOrName.trim().toLowerCase())
        : undefined)
    );
  }

  private resolveField(field: Field, expandFormula = true): Result<SqlExpr, DomainError> {
    if (field.type().equals(FieldType.formula()) && expandFormula) {
      // When skipFormulaExpansion is true, use resolveFieldSql for formula fields
      // instead of recursively translating. This is used for CTE batch updates
      // where the formula value is already computed in a previous CTE.
      if (this.skipFormulaExpansion) {
        return this.resolveFieldSql(field);
      }
      return this.translateExpression(`{${field.id().toString()}}`);
    }
    if (field.type().equals(FieldType.formula()) && this.skipFormulaExpansion)
      return this.resolveFieldSql(field);
    // For lookup fields, proxy to innerField's SQL generation logic
    if (field.type().equals(FieldType.lookup())) {
      return this.resolveLookupField(field as LookupField);
    }
    return this.resolveFieldSql(field).andThen((expr) =>
      buildFieldSqlMetadata(field)
        .map((metadata) =>
          makeExpr(
            expr.valueSql,
            // Prefer the resolved expression type when resolveFieldSql already coerced
            // JSON snapshots (createdBy/lastModifiedBy titles) into string scalars.
            field.type().equals(FieldType.formula())
              ? metadata.valueType
              : expr.valueType === 'string' && !expr.isArray
                ? 'string'
                : metadata.valueType,
            metadata.isArray,
            expr.errorConditionSql,
            expr.errorMessageSql,
            field,
            field.type().equals(FieldType.formula())
              ? metadata.storageKind
              : resolveFieldStorageKind(expr, metadata.storageKind)
          )
        )
        .orElse(() =>
          ok(
            makeExpr(
              expr.valueSql,
              expr.valueType ?? 'unknown',
              expr.isArray ?? false,
              expr.errorConditionSql,
              expr.errorMessageSql,
              field,
              expr.storageKind
            )
          )
        )
    );
  }

  /**
   * Resolve lookup field by proxying to its innerField's SQL generation logic.
   * This creates a proxy expression that:
   * 1. Keeps the lookup field's raw SQL (JSON array column)
   * 2. Uses innerField's type metadata so subsequent type coercion can use innerField's logic
   * 3. The extraction from JSON array is handled by extractArrayScalarText, which will
   *    detect this is a lookup field and use innerField's type-specific extraction
   */
  private resolveLookupField(lookupField: LookupField): Result<SqlExpr, DomainError> {
    // Get the innerField
    const innerFieldResult = lookupField.innerField();
    if (innerFieldResult.isErr()) {
      // If innerField is not resolved, fall back to generic lookup handling
      return this.resolveFieldSql(lookupField).andThen((expr) =>
        buildFieldSqlMetadata(lookupField)
          .map((metadata) =>
            makeExpr(
              expr.valueSql,
              metadata.valueType,
              metadata.isArray,
              expr.errorConditionSql,
              expr.errorMessageSql,
              lookupField,
              metadata.storageKind
            )
          )
          .orElse(() =>
            ok(
              makeExpr(
                expr.valueSql,
                expr.valueType ?? 'unknown',
                expr.isArray ?? false,
                expr.errorConditionSql,
                expr.errorMessageSql,
                lookupField,
                expr.storageKind
              )
            )
          )
      );
    }

    const innerField = innerFieldResult.value;

    // Get the lookup field's raw SQL (the JSON array column)
    const lookupSqlResult = this.resolveFieldSql(lookupField);
    if (lookupSqlResult.isErr()) {
      return lookupSqlResult;
    }
    const lookupSql = lookupSqlResult.value;

    // Get innerField's metadata to proxy its type information
    const innerFieldMetadata = buildFieldSqlMetadata(innerField);

    const isMultiple = lookupField
      .isMultipleCellValue()
      .map((multiplicity) => multiplicity.isMultiple())
      .unwrapOr(true);

    // Create a proxy expression that:
    // 1. Uses lookup field's raw SQL column.
    // 2. Uses innerField's type metadata so type coercion follows the looked-up value.
    // 3. Only marks true multi-value lookups as arrays. Scalar lookups are stored as scalar
    //    DB columns in v1-compatible bases and must not go through JSON array normalization.
    return innerFieldMetadata
      .map((metadata) =>
        makeExpr(
          lookupSql.valueSql,
          metadata.valueType,
          isMultiple,
          lookupSql.errorConditionSql,
          lookupSql.errorMessageSql,
          lookupField, // Keep reference to lookup field for context
          isMultiple
            ? 'array'
            : innerField.type().equals(FieldType.link()) &&
                lookupField
                  .dbFieldType()
                  .andThen((dbFieldType) => dbFieldType.value())
                  .map((raw) => raw.toUpperCase() === 'TEXT')
                  .unwrapOr(false)
              ? 'scalar'
              : lookupSql.storageKind ?? metadata.storageKind
        )
      )
      .orElse(() =>
        ok(
          makeExpr(
            lookupSql.valueSql,
            'string', // Fallback to string if metadata unavailable
            isMultiple,
            lookupSql.errorConditionSql,
            lookupSql.errorMessageSql,
            lookupField,
            isMultiple ? 'array' : 'scalar'
          )
        )
      );
  }

  private parseExpression(
    expression: string,
    budget = this.budget ?? new FormulaCompileBudget(this.compileBudgetOptions)
  ): Result<RootContext, DomainError> {
    budget.allocate(budget.bytes(expression));
    budget.inspectTree((check) => inspectFormulaStructure(expression, check), false);
    return formulaParseCache.parse(expression).map((tree) => {
      budget.inspectTree((check) => inspectFormulaAst(tree, check), true);
      return tree;
    });
  }
}
