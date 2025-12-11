import type {
  INumberFormatting,
  ICurrencyFormatting,
  FieldCore,
  IDatetimeFormatting,
  Relationship,
} from '@teable/core';
import {
  DriverClient,
  FieldType,
  CellValueType,
  DbFieldType,
  DateFormattingPreset,
  TimeFormatting,
} from '@teable/core';
import type { Knex } from 'knex';
import { FieldFormattingVisitor } from '../field-formatting-visitor';
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

  formatStringArray(expr: string, opts?: { fieldInfo?: FieldCore }): string {
    const trimmedRaw = expr.trim();
    const upperExpr = trimmedRaw.toUpperCase();
    if (upperExpr === 'NULL' || upperExpr === 'NULL::JSONB' || upperExpr === 'NULL::JSON') {
      return 'NULL::text';
    }
    if (upperExpr.startsWith('NULL::') && !upperExpr.startsWith('NULL::TEXT')) {
      return `${trimmedRaw}::text`;
    }
    if (upperExpr === 'NULL::TEXT') {
      return trimmedRaw;
    }
    const safeArrayExpr =
      this.buildArrayNormalizerFromField(expr, opts?.fieldInfo) ??
      this.buildGenericArrayNormalizer(expr);
    const elementText = `CASE
      WHEN jsonb_typeof(elem) = 'object' THEN COALESCE(elem->>'title', elem->>'name', elem #>> '{}')
      ELSE elem #>> '{}'
    END`;
    return `(
        SELECT string_agg(
          ${elementText},
          ', '
          ORDER BY ord
        )
        FROM jsonb_array_elements(${safeArrayExpr}) WITH ORDINALITY AS t(elem, ord)
      )`;
  }

  private buildArrayNormalizerFromField(expr: string, fieldInfo?: FieldCore): string | null {
    if (!fieldInfo) {
      return null;
    }

    const baseExpr = `(${expr})`;
    const isLikelyJson =
      (fieldInfo as unknown as { isMultipleCellValue?: boolean }).isMultipleCellValue === true ||
      fieldInfo.dbFieldType === DbFieldType.Json ||
      fieldInfo.type === FieldType.Link ||
      fieldInfo.type === FieldType.Attachment ||
      fieldInfo.type === FieldType.MultipleSelect ||
      fieldInfo.type === FieldType.User ||
      fieldInfo.type === FieldType.CreatedBy ||
      fieldInfo.type === FieldType.LastModifiedBy;

    if (!isLikelyJson) {
      return null;
    }

    const jsonExpr = `to_jsonb(${baseExpr})`;

    return `(CASE
      WHEN ${baseExpr} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(${jsonExpr}) = 'array' THEN COALESCE(${jsonExpr}, '[]'::jsonb)
      ELSE jsonb_build_array(${jsonExpr})
    END)`;
  }

  private buildGenericArrayNormalizer(expr: string): string {
    const jsonExpr = `to_jsonb(${expr})`;
    const textExpr = `((${expr})::text)`;
    const trimmedExpr = `BTRIM(${textExpr})`;
    const parsedTextArray = `CASE
          WHEN ${trimmedExpr} = '' THEN '[]'::jsonb
          WHEN LEFT(${trimmedExpr}, 1) = '[' THEN COALESCE((${expr})::jsonb, '[]'::jsonb)
          ELSE jsonb_build_array(${jsonExpr})
        END`;

    return `(CASE
        WHEN ${expr} IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(${jsonExpr}) = 'array' THEN COALESCE(${jsonExpr}, '[]'::jsonb)
        WHEN jsonb_typeof(${jsonExpr}) = 'object' THEN jsonb_build_array(${jsonExpr})
        ELSE ${parsedTextArray}
      END)`;
  }

  formatRating(expr: string): string {
    return `CASE WHEN (${expr} = ROUND(${expr})) THEN ROUND(${expr})::TEXT ELSE (${expr})::TEXT END`;
  }

  private escapeLiteral(value: string): string {
    return value.replace(/'/g, "''");
  }

  private getDatePattern(date: string): string {
    switch (date as DateFormattingPreset) {
      case DateFormattingPreset.US:
        return 'FMMM/FMDD/YYYY';
      case DateFormattingPreset.European:
        return 'FMDD/FMMM/YYYY';
      case DateFormattingPreset.Asian:
        return 'YYYY/MM/DD';
      case DateFormattingPreset.ISO:
        return 'YYYY-MM-DD';
      case DateFormattingPreset.YM:
        return 'YYYY-MM';
      case DateFormattingPreset.MD:
        return 'MM-DD';
      case DateFormattingPreset.Y:
        return 'YYYY';
      case DateFormattingPreset.M:
        return 'MM';
      case DateFormattingPreset.D:
        return 'DD';
      default:
        return 'YYYY-MM-DD';
    }
  }

  private getTimePattern(time: TimeFormatting | undefined): string | null {
    switch (time) {
      case TimeFormatting.Hour24:
        return 'HH24:MI';
      case TimeFormatting.Hour12:
        return 'HH12:MI AM';
      default:
        return null;
    }
  }

  private buildDateFormattingExpression(
    valueExpression: string,
    formatting: IDatetimeFormatting
  ): string {
    const { date, time, timeZone } = formatting;
    const timePattern = this.getTimePattern(time ?? TimeFormatting.None);
    const datePattern = this.getDatePattern(date);
    const pattern = timePattern ? `${datePattern} ${timePattern}` : datePattern;
    const tz = this.escapeLiteral(timeZone ?? 'UTC');
    const patternLiteral = this.escapeLiteral(pattern);
    return `TO_CHAR(TIMEZONE('${tz}', (${valueExpression})::timestamptz), '${patternLiteral}')`;
  }

  formatDate(expr: string, formatting: IDatetimeFormatting): string {
    return this.buildDateFormattingExpression(expr, formatting);
  }

  formatDateArray(expr: string, formatting: IDatetimeFormatting): string {
    const elementExpr = this.buildDateFormattingExpression("(elem #>> '{}')", formatting);
    return `(
        SELECT string_agg(
          CASE
            WHEN (elem #>> '{}') IS NULL THEN NULL
            ELSE ${elementExpr}
          END,
          ', '
          ORDER BY ord
        )
        FROM jsonb_array_elements(COALESCE((${expr})::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
      )`;
  }

  private hasWrappingParentheses(expr: string): boolean {
    if (!expr.startsWith('(') || !expr.endsWith(')')) {
      return false;
    }
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0 && i < expr.length - 1) {
          return false;
        }
        if (depth < 0) {
          return false;
        }
      }
    }
    return depth === 0;
  }

  private isNumericLiteral(expr: string): boolean {
    let trimmed = expr.trim();
    while (trimmed.length > 0 && this.hasWrappingParentheses(trimmed)) {
      trimmed = trimmed.slice(1, -1).trim();
    }
    // eslint-disable-next-line regexp/no-unused-capturing-group
    return /^[-+]?\d+(\.\d+)?$/.test(trimmed);
  }

  coerceToNumericForCompare(expr: string): string {
    // Same safe numeric coercion used for arithmetic
    if (this.isNumericLiteral(expr)) {
      return `(${expr})::numeric`;
    }
    const textExpr = `((${expr})::text)`;
    const sanitized = `REGEXP_REPLACE(${textExpr}, '[^0-9.+-]', '', 'g')`;
    return `NULLIF(${sanitized}, '')::numeric`;
  }

  linkHasAny(selectionSql: string): string {
    return `(${selectionSql} IS NOT NULL AND ${selectionSql}::text != 'null' AND ${selectionSql}::text != '[]')`;
  }

  linkExtractTitles(selectionSql: string, isMultiple: boolean): string {
    const normalized = `${selectionSql}::jsonb`;

    if (isMultiple) {
      return `(SELECT json_agg(value->>'title') FROM jsonb_array_elements(${normalized}) AS value)::jsonb`;
    }

    return `(CASE WHEN ${selectionSql} IS NULL THEN NULL ELSE (${normalized})->>'title' END)`;
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

  flattenLookupCteValue(
    cteName: string,
    fieldId: string,
    isMultiple: boolean,
    dbFieldType: DbFieldType
  ): string | null {
    if (!isMultiple) return null;
    const columnRef = `"${cteName}"."lookup_${fieldId}"`;
    const normalized =
      dbFieldType === DbFieldType.Json ? `${columnRef}::jsonb` : `to_jsonb(${columnRef})`;
    return `(
            WITH RECURSIVE f(e) AS (
              SELECT ${normalized}
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
    const normalizedExpr = this.normalizeJsonbAggregateInput(expression);
    // Use jsonb_agg so downstream consumers (persisted link/lookup columns) expecting jsonb
    // do not hit implicit cast issues during UPDATE ... FROM assignments.
    return `jsonb_agg(${normalizedExpr}${order}) FILTER (WHERE ${normalizedExpr} IS NOT NULL)`;
  }

  private normalizeJsonbAggregateInput(expression: string): string {
    const trimmed = expression.trim();
    if (!trimmed) {
      return expression;
    }
    const upper = trimmed.toUpperCase();
    if (upper === 'NULL') {
      return 'NULL::jsonb';
    }
    if (upper === 'NULL::JSONB') {
      return trimmed;
    }
    if (upper.startsWith('NULL::')) {
      return `(${expression})::jsonb`;
    }
    return expression;
  }

  stringAggregate(expression: string, delimiter: string, orderByClause?: string): string {
    const order = orderByClause ? ` ORDER BY ${orderByClause}` : '';
    return `STRING_AGG(${expression}::text, ${this.knex.raw('?', [delimiter]).toQuery()}${order})`;
  }

  jsonArrayLength(expr: string): string {
    return `jsonb_array_length(${expr}::jsonb)`;
  }

  nullJson(): string {
    return 'NULL::json';
  }

  typedNullFor(dbFieldType: DbFieldType): string {
    switch (dbFieldType) {
      case DbFieldType.Json:
        return 'NULL::jsonb';
      case DbFieldType.Integer:
        return 'NULL::integer';
      case DbFieldType.Real:
        return 'NULL::double precision';
      case DbFieldType.DateTime:
        return 'NULL::timestamptz';
      case DbFieldType.Boolean:
        return 'NULL::boolean';
      case DbFieldType.Blob:
        return 'NULL::bytea';
      case DbFieldType.Text:
      default:
        return 'NULL::text';
    }
  }

  private sanitizeNumericTextExpression(expression: string): string {
    const textExpr = `((${expression})::text)`;
    const sanitized = `REGEXP_REPLACE(${textExpr}, '[^0-9.+-]', '', 'g')`;
    return `NULLIF(${sanitized}, '')::double precision`;
  }

  private buildJsonNumericSumExpression(fieldExpression: string): string {
    const expr = `(${fieldExpression})`;
    const scalarValue = this.sanitizeNumericTextExpression(expr);
    const arraySum = `(SELECT SUM(${this.sanitizeNumericTextExpression('elem.value')})
        FROM jsonb_array_elements_text(${expr}::jsonb) AS elem(value))`;
    return `(CASE
      WHEN ${expr} IS NULL THEN 0
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN COALESCE(${arraySum}, 0)
      ELSE COALESCE(${scalarValue}, 0)
    END)`;
  }

  private buildJsonNumericCountExpression(fieldExpression: string): string {
    const expr = `(${fieldExpression})`;
    const scalarValue = this.sanitizeNumericTextExpression(expr);
    const scalarCount = `(CASE WHEN ${scalarValue} IS NULL THEN 0 ELSE 1 END)`;
    const elementCount = `(SELECT SUM(CASE WHEN ${this.sanitizeNumericTextExpression('elem.value')} IS NULL THEN 0 ELSE 1 END)
        FROM jsonb_array_elements_text(${expr}::jsonb) AS elem(value))`;
    return `(CASE
      WHEN ${expr} IS NULL THEN 0
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN COALESCE(${elementCount}, 0)
      ELSE ${scalarCount}
    END)`;
  }

  private castAgg(sql: string): string {
    // normalize to double precision for numeric rollups
    return `CAST(${sql} AS DOUBLE PRECISION)`;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  rollupAggregate(
    fn: string,
    fieldExpression: string,
    opts: {
      targetField?: FieldCore;
      orderByField?: string;
      rowPresenceExpr?: string;
      flattenNestedArray?: boolean;
    }
  ): string {
    const { targetField, orderByField, rowPresenceExpr, flattenNestedArray } = opts;
    const isNumericTarget =
      targetField?.type === FieldType.Number ||
      (targetField as unknown as { cellValueType?: CellValueType })?.cellValueType ===
        CellValueType.Number;

    switch (fn) {
      case 'sum':
        // Prefer numeric targets: number field or formula resolving to number
        if (isNumericTarget) {
          if (targetField?.isMultipleCellValue) {
            const numericExpr = this.buildJsonNumericSumExpression(fieldExpression);
            return this.castAgg(`COALESCE(SUM(${numericExpr}), 0)`);
          }
          return this.castAgg(`COALESCE(SUM(${fieldExpression}), 0)`);
        }
        // Non-numeric target: avoid SUM() casting errors
        return this.castAgg('SUM(0)');
      case 'average':
        if (isNumericTarget) {
          if (targetField?.isMultipleCellValue) {
            const sumExpr = this.buildJsonNumericSumExpression(fieldExpression);
            const countExpr = this.buildJsonNumericCountExpression(fieldExpression);
            const sumAgg = `COALESCE(SUM(${sumExpr}), 0)`;
            const countAgg = `COALESCE(SUM(${countExpr}), 0)`;
            return this.castAgg(
              `CASE WHEN ${countAgg} = 0 THEN 0 ELSE ${sumAgg} / ${countAgg} END`
            );
          }
          return this.castAgg(`COALESCE(AVG(${fieldExpression}), 0)`);
        }
        return this.castAgg('AVG(0)');
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
      case 'max': {
        const isDateFieldType =
          targetField?.type === FieldType.Date ||
          targetField?.type === FieldType.CreatedTime ||
          targetField?.type === FieldType.LastModifiedTime;
        const isDateTimeTarget =
          isDateFieldType ||
          targetField?.cellValueType === CellValueType.DateTime ||
          targetField?.dbFieldType === DbFieldType.DateTime;
        const aggregate = `MAX(${fieldExpression})`;
        return isDateTimeTarget ? aggregate : this.castAgg(aggregate);
      }
      case 'min': {
        const isDateFieldType =
          targetField?.type === FieldType.Date ||
          targetField?.type === FieldType.CreatedTime ||
          targetField?.type === FieldType.LastModifiedTime;
        const isDateTimeTarget =
          isDateFieldType ||
          targetField?.cellValueType === CellValueType.DateTime ||
          targetField?.dbFieldType === DbFieldType.DateTime;
        const aggregate = `MIN(${fieldExpression})`;
        return isDateTimeTarget ? aggregate : this.castAgg(aggregate);
      }
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
      case 'array_compact': {
        const buildAggregate = (expr: string) =>
          orderByField
            ? `jsonb_agg(${expr} ORDER BY ${orderByField}) FILTER (WHERE (${expr}) IS NOT NULL AND (${expr})::text <> '')`
            : `jsonb_agg(${expr}) FILTER (WHERE (${expr}) IS NOT NULL AND (${expr})::text <> '')`;
        const baseAggregate = buildAggregate(fieldExpression);
        if (flattenNestedArray) {
          return `(WITH RECURSIVE flattened(val) AS (
              SELECT COALESCE(${baseAggregate}, '[]'::jsonb)
              UNION ALL
              SELECT elem
              FROM flattened
              CROSS JOIN LATERAL jsonb_array_elements(flattened.val) AS elem
              WHERE jsonb_typeof(flattened.val) = 'array'
            )
            SELECT jsonb_agg(val) FILTER (
              WHERE jsonb_typeof(val) <> 'array'
                AND jsonb_typeof(val) <> 'null'
                AND val <> '""'::jsonb
            ) FROM flattened)`;
        }
        return baseAggregate;
      }
      default:
        throw new Error(`Unsupported rollup function: ${fn}`);
    }
  }

  singleValueRollupAggregate(
    fn: string,
    fieldExpression: string,
    options: { rollupField: FieldCore; targetField: FieldCore }
  ): string {
    const requiresJsonArray = options.rollupField.dbFieldType === DbFieldType.Json;
    const needsFormatted =
      (options.targetField.type === FieldType.Link ||
        options.targetField.type === FieldType.Formula ||
        options.targetField.type === FieldType.ConditionalRollup) &&
      (fn === 'array_join' ||
        fn === 'concatenate' ||
        fn === 'array_unique' ||
        fn === 'array_compact');
    const formattedExpr = needsFormatted
      ? options.targetField.accept(new FieldFormattingVisitor(fieldExpression, this))
      : fieldExpression;
    const exprForAggregation = needsFormatted ? formattedExpr : fieldExpression;
    switch (fn) {
      case 'sum':
      case 'average':
        // For single-value relationships, SUM reduces to the value itself.
        // Coalesce to 0 and cast to double precision for numeric stability.
        // If the expression is non-numeric, upstream rollup setup should avoid SUM on such targets.
        return `COALESCE(CAST(${fieldExpression} AS DOUBLE PRECISION), 0)`;
      case 'max':
      case 'min':
      case 'array_join':
      case 'concatenate':
        return `${exprForAggregation}`;
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
        if (!requiresJsonArray) {
          return `${fieldExpression}`;
        }
        return `(CASE WHEN ${fieldExpression} IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(${fieldExpression}) END)`;
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
