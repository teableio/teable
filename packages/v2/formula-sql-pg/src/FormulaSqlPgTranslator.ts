import type { RootContext } from '@teable/formula';
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
  private readonly formulaCache = new Map<string, Result<SqlExpr, DomainError>>();
  private readonly visiting = new Set<string>();

  constructor(options: FormulaSqlPgTranslatorOptions) {
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
    { expression: SqlExpr; bindings: FormulaSqlPgBindings }
  >();

  translateExpression(expression: string): Result<SqlExpr, DomainError> {
    return this.translateExpressions([expression]).map((expressions) => expressions[0]);
  }

  /** Compile independent outputs together to share their common subexpressions. */
  translateExpressions(
    expressions: ReadonlyArray<string>
  ): Result<ReadonlyArray<SqlExpr>, DomainError> {
    const graph = new FormulaExpressionGraph();
    const nodes: FormulaExpressionNode[] = [];
    for (const expression of expressions) {
      const parsed = this.parseExpression(expression);
      if (parsed.isErr()) return err(parsed.error);
      nodes.push(parsed.value.accept(new FormulaSqlPgVisitor(this, graph)));
    }
    const lowering = new FormulaSqlPgLowering(this);
    const bindings = lowering.bindings;
    return ok(
      lowering.lowerAll(nodes).map((raw) => {
        // Single-output callers usually inspect every channel. Plain properties
        // avoid accessor allocation/memoization overhead on that hot path.
        if (nodes.length === 1) {
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
        }
        // Host projections consume the raw channels through renderExpression(s).
        // Render individual channels only when a caller actually reads them.
        // Memoized accessors preserve the existing enumerable, writable API.
        const result: SqlExpr = { ...raw };
        for (const key of [
          'valueSql',
          'displayValueSql',
          'errorConditionSql',
          'errorMessageSql',
        ] as const) {
          Object.defineProperty(result, key, {
            configurable: true,
            enumerable: true,
            get: () => {
              const sql = raw[key];
              const value = sql === undefined ? undefined : bindings.render(sql);
              Object.defineProperty(result, key, {
                configurable: true,
                enumerable: true,
                writable: true,
                value,
              });
              return value;
            },
            set: (value: string | undefined) => {
              Object.defineProperty(result, key, {
                configurable: true,
                enumerable: true,
                writable: true,
                value,
              });
            },
          });
        }
        this.compiled.set(result, { expression: raw, bindings });
        return result;
      })
    );
  }

  buildExpressionGraph(expression: string): Result<FormulaExpressionNode, DomainError> {
    const graph = new FormulaExpressionGraph();
    return this.parseExpression(expression).map((tree) =>
      tree.accept(new FormulaSqlPgVisitor(this, graph))
    );
  }

  resolveFieldNode(
    fieldIdOrName: string,
    graph: FormulaExpressionGraph
  ): Result<FormulaExpressionNode, DomainError> {
    const field =
      this.fieldById.get(fieldIdOrName) ??
      (this.allowNameFallback
        ? this.fieldByName.get(fieldIdOrName.trim().toLowerCase())
        : undefined);
    if (!field) return err(domainError.notFound({ message: `Field not found: ${fieldIdOrName}` }));
    const id = field.id().toString();
    const cached = graph.fields.get(id);
    if (cached) return ok(cached);
    if (graph.visitingFields.has(id))
      return err(domainError.invariant({ message: `Formula dependency cycle detected at ${id}` }));
    graph.visitingFields.add(id);
    const formula = field.type().equals(FieldType.formula()) ? (field as FormulaField) : undefined;
    const useStored = formula?.expression().hasLastModifiedTimeParams().unwrapOr(false);
    const result =
      formula && !this.skipFormulaExpansion && !useStored
        ? this.parseExpression(formula.expression().toString()).map((tree) =>
            graph.intern({
              kind: 'field',
              field,
              value: tree.accept(new FormulaSqlPgVisitor(this, graph)),
            })
          )
        : this.resolveFieldById(fieldIdOrName).map((expression) =>
            graph.intern({ kind: 'leaf', expression })
          );
    graph.visitingFields.delete(id);
    if (result.isOk()) graph.fields.set(id, result.value);
    return result;
  }

  /** Compose host casts/error guards before rendering, sharing one binding scope. */
  renderExpression(expr: SqlExpr, select: (expression: SqlExpr) => string): string {
    const compiled = this.compiled.get(expr);
    return compiled ? compiled.bindings.render(select(compiled.expression)) : select(expr);
  }

  /** A one-row SELECT for a lateral projection of a jointly compiled program. */
  renderExpressions(
    expressions: ReadonlyArray<SqlExpr>,
    select: (raw: ReadonlyArray<SqlExpr>) => string
  ): string {
    const compiled = expressions.map((expression) => this.compiled.get(expression));
    const bindings = compiled[0]?.bindings;
    if (!bindings || compiled.some((entry) => entry?.bindings !== bindings)) {
      return `(SELECT ${select(expressions)})`;
    }
    return bindings.render(select(compiled.map((entry) => entry!.expression)), true);
  }

  renderSql(expr: SqlExpr): string {
    return this.renderExpression(expr, (value) => this.renderValueSql(value));
  }

  private renderValueSql(expr: SqlExpr): string {
    const renderedValueSql = expr.displayValueSql ?? expr.valueSql;
    if (!expr.errorConditionSql) return renderedValueSql;
    const errorMessage = expr.errorMessageSql ?? buildErrorLiteral('INTERNAL', 'unknown_error');
    if (expr.displayValueSql) {
      return `CASE WHEN ${expr.errorConditionSql} THEN ${errorMessage} ELSE ${renderedValueSql} END`;
    }
    if (expr.isArray) {
      return `CASE WHEN ${expr.errorConditionSql} THEN jsonb_build_array(${errorMessage}) ELSE ${expr.valueSql} END`;
    }
    const valueSql = expr.valueType === 'string' ? expr.valueSql : `(${expr.valueSql})::text`;
    return `CASE WHEN ${expr.errorConditionSql} THEN ${errorMessage} ELSE ${valueSql} END`;
  }

  resolveFieldById(fieldIdOrName: string): Result<SqlExpr, DomainError> {
    const field = this.fieldById.get(fieldIdOrName);
    if (field) return this.resolveField(field);
    if (!this.allowNameFallback) {
      return err(domainError.notFound({ message: `Field not found: ${fieldIdOrName}` }));
    }
    const fallback = this.fieldByName.get(fieldIdOrName.trim().toLowerCase());
    if (!fallback) {
      return err(domainError.notFound({ message: `Field not found: ${fieldIdOrName}` }));
    }
    return this.resolveField(fallback);
  }

  private resolveField(field: Field): Result<SqlExpr, DomainError> {
    if (field.type().equals(FieldType.formula())) {
      // When skipFormulaExpansion is true, use resolveFieldSql for formula fields
      // instead of recursively translating. This is used for CTE batch updates
      // where the formula value is already computed in a previous CTE.
      if (this.skipFormulaExpansion) {
        return this.resolveFieldSql(field);
      }
      return this.resolveFormulaField(field as FormulaField);
    }
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
            expr.valueType === 'string' && !expr.isArray ? 'string' : metadata.valueType,
            metadata.isArray,
            expr.errorConditionSql,
            expr.errorMessageSql,
            field,
            resolveFieldStorageKind(expr, metadata.storageKind)
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

  private resolveFormulaField(field: FormulaField): Result<SqlExpr, DomainError> {
    const fieldId = field.id().toString();
    const cached = this.formulaCache.get(fieldId);
    if (cached) return cached;
    if (this.visiting.has(fieldId)) {
      return err(
        domainError.invariant({ message: `Formula dependency cycle detected at ${fieldId}` })
      );
    }
    this.visiting.add(fieldId);
    const useStoredResult = field.expression().hasLastModifiedTimeParams();
    if (useStoredResult.isOk() && useStoredResult.value) {
      const storedResult = this.resolveFieldSql(field).andThen((expr) =>
        buildFieldSqlMetadata(field)
          .map((metadata) =>
            makeExpr(
              expr.valueSql,
              metadata.valueType,
              metadata.isArray,
              expr.errorConditionSql,
              expr.errorMessageSql,
              field,
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
                field,
                expr.storageKind
              )
            )
          )
      );
      this.visiting.delete(fieldId);
      this.formulaCache.set(fieldId, storedResult);
      return storedResult;
    }

    const result = this.translateExpression(field.expression().toString()).andThen((expr) =>
      buildFieldSqlMetadata(field)
        .map((metadata) =>
          makeExpr(
            expr.valueSql,
            metadata.valueType,
            metadata.isArray,
            expr.errorConditionSql,
            expr.errorMessageSql,
            field,
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
              field,
              expr.storageKind
            )
          )
        )
    );
    this.visiting.delete(fieldId);
    this.formulaCache.set(fieldId, result);
    return result;
  }

  private parseExpression(expression: string): Result<RootContext, DomainError> {
    return formulaParseCache.parse(expression);
  }
}
