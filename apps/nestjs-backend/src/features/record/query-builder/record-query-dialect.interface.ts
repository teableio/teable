import type {
  DriverClient,
  FieldCore,
  INumberFormatting,
  Relationship,
  DbFieldType,
} from '@teable/core';
import type { Knex } from 'knex';

/**
 * Database-dialect provider for Record Query Builder.
 * Centralizes all SQL fragment differences between PostgreSQL and SQLite so callers
 * can build queries without sprinkling driver-specific if/else throughout the codebase.
 *
 * All methods return SQL snippets as strings that can be embedded in knex.raw or string
 * templating. Implementations MUST ensure generated SQL is valid for their driver.
 */
export interface IRecordQueryDialectProvider {
  /**
   * Current driver this provider targets.
   * - PG example: DriverClient.Pg
   * - SQLite example: DriverClient.Sqlite
   */
  readonly driver: DriverClient;

  // Generic casts/formatting

  /**
   * Cast any SQL expression to text string.
   * - PG: returns `(expr)::TEXT`
   * - SQLite: returns `CAST(expr AS TEXT)`
   * @example
   * ```ts
   * dialect.toText('t.amount')
   * // PG:     (t.amount)::TEXT
   * // SQLite: CAST(t.amount AS TEXT)
   * ```
   */
  toText(expr: string): string;

  /**
   * Format a numeric SQL expression according to app number formatting rules.
   * Supports decimal, percent, currency (symbol + precision), etc.
   * @example
   * ```ts
   * dialect.formatNumber('t.price', { type: 'decimal', precision: 2 })
   * // PG:     ROUND(CAST(t.price AS NUMERIC), 2)::TEXT
   * // SQLite: PRINTF('%.2f', t.price)
   * ```
   */
  formatNumber(expr: string, formatting: INumberFormatting): string;

  /**
   * Format elements of a JSON array of numbers into a single comma-separated string
   * while preserving original array order.
   * @example
   * ```ts
   * dialect.formatNumberArray('t.values', { type: 'percent', precision: 1 })
   * // PG:     SELECT string_agg(ROUND(...), ', ')
   * //          FROM jsonb_array_elements((t.values)::jsonb) WITH ORDINALITY
   * // SQLite: SELECT GROUP_CONCAT(PRINTF(...), ', ')
   * //          FROM json_each(CASE WHEN json_valid(t.values) THEN t.values ELSE json('[]') END)
   * ```
   */
  formatNumberArray(expr: string, formatting: INumberFormatting): string;

  /**
   * Join elements of a JSON array (text/object) into a comma-separated string.
   * For objects with title, extracts the title.
   * @example
   * ```ts
   * dialect.formatStringArray('t.tags')
   * // PG:     SELECT string_agg(CASE ... END, ', ')
   * //          FROM jsonb_array_elements((t.tags)::jsonb) WITH ORDINALITY
   * // SQLite: SELECT GROUP_CONCAT(CASE ... END, ', ')
   * //          FROM json_each(CASE WHEN json_valid(t.tags) THEN t.tags ELSE json('[]') END)
   * ```
   */
  formatStringArray(expr: string): string;

  /**
   * Format rating values: emit integer text if it is an integer; otherwise real as text.
   * @example
   * ```ts
   * dialect.formatRating('t.rating')
   * // PG:     CASE WHEN (t.rating = ROUND(t.rating))
   * //            THEN ROUND(t.rating)::TEXT ELSE (t.rating)::TEXT END
   * // SQLite: CASE WHEN (t.rating = CAST(t.rating AS INTEGER))
   * //            THEN CAST(CAST(t.rating AS INTEGER) AS TEXT) ELSE CAST(t.rating AS TEXT) END
   * ```
   */
  formatRating(expr: string): string;

  // Safe coercions used in comparisons

  /**
   * Safely coerce a string-like SQL expression to numeric for comparisons without runtime errors.
   * @example
   * ```sql
   * -- Use in comparisons
   * <coerceToNumericForCompare('t.left')> > <coerceToNumericForCompare('t.right')>
   * ```
   */
  coerceToNumericForCompare(expr: string): string;

  // Link/user helpers in SELECT context

  /**
   * Check whether a link JSON value is present and non-empty.
   * @example
   * ```ts
   * dialect.linkHasAny('"cte"."link_value"')
   * // PG:     (cte.link_value IS NOT NULL AND (cte.link_value)::text != 'null' AND (cte.link_value)::text != '[]')
   * // SQLite: (cte.link_value IS NOT NULL AND cte.link_value != 'null' AND cte.link_value != '[]')
   * ```
   */
  linkHasAny(selectionSql: string): string;

  /**
   * Extract link title(s) from a link JSON value.
   * - When isMultiple = true: return a JSON array of titles.
   * - When isMultiple = false: return a single title string.
   * @example PostgreSQL
   * ```sql
   * (SELECT json_agg(value->>'title')
   *  FROM jsonb_array_elements(cte.link_value::jsonb) AS value)::jsonb
   * ```
   * @example SQLite
   * ```sql
   * (SELECT json_group_array(json_extract(value, '$.title'))
   *  FROM json_each(CASE WHEN json_valid(cte.link_value) AND json_type(cte.link_value)='array'
   *                      THEN cte.link_value ELSE json('[]') END)
   *  ORDER BY key)
   * ```
   */
  linkExtractTitles(selectionSql: string, isMultiple: boolean): string;

  /**
   * Extract the 'title' property from a JSON object expression.
   * @example
   * ```ts
   * dialect.jsonTitleFromExpr('t.user_json')
   * // PG:     (t.user_json->>'title')
   * // SQLite: json_extract(t.user_json, '$.title')
   * ```
   */
  jsonTitleFromExpr(selectionSql: string): string;

  /**
   * Subquery snippet to select user name by id.
   * @example
   * ```ts
   * dialect.selectUserNameById('"t"."__created_by"')
   * // PG:     (SELECT u.name FROM users u WHERE u.id = "t"."__created_by")
   * // SQLite: (SELECT name FROM users WHERE id = "t"."__created_by")
   * ```
   */
  selectUserNameById(idRef: string): string;

  /**
   * Build a JSON object for system user fields: { id, title, email }.
   * @example
   * ```ts
   * dialect.buildUserJsonObjectById('"t"."__created_by"')
   * // PG:     (SELECT jsonb_build_object('id', u.id, 'title', u.name, 'email', u.email) FROM users u WHERE u.id = "t"."__created_by")
   * // SQLite: json_object('id', "t"."__created_by", 'title', (SELECT name FROM users WHERE id = "t"."__created_by"), 'email', (SELECT email FROM users WHERE id = "t"."__created_by"))
   * ```
   */
  buildUserJsonObjectById(idRef: string): string;

  // Lookup CTE helpers

  /**
   * Flatten a lookup CTE column if necessary (e.g., PG nested arrays) and return a SQL expression.
   * Return null when no special handling is required.
   * @example
   * ```ts
   * dialect.flattenLookupCteValue('CTE_main_link', 'fld_123', true) // => WITH RECURSIVE ... jsonb_array_elements ...
   * ```
   */
  flattenLookupCteValue(cteName: string, fieldId: string, isMultiple: boolean): string | null;

  // JSON aggregation helpers

  /**
   * Aggregate non-null values into a JSON array; optionally with ORDER BY.
   * @example
   * ```ts
   * dialect.jsonAggregateNonNull('f.title', 'f.__id ASC')
   * // PG:     json_agg(f.title ORDER BY f.__id ASC) FILTER (WHERE f.title IS NOT NULL)
   * // SQLite: json_group_array(CASE WHEN f.title IS NOT NULL THEN f.title END)
   * ```
   */
  jsonAggregateNonNull(expression: string, orderByClause?: string): string;

  /**
   * Aggregate values into a string with delimiter; optionally with ORDER BY.
   * @example
   * ```ts
   * dialect.stringAggregate('t.name', ', ', 't.__id')
   * // PG:     STRING_AGG(t.name::text, ', ' ORDER BY t.__id)
   * // SQLite: GROUP_CONCAT(t.name, ', ')
   * ```
   */
  stringAggregate(expression: string, delimiter: string, orderByClause?: string): string;

  /**
   * Return the length of a JSON array expression.
   * @example
   * ```ts
   * dialect.jsonArrayLength('t.tags')
   * // PG:     jsonb_array_length(t.tags::jsonb)
   * // SQLite: json_array_length(t.tags)
   * ```
   */
  jsonArrayLength(expr: string): string;

  /**
   * Dialect-specific typed NULL for JSON contexts
   * - PG: NULL::json
   * - SQLite: NULL
   */
  nullJson(): string;

  /**
   * Produce a typed NULL literal appropriate for the provided database field type.
   * - PG: returns casts like NULL::jsonb, NULL::timestamptz, etc.
   * - SQLite: plain NULL (no strong typing).
   */
  typedNullFor(dbFieldType: DbFieldType): string;

  // Rollup helpers

  /**
   * Build an aggregate expression for rollup in multi-value relationships.
   * Supported functions: sum, average, count, countall, counta, max, min, and, or, xor,
   * array_join/concatenate, array_unique, array_compact.
   * @example
   * ```ts
   * dialect.rollupAggregate('sum', 'f.amount', { orderByField: 'j.__id' })
   * // PG:     CAST(COALESCE(SUM(f.amount), 0) AS DOUBLE PRECISION)
   * // SQLite: COALESCE(SUM(f.amount), 0)
   * ```
   */
  rollupAggregate(
    fn: string,
    fieldExpression: string,
    opts: {
      targetField?: FieldCore;
      orderByField?: string;
      rowPresenceExpr?: string;
      flattenNestedArray?: boolean;
    }
  ): string;

  /**
   * Build rollup-like expression for single-value relationships without GROUP BY.
   * @example
   * ```ts
   * dialect.singleValueRollupAggregate('count', 'f.amount', { rollupField, targetField })
   * // PG:     CASE WHEN f.amount IS NULL THEN 0 ELSE 1 END
   * ```
   */
  singleValueRollupAggregate(
    fn: string,
    fieldExpression: string,
    options: { rollupField: FieldCore; targetField: FieldCore }
  ): string;

  /**
   * Build conditional JSON for link cell: { id, title? }.
   * If the title expression is NULL, omit title in PG (strip nulls) or omit the key in SQLite.
   * @example
   * ```ts
   * dialect.buildLinkJsonObject('f."__id"', 'formattedTitleExpr', 'rawTitleExpr')
   * // PG:     jsonb_strip_nulls(jsonb_build_object('id', f."__id", 'title', formattedTitleExpr))::jsonb
   * // SQLite: CASE WHEN rawTitleExpr IS NOT NULL THEN json_object('id', f."__id", 'title', formattedTitleExpr) ELSE json_object('id', f."__id") END
   * ```
   */
  buildLinkJsonObject(
    recordIdRef: string,
    formattedSelectionExpression: string,
    rawSelectionExpression: string
  ): string;

  /**
   * Apply deterministic ordering workarounds for JSON aggregations in CTEs.
   * Only SQLite typically modifies the builder (e.g., ORDER BY junction.__id); PG is a no-op.
   * @example
   * ```ts
   * dialect.applyLinkCteOrdering(qb, { relationship: Relationship.OneMany, usesJunctionTable: false, hasOrderColumn: true, junctionAlias: 'j', foreignAlias: 'f', selfKeyName: 'main_id' })
   * ```
   */
  applyLinkCteOrdering(
    qb: Knex.QueryBuilder,
    opts: {
      relationship: Relationship;
      usesJunctionTable: boolean;
      hasOrderColumn: boolean;
      junctionAlias: string;
      foreignAlias: string;
      selfKeyName: string;
    }
  ): void;

  /**
   * Build deterministic ordered aggregate for multi-value LOOKUP (SQLite path).
   * - PG: return null and let caller use json_agg ORDER BY directly.
   * - SQLite: return a correlated subquery using json_group_array with ORDER BY to preserve order.
   * @example
   * ```ts
   * dialect.buildDeterministicLookupAggregate({
   *   tableDbName: 'main', mainAlias: 'm', foreignDbName: 'foreign', foreignAlias: 'f',
   *   usesJunctionTable: true, linkFieldOrderColumn: 'j."order"', junctionAlias: 'j',
   *   linkFieldHasOrderColumn: true, selfKeyName: 'main_id', foreignKeyName: 'foreign_id',
   *   recordIdRef: 'f."__id"', formattedSelectionExpression: '...titleExpr...', rawSelectionExpression: '...rawExpr...'
   * })
   * ```
   */
  buildDeterministicLookupAggregate(params: {
    tableDbName: string;
    mainAlias: string;
    foreignDbName: string;
    foreignAlias: string;
    linkFieldOrderColumn?: string; // e.g., j."order" or f."self_order"
    linkFieldHasOrderColumn: boolean;
    usesJunctionTable: boolean;
    selfKeyName: string;
    foreignKeyName: string;
    recordIdRef: string; // f."__id"
    formattedSelectionExpression: string; // using foreign alias
    rawSelectionExpression: string; // using foreign alias
    linkFilterSubquerySql?: string; // EXISTS (subquery) condition
    junctionAlias: string; // typically 'j'
  }): string | null;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const RECORD_QUERY_DIALECT_SYMBOL = Symbol('RECORD_QUERY_DIALECT');
