import type {
  ANTLRErrorListener,
  ATNSimulator,
  Recognizer,
  RootContext,
  Token,
} from '@teable/formula';
import { CharStreams, CommonTokenStream, Formula, FormulaLexer } from '@teable/formula';
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
import { FormulaSqlPgVisitor } from './FormulaSqlPgVisitor';
import { buildErrorLiteral } from './PgSqlHelpers';
import type { IPgTypeValidationStrategy } from './PgTypeValidationStrategy';
import { makeExpr, type SqlExpr } from './SqlExpression';

export type FieldSqlResolver = (field: Field) => Result<SqlExpr, DomainError>;

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

class FormulaParseErrorCollector implements ANTLRErrorListener<Token> {
  private readonly errors: string[] = [];

  syntaxError<T extends Token>(
    _recognizer: Recognizer<T, ATNSimulator>,
    _offendingSymbol: T | undefined,
    _line: number,
    _charPositionInLine: number,
    msg: string
  ): void {
    this.errors.push(msg.split('expecting')[0].trim());
  }

  firstError(): string | undefined {
    return this.errors[0];
  }
}

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

  translateExpression(expression: string): Result<SqlExpr, DomainError> {
    return this.parseExpression(expression).map((tree) =>
      tree.accept(new FormulaSqlPgVisitor(this))
    );
  }

  renderSql(expr: SqlExpr): string {
    if (!expr.errorConditionSql) return expr.valueSql;
    const errorMessage = expr.errorMessageSql ?? buildErrorLiteral('INTERNAL', 'unknown_error');
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

    // Create a proxy expression that:
    // 1. Uses lookup field's raw SQL (JSON array) - extraction happens later
    // 2. Uses innerField's type metadata - so type coercion uses innerField's logic
    // 3. Marks as array so extractArrayScalarText will be called
    // 4. The extractArrayScalarText will detect this is a lookup field and use
    //    innerField's type-specific extraction logic
    return innerFieldMetadata
      .map((metadata) =>
        makeExpr(
          lookupSql.valueSql,
          metadata.valueType,
          true, // Lookup fields are arrays
          lookupSql.errorConditionSql,
          lookupSql.errorMessageSql,
          lookupField, // Keep reference to lookup field for context
          'array' // Storage kind is array (stored as JSON)
        )
      )
      .orElse(() =>
        ok(
          makeExpr(
            lookupSql.valueSql,
            'string', // Fallback to string if metadata unavailable
            true,
            lookupSql.errorConditionSql,
            lookupSql.errorMessageSql,
            lookupField,
            'array'
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
    const inputStream = CharStreams.fromString(expression);
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);
    parser.removeErrorListeners();
    const collector = new FormulaParseErrorCollector();
    parser.addErrorListener(collector);
    const tree = parser.root();
    const error = collector.firstError();
    if (error) {
      return err(domainError.validation({ message: error }));
    }
    return ok(tree);
  }
}
