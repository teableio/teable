import { DriverClient, FieldType } from '@teable/core';
import type { INumberFormatting, ICurrencyFormatting, Relationship, FieldCore } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQueryDialectProvider } from '../record-query-dialect.interface';

export class PgRecordQueryDialect implements IRecordQueryDialectProvider {
  readonly driver = DriverClient.Pg as const;

  constructor(private readonly knex: Knex) {}

  toText(expr: string): string {
    return `(${expr})::TEXT`;
  }

  formatNumber(expr: string, formatting: INumberFormatting): string {
    const { type, precision } = formatting;
    switch (type) {
      case 'decimal':
        return `ROUND(CAST(${expr} AS NUMERIC), ${precision ?? 0})::TEXT`;
      case 'percent':
        return `ROUND(CAST(${expr} * 100 AS NUMERIC), ${precision ?? 0})::TEXT || '%'`;
      case 'currency': {
        const symbol = (formatting as ICurrencyFormatting).symbol || '$';
        if (typeof precision === 'number') {
          return `'${symbol}' || ROUND(CAST(${expr} AS NUMERIC), ${precision})::TEXT`;
        }
        return `'${symbol}' || (${expr})::TEXT`;
      }
      default:
        return `(${expr})::TEXT`;
    }
  }

  formatNumberArray(expr: string, formatting: INumberFormatting): string {
    const elem = `(elem #>> '{}')::numeric`;
    const formatted = this.formatNumber(elem, formatting).replace(
      /\(elem #>> '\{\}'\)::numeric/,
      elem
    );
    return `(
        SELECT string_agg(${formatted}, ', ' ORDER BY ord)
        FROM jsonb_array_elements(COALESCE((${expr})::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
      )`;
  }

  formatStringArray(expr: string): string {
    return `(
        SELECT string_agg(
          CASE
            WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
            WHEN jsonb_typeof(elem) = 'object' THEN elem->>'title'
            ELSE elem::text
          END,
          ', '
          ORDER BY ord
        )
        FROM jsonb_array_elements(COALESCE((${expr})::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
      )`;
  }

  formatRating(expr: string): string {
    return `CASE WHEN (${expr} = ROUND(${expr})) THEN ROUND(${expr})::TEXT ELSE (${expr})::TEXT END`;
  }

  coerceToNumericForCompare(expr: string): string {
    return `CASE WHEN (${expr})::text ~ '^[+-]?((\\d+\\.\\d+)|(\\d+)|(\\.\\d+))$' THEN (${expr})::numeric ELSE NULL END`;
  }

  linkHasAny(selectionSql: string): string {
    return `(${selectionSql} IS NOT NULL AND ${selectionSql}::text != 'null' AND ${selectionSql}::text != '[]')`;
  }

  linkExtractTitles(selectionSql: string, isMultiple: boolean): string {
    if (isMultiple) {
      return `(SELECT json_agg(value->>'title') FROM jsonb_array_elements(${selectionSql}::jsonb) AS value)::jsonb`;
    }
    return `(${selectionSql}->>'title')`;
  }

  jsonTitleFromExpr(selectionSql: string): string {
    return `(${selectionSql}->>'title')`;
  }

  selectUserNameById(idRef: string): string {
    return `(SELECT u.name FROM users u WHERE u.id = ${idRef})`;
  }

  buildUserJsonObjectById(idRef: string): string {
    return `(
        SELECT jsonb_build_object('id', u.id, 'title', u.name, 'email', u.email)
        FROM users u
        WHERE u.id = ${idRef}
      )`;
  }

  flattenLookupCteValue(cteName: string, fieldId: string, isMultiple: boolean): string | null {
    if (!isMultiple) return null;
    return `(
            WITH RECURSIVE f(e) AS (
              SELECT "${cteName}"."lookup_${fieldId}"::jsonb
              UNION ALL
              SELECT jsonb_array_elements(f.e)
              FROM f
              WHERE jsonb_typeof(f.e) = 'array'
            )
            SELECT jsonb_agg(e) FILTER (WHERE jsonb_typeof(e) <> 'array') FROM f
          )`;
  }

  jsonAggregateNonNull(expression: string, orderByClause?: string): string {
    const order = orderByClause ? ` ORDER BY ${orderByClause}` : '';
    return `json_agg(${expression}${order}) FILTER (WHERE ${expression} IS NOT NULL)`;
  }

  stringAggregate(expression: string, delimiter: string, orderByClause?: string): string {
    const order = orderByClause ? ` ORDER BY ${orderByClause}` : '';
    return `STRING_AGG(${expression}::text, ${this.knex.raw('?', [delimiter]).toQuery()}${order})`;
  }

  jsonArrayLength(expr: string): string {
    return `jsonb_array_length(${expr}::jsonb)`;
  }

  private castAgg(sql: string): string {
    // normalize to double precision for numeric rollups
    return `CAST(${sql} AS DOUBLE PRECISION)`;
  }

  rollupAggregate(
    fn: string,
    fieldExpression: string,
    opts: { targetField?: FieldCore; orderByField?: string; rowPresenceExpr?: string }
  ): string {
    const { targetField, orderByField, rowPresenceExpr } = opts;
    switch (fn) {
      case 'sum':
        return this.castAgg(`COALESCE(SUM(${fieldExpression}), 0)`);
      case 'count':
        return this.castAgg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'countall': {
        if (targetField?.type === FieldType.MultipleSelect) {
          return this.castAgg(
            `COALESCE(SUM(CASE WHEN ${fieldExpression} IS NOT NULL THEN jsonb_array_length(${fieldExpression}::jsonb) ELSE 0 END), 0)`
          );
        }
        const base = rowPresenceExpr ?? fieldExpression;
        return this.castAgg(`COALESCE(COUNT(${base}), 0)`);
      }
      case 'counta':
        return this.castAgg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'max':
        return this.castAgg(`MAX(${fieldExpression})`);
      case 'min':
        return this.castAgg(`MIN(${fieldExpression})`);
      case 'and':
        return `BOOL_AND(${fieldExpression}::boolean)`;
      case 'or':
        return `BOOL_OR(${fieldExpression}::boolean)`;
      case 'xor':
        return `(COUNT(CASE WHEN ${fieldExpression}::boolean THEN 1 END) % 2 = 1)`;
      case 'array_join':
      case 'concatenate':
        return orderByField
          ? `STRING_AGG(${fieldExpression}::text, ', ' ORDER BY ${orderByField})`
          : `STRING_AGG(${fieldExpression}::text, ', ')`;
      case 'array_unique':
        return `json_agg(DISTINCT ${fieldExpression})`;
      case 'array_compact':
        return `json_agg(${fieldExpression}) FILTER (WHERE ${fieldExpression} IS NOT NULL)`;
      default:
        throw new Error(`Unsupported rollup function: ${fn}`);
    }
  }

  singleValueRollupAggregate(fn: string, fieldExpression: string): string {
    switch (fn) {
      case 'sum':
        return `COALESCE(${fieldExpression}, 0)`;
      case 'max':
      case 'min':
      case 'array_join':
      case 'concatenate':
        return `${fieldExpression}`;
      case 'count':
      case 'countall':
      case 'counta':
        return `CASE WHEN ${fieldExpression} IS NULL THEN 0 ELSE 1 END`;
      case 'and':
      case 'or':
      case 'xor':
        return `(COALESCE((${fieldExpression})::boolean, false))`;
      case 'array_unique':
      case 'array_compact':
        return `(CASE WHEN ${fieldExpression} IS NULL THEN '[]'::json ELSE json_build_array(${fieldExpression}) END)`;
      default:
        return `${fieldExpression}`;
    }
  }

  buildLinkJsonObject(
    recordIdRef: string,
    formattedSelectionExpression: string,
    _rawSelectionExpression: string
  ): string {
    return `jsonb_strip_nulls(jsonb_build_object('id', ${recordIdRef}, 'title', ${formattedSelectionExpression}))::jsonb`;
  }

  applyLinkCteOrdering(
    _qb: Knex.QueryBuilder,
    _opts: {
      relationship: Relationship;
      usesJunctionTable: boolean;
      hasOrderColumn: boolean;
      junctionAlias: string;
      foreignAlias: string;
      selfKeyName: string;
    }
  ): void {
    // Postgres needs no extra ordering hacks at CTE level for json_agg
  }

  buildDeterministicLookupAggregate(): string | null {
    // PG returns null to signal not needed; caller should use json_agg with ORDER BY
    return null;
  }
}
