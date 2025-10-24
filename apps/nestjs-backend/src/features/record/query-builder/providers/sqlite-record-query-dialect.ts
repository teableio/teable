import type { INumberFormatting, ICurrencyFormatting, FieldCore } from '@teable/core';
import { DriverClient, FieldType, Relationship, DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQueryDialectProvider } from '../record-query-dialect.interface';

export class SqliteRecordQueryDialect implements IRecordQueryDialectProvider {
  readonly driver = DriverClient.Sqlite as const;

  constructor(private readonly knex: Knex) {}

  toText(expr: string): string {
    return `CAST(${expr} AS TEXT)`;
  }

  formatNumber(expr: string, formatting: INumberFormatting): string {
    const { type, precision } = formatting;
    switch (type) {
      case 'decimal':
        return `PRINTF('%.${precision ?? 0}f', ${expr})`;
      case 'percent':
        return `PRINTF('%.${precision ?? 0}f', ${expr} * 100) || '%'`;
      case 'currency': {
        const symbol = (formatting as ICurrencyFormatting).symbol || '$';
        if (typeof precision === 'number') {
          return `'${symbol}' || PRINTF('%.${precision}f', ${expr})`;
        }
        return `'${symbol}' || CAST(${expr} AS TEXT)`;
      }
      default:
        return `CAST(${expr} AS TEXT)`;
    }
  }

  formatNumberArray(expr: string, formatting: INumberFormatting): string {
    const elemNumExpr = `CAST(json_extract(value, '$') AS NUMERIC)`;
    const formatted = this.formatNumber(elemNumExpr, formatting).replace(
      /CAST\(json_extract\(value, '\$'\) AS NUMERIC\)/g,
      elemNumExpr
    );
    const safeArrayExpr = `CASE WHEN json_valid(${expr}) THEN ${expr} ELSE json('[]') END`;
    return `(
        SELECT GROUP_CONCAT(${formatted}, ', ')
        FROM json_each(${safeArrayExpr})
        ORDER BY key
      )`;
  }

  formatStringArray(expr: string): string {
    const safeArrayExpr = `CASE WHEN json_valid(${expr}) THEN ${expr} ELSE json('[]') END`;
    return `(
        SELECT GROUP_CONCAT(
          CASE
            WHEN json_type(value) = 'text' THEN json_extract(value, '$')
            WHEN json_type(value) = 'object' THEN json_extract(value, '$.title')
            ELSE value
          END,
          ', '
        )
        FROM json_each(${safeArrayExpr})
        ORDER BY key
      )`;
  }

  formatRating(expr: string): string {
    return `CASE WHEN (${expr} = CAST(${expr} AS INTEGER)) THEN CAST(CAST(${expr} AS INTEGER) AS TEXT) ELSE CAST(${expr} AS TEXT) END`;
  }

  coerceToNumericForCompare(expr: string): string {
    return `CAST(${expr} AS NUMERIC)`;
  }

  linkHasAny(selectionSql: string): string {
    return `(${selectionSql} IS NOT NULL AND ${selectionSql} != 'null' AND ${selectionSql} != '[]')`;
  }

  linkExtractTitles(selectionSql: string, isMultiple: boolean): string {
    if (isMultiple) {
      return `(
        SELECT json_group_array(json_extract(value, '$.title'))
        FROM json_each(CASE WHEN json_valid(${selectionSql}) AND json_type(${selectionSql}) = 'array' THEN ${selectionSql} ELSE json('[]') END) AS value
        ORDER BY key
      )`;
    }
    return `json_extract(${selectionSql}, '$.title')`;
  }

  jsonTitleFromExpr(selectionSql: string): string {
    return `json_extract(${selectionSql}, '$.title')`;
  }

  selectUserNameById(idRef: string): string {
    return `(SELECT name FROM users WHERE id = ${idRef})`;
  }

  buildUserJsonObjectById(idRef: string): string {
    return `json_object(
        'id', ${idRef},
        'title', (SELECT name FROM users WHERE id = ${idRef}),
        'email', (SELECT email FROM users WHERE id = ${idRef})
      )`;
  }

  flattenLookupCteValue(_cteName: string, _fieldId: string, _isMultiple: boolean): string | null {
    return null;
  }

  jsonAggregateNonNull(expression: string): string {
    return `json_group_array(CASE WHEN ${expression} IS NOT NULL THEN ${expression} END)`;
  }

  stringAggregate(expression: string, delimiter: string): string {
    return `GROUP_CONCAT(${expression}, ${this.knex.raw('?', [delimiter]).toQuery()})`;
  }

  jsonArrayLength(expr: string): string {
    return `json_array_length(${expr})`;
  }

  nullJson(): string {
    return 'NULL';
  }

  typedNullFor(_dbFieldType: DbFieldType): string {
    // SQLite does not require type-specific NULL casts
    return 'NULL';
  }

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
    const { targetField } = opts;
    switch (fn) {
      case 'sum':
        return `COALESCE(SUM(${fieldExpression}), 0)`;
      case 'average':
        return `COALESCE(AVG(${fieldExpression}), 0)`;
      case 'count':
        return `COALESCE(COUNT(${fieldExpression}), 0)`;
      case 'countall': {
        if (targetField?.type === FieldType.MultipleSelect) {
          return `COALESCE(SUM(CASE WHEN ${fieldExpression} IS NOT NULL THEN json_array_length(${fieldExpression}) ELSE 0 END), 0)`;
        }
        return `COALESCE(COUNT(${opts.rowPresenceExpr ?? fieldExpression}), 0)`;
      }
      case 'counta':
        return `COALESCE(COUNT(${fieldExpression}), 0)`;
      case 'max':
        return `MAX(${fieldExpression})`;
      case 'min':
        return `MIN(${fieldExpression})`;
      case 'and':
        return `MIN(${fieldExpression})`;
      case 'or':
        return `MAX(${fieldExpression})`;
      case 'xor':
        return `(COUNT(CASE WHEN ${fieldExpression} THEN 1 END) % 2 = 1)`;
      case 'array_join':
      case 'concatenate':
        return `GROUP_CONCAT(${fieldExpression}, ', ')`;
      case 'array_unique':
        return `json_group_array(DISTINCT ${fieldExpression})`;
      case 'array_compact':
        return `json_group_array(CASE WHEN ${fieldExpression} IS NOT NULL AND CAST(${fieldExpression} AS TEXT) <> '' THEN ${fieldExpression} END)`;
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
    switch (fn) {
      case 'sum':
      case 'average':
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
        return `(CASE WHEN ${fieldExpression} THEN 1 ELSE 0 END)`;
      case 'array_unique':
      case 'array_compact':
        if (!requiresJsonArray) {
          return `${fieldExpression}`;
        }
        return `(CASE WHEN ${fieldExpression} IS NULL THEN json('[]') ELSE json_array(${fieldExpression}) END)`;
      default:
        return `${fieldExpression}`;
    }
  }

  buildLinkJsonObject(
    recordIdRef: string,
    formattedSelectionExpression: string,
    rawSelectionExpression: string
  ): string {
    return `CASE
          WHEN ${rawSelectionExpression} IS NOT NULL THEN json_object('id', ${recordIdRef}, 'title', ${formattedSelectionExpression})
          ELSE json_object('id', ${recordIdRef})
        END`;
  }

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
  ): void {
    // Apply deterministic ordering for SQLite when aggregating arrays
    const {
      relationship,
      usesJunctionTable,
      hasOrderColumn,
      junctionAlias,
      foreignAlias,
      selfKeyName,
    } = opts;
    if (usesJunctionTable) {
      if (hasOrderColumn) {
        qb.orderByRaw(`(CASE WHEN ${junctionAlias}."order" IS NULL THEN 0 ELSE 1 END) ASC`);
        qb.orderBy(`${junctionAlias}."order"`, 'asc');
      }
      qb.orderBy(`${junctionAlias}.__id`, 'asc');
    } else if (relationship === Relationship.OneMany) {
      if (hasOrderColumn) {
        qb.orderByRaw(
          `(CASE WHEN ${foreignAlias}.${selfKeyName}_order IS NULL THEN 0 ELSE 1 END) ASC`
        );
        qb.orderBy(`${foreignAlias}.${selfKeyName}_order`, 'asc');
      }
      qb.orderBy(`${foreignAlias}.__id`, 'asc');
    }
  }

  buildDeterministicLookupAggregate({
    tableDbName,
    mainAlias,
    foreignDbName,
    foreignAlias,
    linkFieldOrderColumn,
    linkFieldHasOrderColumn,
    usesJunctionTable,
    selfKeyName,
    foreignKeyName,
    recordIdRef,
    formattedSelectionExpression,
    rawSelectionExpression,
    linkFilterSubquerySql,
    junctionAlias,
  }: {
    tableDbName: string;
    mainAlias: string;
    foreignDbName: string;
    foreignAlias: string;
    linkFieldOrderColumn?: string;
    linkFieldHasOrderColumn: boolean;
    usesJunctionTable: boolean;
    selfKeyName: string;
    foreignKeyName: string;
    recordIdRef: string;
    formattedSelectionExpression: string;
    rawSelectionExpression: string;
    linkFilterSubquerySql?: string;
    junctionAlias: string;
  }): string | null {
    // Build correlated, ordered subquery aggregation for SQLite multi-value lookup
    const innerIdRef = `"f"."__id"`;
    const innerTitleExpr = formattedSelectionExpression.replaceAll(`"${foreignAlias}"`, '"f"');
    const innerRawExpr = rawSelectionExpression.replaceAll(`"${foreignAlias}"`, '"f"');
    const innerJson = `CASE WHEN ${innerRawExpr} IS NOT NULL THEN json_object('id', ${innerIdRef}, 'title', ${innerTitleExpr}) ELSE json_object('id', ${innerIdRef}) END`;
    const innerFilter = linkFilterSubquerySql
      ? `(EXISTS ${linkFilterSubquerySql.replaceAll(`"${foreignAlias}"`, '"f"')})`
      : '1=1';

    if (usesJunctionTable) {
      // Prefer preserved insertion order via junction __id; add stable tie-breaker on foreign id
      const order =
        linkFieldHasOrderColumn && linkFieldOrderColumn
          ? `(CASE WHEN ${linkFieldOrderColumn} IS NULL THEN 0 ELSE 1 END) ASC, ${linkFieldOrderColumn} ASC, ${junctionAlias}."__id" ASC, f."__id" ASC`
          : `${junctionAlias}."__id" ASC, f."__id" ASC`;
      return `(
              SELECT CASE WHEN SUM(CASE WHEN ${innerFilter} THEN 1 ELSE 0 END) > 0
                THEN (
                  SELECT json_group_array(json(item)) FROM (
                    SELECT ${innerJson} AS item
                    FROM "${tableDbName}" AS m
                    JOIN "${junctionAlias}" AS j ON m."__id" = j."${selfKeyName}"
                    JOIN "${foreignDbName}" AS f ON j."${foreignKeyName}" = f."__id"
                    WHERE m."__id" = "${mainAlias}"."__id" AND (${innerFilter})
                    ORDER BY ${order}
                  )
                )
                ELSE NULL END
              FROM "${junctionAlias}" AS j
              JOIN "${foreignDbName}" AS f ON j."${foreignKeyName}" = f."__id"
              WHERE j."${selfKeyName}" = "${mainAlias}"."__id"
            )`;
    }

    const ordCol = linkFieldHasOrderColumn ? `f."${selfKeyName}_order"` : undefined;
    const order = ordCol
      ? `(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC, ${ordCol} ASC, f."__id" ASC`
      : `f."__id" ASC`;
    return `(
            SELECT CASE WHEN SUM(CASE WHEN ${innerFilter} THEN 1 ELSE 0 END) > 0
              THEN (
                SELECT json_group_array(json(item)) FROM (
                  SELECT ${innerJson} AS item
                  FROM "${foreignDbName}" AS f
                  WHERE f."${selfKeyName}" = "${mainAlias}"."__id" AND (${innerFilter})
                  ORDER BY ${order}
                )
              )
              ELSE NULL END
            FROM "${foreignDbName}" AS f
            WHERE f."${selfKeyName}" = "${mainAlias}"."__id"
          )`;
  }
}
