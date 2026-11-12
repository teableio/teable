import {
  FunctionCallCollectorVisitor,
  inspectFormulaStructure,
  inspectFormulaAst,
  type RootContext,
} from '@teable/formula';
import {
  domainError,
  type CellValueType,
  type CellValueMultiplicity,
  type ConditionalLookupField,
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
import { buildUserTitleFromSnapshotSql } from './UserSnapshotSql';

export type FieldSqlResolver = (field: Field) => Result<SqlExpr, DomainError>;

export type FormulaSqlPgReference =
  | {
      readonly field: Field;
      readonly resolveFieldSql: FieldSqlResolver;
      readonly actorIdFallbackSql?: string;
    }
  | {
      readonly valueSql: string;
      readonly valueType: CellValueType;
      readonly multiplicity: CellValueMultiplicity;
    };

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

type FormulaSqlPgTranslatorCommonOptions = {
  compileBudget?: FormulaCompileBudgetOptions;
  /** Share only within one host statement (for example, a multi-level CTE batch). */
  budget?: FormulaCompileBudget;
  tableAlias: string;
  timeZone?: string;
  /** Per-REPT intermediate UTF-8 bytes; omitted for stored formula semantics. */
  maxReptBytes?: number;
  /**
   * PostgreSQL version type validation strategy.
   * Required parameter - must be injected from the DI container.
   *
   * - PG 16+: Use Pg16TypeValidationStrategy (uses native pg_input_is_valid)
   * - PG < 16: Use PgLegacyTypeValidationStrategy (uses polyfill function)
   */
  typeValidationStrategy: IPgTypeValidationStrategy;
};

type FormulaSqlPgTableInput = {
  table: Table;
  resolveFieldSql: FieldSqlResolver;
  references?: never;
  allowFieldNameFallback?: boolean;
  /** Resolve stored formula columns instead of recursively expanding their formulas. */
  skipFormulaExpansion?: boolean;
};

type FormulaSqlPgReferenceInput = {
  /** Exact Teable reference aliases, after the parser's reference extraction. */
  references: ReadonlyMap<string, FormulaSqlPgReference>;
  table?: never;
  resolveFieldSql?: never;
  allowFieldNameFallback?: never;
  skipFormulaExpansion?: never;
};

export type FormulaSqlPgTranslatorOptions = FormulaSqlPgTranslatorCommonOptions &
  (FormulaSqlPgTableInput | FormulaSqlPgReferenceInput);

export class FormulaSqlPgTranslator {
  readonly tableAlias: string;
  readonly typeValidationStrategy: IPgTypeValidationStrategy;
  readonly timeZone: string;
  readonly maxReptBytes: number | undefined;
  private readonly options: FormulaSqlPgTranslatorOptions;
  private readonly fieldById?: ReadonlyMap<string, Field>;
  private readonly fieldByName?: ReadonlyMap<string, Field>;
  private readonly compileBudgetOptions: FormulaCompileBudgetOptions | undefined;
  private readonly budget?: FormulaCompileBudget;
  constructor(options: FormulaSqlPgTranslatorOptions) {
    if (
      options.maxReptBytes !== undefined &&
      (!Number.isSafeInteger(options.maxReptBytes) || options.maxReptBytes < 1)
    ) {
      throw new Error('Invalid formula repetition byte limit');
    }
    this.maxReptBytes = options.maxReptBytes;
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
    this.options = { ...options };
    const compileBudget = options.compileBudget ?? options.budget?.options;
    this.compileBudgetOptions = compileBudget ? Object.freeze({ ...compileBudget }) : undefined;
    this.tableAlias = options.tableAlias;
    this.typeValidationStrategy = options.typeValidationStrategy;
    this.timeZone = options.timeZone ?? 'utc';
    if (options.references === undefined) {
      const fields = options.table.getFields();
      this.fieldById = new Map(fields.map((field) => [field.id().toString(), field]));
      this.fieldByName = new Map(
        fields.map((field) => [field.name().toString().trim().toLowerCase(), field])
      );
    }
  }
  withTimeZone(timeZone: string): FormulaSqlPgTranslator {
    return new FormulaSqlPgTranslator({
      ...this.options,
      compileBudget: this.compileBudgetOptions,
      timeZone,
    });
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
    if (this.options.references !== undefined) {
      return this.resolveReference(fieldIdOrName, this.options.references, graph.budget).map(
        (expression) => graph.intern({ kind: 'leaf', expression, timeZone: this.timeZone })
      );
    }
    return this.resolveTableFieldNode(fieldIdOrName, graph, this.options);
  }

  private resolveTableFieldNode(
    fieldIdOrName: string,
    graph: FormulaExpressionGraph,
    options: FormulaSqlPgTableInput
  ): Result<FormulaExpressionNode, DomainError> {
    const field = this.findField(fieldIdOrName);
    if (!field) return err(domainError.notFound({ message: `Field not found: ${fieldIdOrName}` }));
    const id = field.id().toString();
    const cached = this.cachedTableFieldNode(id, graph);
    if (cached) return cached;
    const expansion = this.expandFormulaField(field, graph, options);
    if (expansion.isErr()) return err(expansion.error);
    const expanded = expansion.value;
    if (expanded.formula && expanded.parsed && !expanded.useStored) {
      graph.budget.check('referenceDepth', graph.visitingFields.size + 1);
      graph.visitingFields.add(id);
    }
    const result = this.buildTableFieldNode(field, graph, expanded, options);
    graph.visitingFields.delete(id);
    if (result.isOk()) {
      graph.fields.set(id, result.value);
      graph.referenceDepths.set(id, graph.nodeReferenceDepths.get(result.value.id) ?? 0);
    }
    return result;
  }

  private cachedTableFieldNode(
    id: string,
    graph: FormulaExpressionGraph
  ): Result<FormulaExpressionNode, DomainError> | undefined {
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
    return undefined;
  }

  private expandFormulaField(
    field: Field,
    graph: FormulaExpressionGraph,
    options: FormulaSqlPgTableInput
  ): Result<{ formula?: FormulaField; parsed?: RootContext; useStored: boolean }, DomainError> {
    const formula = field.type().equals(FieldType.formula()) ? (field as FormulaField) : undefined;
    if (!formula || options.skipFormulaExpansion) return ok({ formula, useStored: false });
    return this.parseExpression(formula.expression().toString(), graph.budget).map((parsed) => ({
      formula,
      parsed,
      useStored: parsed
        .accept(new FunctionCallCollectorVisitor())
        .some((call) => call.name === 'LAST_MODIFIED_TIME' && call.paramCount > 0),
    }));
  }

  private buildTableFieldNode(
    field: Field,
    graph: FormulaExpressionGraph,
    expanded: { formula?: FormulaField; parsed?: RootContext; useStored: boolean },
    options: FormulaSqlPgTableInput
  ): Result<FormulaExpressionNode, DomainError> {
    const formulaTimeZone = expanded.formula?.timeZone()?.toString() ?? 'utc';
    if (expanded.formula && expanded.parsed && !expanded.useStored) {
      return ok(
        graph.intern({
          kind: 'field',
          field: expanded.formula,
          timeZone: formulaTimeZone,
          value: expanded.parsed.accept(
            new FormulaSqlPgVisitor(this.withTimeZone(formulaTimeZone), graph)
          ),
        })
      );
    }
    return this.resolveField(field, options, false).map((expression) =>
      graph.intern({ kind: 'leaf', expression, timeZone: this.timeZone })
    );
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
    if (this.options.references !== undefined) {
      return this.resolveReference(fieldIdOrName, this.options.references);
    }
    const field = this.findField(fieldIdOrName);
    if (!field) return err(domainError.notFound({ message: `Field not found: ${fieldIdOrName}` }));
    return this.resolveField(field, this.options);
  }

  private resolveReference(
    alias: string,
    references: ReadonlyMap<string, FormulaSqlPgReference>,
    budget?: FormulaCompileBudget
  ): Result<SqlExpr, DomainError> {
    const reference = references.get(alias);
    if (!reference) return err(domainError.notFound({ message: `Field not found: ${alias}` }));
    if ('resolveFieldSql' in reference) {
      return this.resolveField(
        reference.field,
        {
          resolveFieldSql: (field) =>
            reference.resolveFieldSql(field).map((expr) => {
              const type = field.type();
              if (
                (type.equals(FieldType.createdBy()) || type.equals(FieldType.lastModifiedBy())) &&
                !(expr.valueType === 'string' && expr.storageKind === 'scalar')
              ) {
                return makeExpr(
                  buildUserTitleFromSnapshotSql(
                    expr.valueSql,
                    reference.actorIdFallbackSql,
                    budget
                  ),
                  'string',
                  false,
                  expr.errorConditionSql,
                  expr.errorMessageSql,
                  field,
                  'scalar'
                );
              }
              return expr;
            }),
        },
        false
      );
    }
    const multiple = reference.multiplicity.isMultiple();
    const type = reference.valueType.toString();
    return ok(
      makeExpr(
        reference.valueSql,
        type === 'dateTime' ? 'datetime' : type,
        multiple,
        undefined,
        undefined,
        undefined,
        multiple ? 'array' : 'scalar'
      )
    );
  }

  private findField(fieldIdOrName: string): Field | undefined {
    return (
      this.fieldById?.get(fieldIdOrName) ??
      ((this.options.allowFieldNameFallback ?? true)
        ? this.fieldByName?.get(fieldIdOrName.trim().toLowerCase())
        : undefined)
    );
  }

  private resolveField(
    field: Field,
    input: Pick<FormulaSqlPgTableInput, 'resolveFieldSql' | 'skipFormulaExpansion'>,
    expandFormula = true
  ): Result<SqlExpr, DomainError> {
    if (field.type().equals(FieldType.formula()) && expandFormula) {
      // Existing CTE callers already supply their completed formula expression.
      if (input.skipFormulaExpansion) return input.resolveFieldSql(field);
      return this.translateExpression(`{${field.id().toString()}}`);
    }
    if (field.type().equals(FieldType.formula()) && input.skipFormulaExpansion)
      return input.resolveFieldSql(field);
    // For lookup fields, proxy to innerField's SQL generation logic
    if (
      field.type().equals(FieldType.lookup()) ||
      field.type().equals(FieldType.conditionalLookup())
    ) {
      return this.resolveLookupField(
        field as LookupField | ConditionalLookupField,
        input.resolveFieldSql
      );
    }
    return input.resolveFieldSql(field).andThen((expr) =>
      buildFieldSqlMetadata(field)
        .map((metadata) => ({
          ...makeExpr(
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
          ),
          displayValueSql: expr.displayValueSql,
        }))
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
  private resolveLookupField(
    lookupField: LookupField | ConditionalLookupField,
    resolveFieldSql: FieldSqlResolver
  ): Result<SqlExpr, DomainError> {
    // Get the innerField
    const innerFieldResult = lookupField.innerField();
    if (innerFieldResult.isErr()) {
      // If innerField is not resolved, fall back to generic lookup handling
      return resolveFieldSql(lookupField).andThen((expr) =>
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
    const lookupSqlResult = resolveFieldSql(lookupField);
    if (lookupSqlResult.isErr()) {
      return lookupSqlResult;
    }
    const lookupSql = lookupSqlResult.value;

    // Get innerField's metadata to proxy its type information
    const innerFieldMetadata = buildFieldSqlMetadata(innerField);
    const lookupFieldMetadata = buildFieldSqlMetadata(lookupField);

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
              : (lookupSql.storageKind ??
                lookupFieldMetadata
                  .map((value) => value.storageKind)
                  .unwrapOr(metadata.storageKind))
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
