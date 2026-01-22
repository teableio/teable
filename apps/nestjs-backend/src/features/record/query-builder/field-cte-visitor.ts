/* eslint-disable sonarjs/no-collapsible-if */
/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-duplicated-branches */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-empty-function */
import { Logger } from '@nestjs/common';
import {
  DriverClient,
  FieldType,
  Relationship,
  type IFilter,
  type IFilterItem,
  type IFieldVisitor,
  type AttachmentFieldCore,
  type AutoNumberFieldCore,
  type CheckboxFieldCore,
  type CreatedByFieldCore,
  type CreatedTimeFieldCore,
  type DateFieldCore,
  type FormulaFieldCore,
  type LastModifiedByFieldCore,
  type LastModifiedTimeFieldCore,
  type LinkFieldCore,
  type LongTextFieldCore,
  type MultipleSelectFieldCore,
  type NumberFieldCore,
  type RatingFieldCore,
  type RollupFieldCore,
  type ConditionalRollupFieldCore,
  type IConditionalLookupOptions,
  type SingleLineTextFieldCore,
  type SingleSelectFieldCore,
  type UserFieldCore,
  type ButtonFieldCore,
  type Tables,
  type TableDomain,
  type ILinkFieldOptions,
  type FieldCore,
  type IRollupFieldOptions,
  DbFieldType,
  CellValueType,
  extractFieldIdsFromFilter,
  SortFunc,
  isFieldReferenceValue,
  isLinkLookupOptions,
  normalizeConditionalLimit,
  contains as FilterOperatorContains,
  doesNotContain as FilterOperatorDoesNotContain,
  hasAllOf as FilterOperatorHasAllOf,
  hasAnyOf as FilterOperatorHasAnyOf,
  hasNoneOf as FilterOperatorHasNoneOf,
  is as FilterOperatorIs,
  isAfter as FilterOperatorIsAfter,
  isAnyOf as FilterOperatorIsAnyOf,
  isBefore as FilterOperatorIsBefore,
  isExactly as FilterOperatorIsExactly,
  isGreater as FilterOperatorIsGreater,
  isGreaterEqual as FilterOperatorIsGreaterEqual,
  isLess as FilterOperatorIsLess,
  isLessEqual as FilterOperatorIsLessEqual,
  isNoneOf as FilterOperatorIsNoneOf,
  isNotEmpty as FilterOperatorIsNotEmpty,
  isNotExactly as FilterOperatorIsNotExactly,
  isEmpty as FilterOperatorIsEmpty,
  isOnOrAfter as FilterOperatorIsOnOrAfter,
  isOnOrBefore as FilterOperatorIsOnOrBefore,
} from '@teable/core';
import type { Knex } from 'knex';
import { match } from 'ts-pattern';
import type { IDbProvider } from '../../../db-provider/db.provider.interface';
import { ID_FIELD_NAME } from '../../field/constant';
import { FieldFormattingVisitor } from './field-formatting-visitor';
import { FieldSelectVisitor } from './field-select-visitor';
import type { IFieldSelectName } from './field-select.type';
import type {
  IMutableQueryBuilderState,
  IReadonlyQueryBuilderState,
} from './record-query-builder.interface';
import { RecordQueryBuilderManager, ScopedSelectionState } from './record-query-builder.manager';
import {
  getLinkUsesJunctionTable,
  getTableAliasFromTable,
  getOrderedFieldsByProjection,
  isDateLikeField,
} from './record-query-builder.util';
import type { IRecordQueryDialectProvider } from './record-query-dialect.interface';

type ICteResult = void;

const JUNCTION_ALIAS = 'j';

const SUPPORTED_EQUALITY_RESIDUAL_OPERATORS = new Set<string>([
  FilterOperatorIs.value,
  FilterOperatorContains.value,
  FilterOperatorDoesNotContain.value,
  FilterOperatorIsGreater.value,
  FilterOperatorIsGreaterEqual.value,
  FilterOperatorIsLess.value,
  FilterOperatorIsLessEqual.value,
  FilterOperatorIsEmpty.value,
  FilterOperatorIsNotEmpty.value,
  FilterOperatorIsAnyOf.value,
  FilterOperatorIsNoneOf.value,
  FilterOperatorHasAnyOf.value,
  FilterOperatorHasAllOf.value,
  FilterOperatorHasNoneOf.value,
  FilterOperatorIsExactly.value,
  FilterOperatorIsNotExactly.value,
  FilterOperatorIsBefore.value,
  FilterOperatorIsAfter.value,
  FilterOperatorIsOnOrBefore.value,
  FilterOperatorIsOnOrAfter.value,
]);

const JSON_AGG_FUNCTIONS = new Set(['array_compact', 'array_unique']);

function parseRollupFunctionName(expression: string): string {
  const match = expression.match(/^(\w+)\(\{values\}\)$/);
  if (!match) {
    throw new Error(`Invalid rollup expression: ${expression}`);
  }
  return match[1].toLowerCase();
}

function unwrapJsonAggregateForScalar(
  driver: DriverClient,
  expression: string,
  field: FieldCore,
  isJsonAggregate: boolean
): string {
  if (
    !isJsonAggregate ||
    field.isMultipleCellValue ||
    field.dbFieldType === DbFieldType.Json ||
    driver !== DriverClient.Pg
  ) {
    return expression;
  }
  return `(${expression}) ->> 0`;
}

class FieldCteSelectionVisitor implements IFieldVisitor<IFieldSelectName> {
  constructor(
    private readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly dialect: IRecordQueryDialectProvider,
    private readonly table: TableDomain,
    private readonly foreignTable: TableDomain,
    private readonly state: IReadonlyQueryBuilderState,
    private readonly joinedCtes?: Set<string>, // Track which CTEs are already JOINed in current scope
    private readonly isSingleValueRelationshipContext: boolean = false, // In ManyOne/OneOne CTEs, avoid aggregates
    private readonly foreignAliasOverride?: string,
    private readonly currentLinkFieldId?: string,
    private readonly blockedLinkFieldIds?: ReadonlySet<string>,
    private readonly readyLinkFieldIds?: ReadonlySet<string>
  ) {}
  private get fieldCteMap() {
    return this.state.getFieldCteMap();
  }
  private canReuseNestedCte(fieldId?: string): fieldId is string {
    return (
      !!fieldId &&
      this.fieldCteMap.has(fieldId) &&
      fieldId !== this.currentLinkFieldId &&
      !this.blockedLinkFieldIds?.has(fieldId) &&
      (!!this.readyLinkFieldIds?.has(fieldId) || this.readyLinkFieldIds === undefined)
    );
  }

  private mergeBlockedLinkIds(
    extras?: Iterable<string | undefined>
  ): ReadonlySet<string> | undefined {
    if (!extras) {
      return this.blockedLinkFieldIds;
    }
    let result: Set<string> | undefined;
    const base = this.blockedLinkFieldIds;
    for (const id of extras) {
      if (!id) continue;
      if (base?.has(id)) continue;
      if (!result) {
        result = new Set(base ?? []);
      }
      result.add(id);
    }
    return result ?? base;
  }

  private getReadyLinkFieldIdsSnapshot(): ReadonlySet<string> | undefined {
    return this.readyLinkFieldIds ? new Set(this.readyLinkFieldIds) : undefined;
  }

  private createFieldSelectVisitor(
    table: TableDomain,
    alias?: string,
    rawProjection = true,
    preferRawFieldReferences = true,
    extraBlockedLinkIds?: Iterable<string | undefined>
  ): FieldSelectVisitor {
    // Only allow link CTE references that are actually joined in this scope; otherwise
    // the selector may emit a CTE reference that isn't present in FROM/JOIN, leading
    // to "missing FROM-clause" errors in nested rollup/lookups during computed updates.
    const scopedReadyLinkFieldIds = this.joinedCtes
      ? new Set(this.joinedCtes)
      : this.readyLinkFieldIds;
    return new FieldSelectVisitor(
      this.qb.client.queryBuilder(),
      this.dbProvider,
      table,
      new ScopedSelectionState(this.state),
      this.dialect,
      alias,
      rawProjection,
      preferRawFieldReferences,
      this.mergeBlockedLinkIds(extraBlockedLinkIds),
      scopedReadyLinkFieldIds,
      this.currentLinkFieldId
    );
  }
  private getForeignAlias(): string {
    return this.foreignAliasOverride || getTableAliasFromTable(this.foreignTable);
  }
  private getJsonAggregationFunction(fieldReference: string): string {
    return this.dialect.jsonAggregateNonNull(fieldReference);
  }

  private normalizeJsonAggregateExpression(expression: string): string {
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
  private buildPhysicalFieldExpression(field: FieldCore, alias: string): string {
    if (field.hasError) {
      return this.dialect.typedNullFor(field.dbFieldType);
    }
    return `"${alias}"."${field.dbFieldName}"`;
  }

  /**
   * Build a subquery (SELECT 1 WHERE ...) for foreign table filter using provider's filterQuery.
   * The subquery references the current foreign alias in-scope and carries proper bindings.
   */
  private buildForeignFilterSubquery(filter: IFilter): string {
    const foreignAlias = this.getForeignAlias();
    // Build selectionMap mapping foreign field ids to alias-qualified columns
    const selectionMap = new Map<string, string>();
    for (const f of this.foreignTable.fields.ordered) {
      selectionMap.set(f.id, `"${foreignAlias}"."${f.dbFieldName}"`);
    }
    // Build field map for filter compiler
    const fieldMap = this.foreignTable.fieldList.reduce(
      (map, f) => {
        map[f.id] = f as FieldCore;
        return map;
      },
      {} as Record<string, FieldCore>
    );
    // Build subquery with WHERE conditions
    const sub = this.qb.client.queryBuilder().select(this.qb.client.raw('1'));
    this.dbProvider
      .filterQuery(sub, fieldMap, filter, undefined, { selectionMap } as unknown as {
        selectionMap: Map<string, string>;
      })
      .appendQueryBuilder();
    return `(${sub.toQuery()})`;
  }

  private unwrapSelectName(selection: IFieldSelectName | string): string {
    return typeof selection === 'string' ? selection : selection.toQuery();
  }
  /**
   * Generate rollup aggregation expression based on rollup function
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private generateRollupAggregation(
    expression: string,
    fieldExpression: string,
    targetField: FieldCore,
    orderByField?: string,
    rowPresenceExpr?: string
  ): string {
    const functionName = parseRollupFunctionName(expression);
    return this.dialect.rollupAggregate(functionName, fieldExpression, {
      targetField,
      orderByField,
      rowPresenceExpr,
    });
  }

  /**
   * Generate rollup expression for single-value relationships (ManyOne/OneOne)
   * Avoids using aggregate functions so GROUP BY is not required.
   */
  private generateSingleValueRollupAggregation(
    rollupField: FieldCore,
    targetField: FieldCore,
    expression: string,
    fieldExpression: string
  ): string {
    const functionName = parseRollupFunctionName(expression);
    return this.dialect.singleValueRollupAggregate(functionName, fieldExpression, {
      rollupField,
      targetField,
    });
  }
  private buildSingleValueRollup(
    field: FieldCore,
    targetField: FieldCore,
    expression: string
  ): string {
    const rollupOptions = field.options as IRollupFieldOptions;
    const rollupFilter = (field as FieldCore).getFilter?.();
    if (rollupFilter) {
      const sub = this.buildForeignFilterSubquery(rollupFilter);
      const filteredExpr =
        this.dbProvider.driver === DriverClient.Pg
          ? `CASE WHEN EXISTS ${sub} THEN ${expression} ELSE NULL END`
          : expression;
      return this.generateSingleValueRollupAggregation(
        field,
        targetField,
        rollupOptions.expression,
        filteredExpr
      );
    }
    return this.generateSingleValueRollupAggregation(
      field,
      targetField,
      rollupOptions.expression,
      expression
    );
  }
  private buildAggregateRollup(
    rollupField: FieldCore,
    targetField: FieldCore,
    expression: string
  ): string {
    const linkField = rollupField.getLinkField(this.table);
    const options = linkField?.options as ILinkFieldOptions | undefined;
    const rollupOptions = rollupField.options as IRollupFieldOptions;

    let orderByField: string | undefined;
    if (this.dbProvider.driver === DriverClient.Pg && linkField && options) {
      const usesJunctionTable = getLinkUsesJunctionTable(linkField);
      const hasOrderColumn = linkField.getHasOrderColumn();
      if (usesJunctionTable) {
        orderByField = hasOrderColumn
          ? `${JUNCTION_ALIAS}."${linkField.getOrderColumnName()}" IS NULL DESC, ${JUNCTION_ALIAS}."${linkField.getOrderColumnName()}" ASC, ${JUNCTION_ALIAS}."__id" ASC`
          : `${JUNCTION_ALIAS}."__id" ASC`;
      } else if (options.relationship === Relationship.OneMany) {
        const foreignAlias = this.getForeignAlias();
        orderByField = hasOrderColumn
          ? `"${foreignAlias}"."${linkField.getOrderColumnName()}" IS NULL DESC, "${foreignAlias}"."${linkField.getOrderColumnName()}" ASC, "${foreignAlias}"."__id" ASC`
          : `"${foreignAlias}"."__id" ASC`;
      }
    }

    const rowPresenceField = `"${this.getForeignAlias()}"."__id"`;

    const rollupFunctionName = parseRollupFunctionName(rollupOptions.expression);
    const aggregatesToJson = JSON_AGG_FUNCTIONS.has(rollupFunctionName);
    const formattingVisitor = new FieldFormattingVisitor(expression, this.dialect);
    const formattedExpression = targetField.accept(formattingVisitor);
    const useFormattedForArrayFunctions =
      (targetField.type === FieldType.Link ||
        targetField.type === FieldType.Formula ||
        targetField.type === FieldType.ConditionalRollup) &&
      (rollupFunctionName === 'array_join' ||
        rollupFunctionName === 'concatenate' ||
        rollupFunctionName === 'array_unique' ||
        rollupFunctionName === 'array_compact');
    const aggregationInputExpression = useFormattedForArrayFunctions
      ? formattedExpression
      : expression;
    const buildAggregate = (expr: string) => {
      const aggregate = this.generateRollupAggregation(
        rollupOptions.expression,
        expr,
        targetField,
        orderByField,
        rowPresenceField
      );
      return unwrapJsonAggregateForScalar(
        this.dbProvider.driver,
        aggregate,
        rollupField,
        aggregatesToJson
      );
    };

    const rollupFilter = (rollupField as FieldCore).getFilter?.();
    if (rollupFilter && this.dbProvider.driver === DriverClient.Pg) {
      const sub = this.buildForeignFilterSubquery(rollupFilter);
      const filteredExpr = `CASE WHEN EXISTS ${sub} THEN ${aggregationInputExpression} ELSE NULL END`;
      return buildAggregate(filteredExpr);
    }

    return buildAggregate(aggregationInputExpression);
  }
  private visitLookupField(field: FieldCore): IFieldSelectName {
    if (!field.isLookup) {
      throw new Error('Not a lookup field');
    }

    // If this lookup field is marked as error, don't attempt to resolve.
    // Emit a typed NULL so the expression matches the physical column.
    if (field.hasError) {
      return this.dialect.typedNullFor(field.dbFieldType);
    }

    if (field.isConditionalLookup) {
      const cteName = this.fieldCteMap.get(field.id);
      if (!cteName) {
        // Log warning when conditional lookup CTE is missing
        const fieldCteMapKeys = Array.from(this.fieldCteMap.keys());
        console.warn(
          `[ConditionalLookup] CTE not found for field ${field.id} (${field.name}). ` +
            `Available CTEs: [${fieldCteMapKeys.join(', ')}]. ` +
            `Returning NULL::${field.dbFieldType}`
        );
        return this.dialect.typedNullFor(field.dbFieldType);
      }
      return `"${cteName}"."conditional_lookup_${field.id}"`;
    }

    const foreignAlias = this.getForeignAlias();
    const targetLookupField = field.getForeignLookupField(this.foreignTable);

    if (!targetLookupField) {
      // Try to fetch via the CTE of the foreign link if present
      const nestedLinkFieldId = getLinkFieldId(field.lookupOptions);
      const fieldCteMap = this.state.getFieldCteMap();
      // Guard against self-referencing the CTE being defined (would require WITH RECURSIVE)
      if (this.canReuseNestedCte(nestedLinkFieldId) && this.joinedCtes?.has(nestedLinkFieldId)) {
        const nestedCteName = fieldCteMap.get(nestedLinkFieldId)!;
        // Check if this CTE is JOINed in current scope
        const linkExpr = `"${nestedCteName}"."link_value"`;
        return this.isSingleValueRelationshipContext
          ? linkExpr
          : field.isMultipleCellValue
            ? this.getJsonAggregationFunction(linkExpr)
            : linkExpr;
      }
      // If still not found or field has error, return NULL instead of throwing
      return this.dialect.typedNullFor(field.dbFieldType);
    }

    // Prefer physical column values to avoid recursive formula/lookup expansion.
    let expression = this.buildPhysicalFieldExpression(targetLookupField, foreignAlias);

    // For Postgres multi-value lookups targeting datetime-like fields, normalize the
    // element expression to an ISO8601 UTC string so downstream JSON comparisons using
    // lexicographical ranges (jsonpath @ >= "..." && @ <= "...") behave correctly.
    // Do NOT alter single-value lookups to preserve native type comparisons in filters.
    if (
      this.dbProvider.driver === DriverClient.Pg &&
      field.isMultipleCellValue &&
      isDateLikeField(targetLookupField) &&
      targetLookupField.dbFieldType === DbFieldType.DateTime
    ) {
      // Format: 2020-01-10T16:00:00.000Z, wrap as jsonb so downstream aggregation remains valid JSON.
      const isoUtcExpr = `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
      expression = `to_jsonb(${isoUtcExpr})`;
    }
    // Build deterministic order-by for multi-value lookups using the link field configuration
    const linkForOrderingId = getLinkFieldId(field.lookupOptions);
    let orderByClause: string | undefined;
    if (linkForOrderingId) {
      try {
        const linkForOrdering = this.table.getField(linkForOrderingId) as LinkFieldCore;
        const usesJunctionTable = getLinkUsesJunctionTable(linkForOrdering);
        const hasOrderColumn = linkForOrdering.getHasOrderColumn();
        if (this.dbProvider.driver === DriverClient.Pg) {
          if (usesJunctionTable) {
            orderByClause = hasOrderColumn
              ? `${JUNCTION_ALIAS}."${linkForOrdering.getOrderColumnName()}" IS NULL DESC, ${JUNCTION_ALIAS}."${linkForOrdering.getOrderColumnName()}" ASC, ${JUNCTION_ALIAS}."__id" ASC`
              : `${JUNCTION_ALIAS}."__id" ASC`;
          } else {
            orderByClause = hasOrderColumn
              ? `"${foreignAlias}"."${linkForOrdering.getOrderColumnName()}" IS NULL DESC, "${foreignAlias}"."${linkForOrdering.getOrderColumnName()}" ASC, "${foreignAlias}"."__id" ASC`
              : `"${foreignAlias}"."__id" ASC`;
          }
        }
      } catch (_) {
        // ignore ordering if link field not found in current table context
      }
    }

    // Field-specific filter applied here
    const filter = field.getFilter?.();
    if (!filter) {
      if (!field.isMultipleCellValue || this.isSingleValueRelationshipContext) {
        return expression;
      }
      if (this.dbProvider.driver === DriverClient.Pg && orderByClause) {
        const sanitizedExpression = this.normalizeJsonAggregateExpression(expression);
        return `json_agg(${sanitizedExpression} ORDER BY ${orderByClause}) FILTER (WHERE ${sanitizedExpression} IS NOT NULL)`;
      }
      // For SQLite, ensure deterministic ordering by aggregating from an ordered correlated subquery
      if (this.dbProvider.driver === DriverClient.Sqlite) {
        try {
          const linkForOrderingId = getLinkFieldId(field.lookupOptions);
          const fieldCteMap = this.state.getFieldCteMap();
          const mainAlias = getTableAliasFromTable(this.table);
          const foreignDb = this.foreignTable.dbTableName;
          // Prefer order from link CTE's JSON array (preserves insertion order)
          if (
            linkForOrderingId &&
            fieldCteMap.has(linkForOrderingId) &&
            this.joinedCtes?.has(linkForOrderingId) &&
            linkForOrderingId !== this.currentLinkFieldId
          ) {
            const cteName = fieldCteMap.get(linkForOrderingId)!;
            const exprForInner = expression.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
            return `(
              SELECT CASE WHEN COUNT(*) > 0
                THEN json_group_array(CASE WHEN ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
                ELSE NULL END
              FROM json_each(
                CASE
                  WHEN json_valid((SELECT "link_value" FROM "${cteName}" WHERE "${cteName}"."main_record_id" = "${mainAlias}"."__id"))
                   AND json_type((SELECT "link_value" FROM "${cteName}" WHERE "${cteName}"."main_record_id" = "${mainAlias}"."__id")) = 'array'
                  THEN (SELECT "link_value" FROM "${cteName}" WHERE "${cteName}"."main_record_id" = "${mainAlias}"."__id")
                  ELSE json('[]')
                END
              ) AS je
              JOIN "${foreignDb}" AS f ON f."__id" = json_extract(je.value, '$.id')
              ORDER BY je.key ASC
            )`;
          }
          // Fallback to FK/junction ordering using the current link field
          const baseLink = field as LinkFieldCore;
          const opts = baseLink.options as ILinkFieldOptions;
          const usesJunctionTable = getLinkUsesJunctionTable(baseLink);
          const hasOrderColumn = baseLink.getHasOrderColumn();
          const fkHost = opts.fkHostTableName!;
          const selfKey = opts.selfKeyName;
          const foreignKey = opts.foreignKeyName;
          const exprForInner = expression.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
          if (usesJunctionTable) {
            const ordCol = hasOrderColumn ? `j."${baseLink.getOrderColumnName()}"` : undefined;
            const order = ordCol
              ? `(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC, ${ordCol} ASC, j."__id" ASC`
              : `j."__id" ASC`;
            return `(
              SELECT CASE WHEN COUNT(*) > 0
                THEN json_group_array(CASE WHEN ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
                ELSE NULL END
              FROM "${fkHost}" AS j
              JOIN "${foreignDb}" AS f ON j."${foreignKey}" = f."__id"
              WHERE j."${selfKey}" = "${mainAlias}"."__id"
              ORDER BY ${order}
            )`;
          }
          const ordCol = hasOrderColumn ? `f."${opts.selfKeyName}_order"` : undefined;
          const order = ordCol
            ? `(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC, ${ordCol} ASC, f."__id" ASC`
            : `f."__id" ASC`;
          return `(
            SELECT CASE WHEN COUNT(*) > 0
              THEN json_group_array(CASE WHEN ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
              ELSE NULL END
            FROM "${foreignDb}" AS f
            WHERE f."${selfKey}" = "${mainAlias}"."__id"
            ORDER BY ${order}
          )`;
        } catch (_) {
          // fallback to non-deterministic aggregation
        }
      }
      return this.getJsonAggregationFunction(expression);
    }
    const sub = this.buildForeignFilterSubquery(filter);

    if (!field.isMultipleCellValue || this.isSingleValueRelationshipContext) {
      // Single value: conditionally null out for both PG and SQLite
      if (this.dbProvider.driver === DriverClient.Pg) {
        return `CASE WHEN EXISTS ${sub} THEN ${expression} ELSE NULL END`;
      }
      return `CASE WHEN EXISTS ${sub} THEN ${expression} ELSE NULL END`;
    }

    if (this.dbProvider.driver === DriverClient.Pg) {
      const sanitizedExpression = this.normalizeJsonAggregateExpression(expression);
      if (orderByClause) {
        return `json_agg(${sanitizedExpression} ORDER BY ${orderByClause}) FILTER (WHERE (EXISTS ${sub}) AND ${sanitizedExpression} IS NOT NULL)`;
      }
      return `json_agg(${sanitizedExpression}) FILTER (WHERE (EXISTS ${sub}) AND ${sanitizedExpression} IS NOT NULL)`;
    }

    // SQLite: use a correlated, ordered subquery to produce deterministic ordering
    try {
      const linkForOrderingId = getLinkFieldId(field.lookupOptions);
      const fieldCteMap = this.state.getFieldCteMap();
      const mainAlias = getTableAliasFromTable(this.table);
      const foreignDb = this.foreignTable.dbTableName;
      // Prefer order from link CTE JSON array
      if (
        linkForOrderingId &&
        fieldCteMap.has(linkForOrderingId) &&
        this.joinedCtes?.has(linkForOrderingId) &&
        linkForOrderingId !== this.currentLinkFieldId
      ) {
        const cteName = fieldCteMap.get(linkForOrderingId)!;
        const exprForInner = expression.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
        const subForInner = sub.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
        return `(
          SELECT CASE WHEN SUM(CASE WHEN (EXISTS ${subForInner}) THEN 1 ELSE 0 END) > 0
            THEN json_group_array(CASE WHEN (EXISTS ${subForInner}) AND ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
            ELSE NULL END
          FROM json_each(
            CASE
              WHEN json_valid((SELECT "link_value" FROM "${cteName}" WHERE "${cteName}"."main_record_id" = "${mainAlias}"."__id"))
               AND json_type((SELECT "link_value" FROM "${cteName}" WHERE "${cteName}"."main_record_id" = "${mainAlias}"."__id")) = 'array'
              THEN (SELECT "link_value" FROM "${cteName}" WHERE "${cteName}"."main_record_id" = "${mainAlias}"."__id")
              ELSE json('[]')
            END
          ) AS je
          JOIN "${foreignDb}" AS f ON f."__id" = json_extract(je.value, '$.id')
          ORDER BY je.key ASC
        )`;
      }
      if (linkForOrderingId) {
        const linkForOrdering = this.table.getField(linkForOrderingId) as LinkFieldCore;
        const opts = linkForOrdering.options as ILinkFieldOptions;
        const usesJunctionTable = getLinkUsesJunctionTable(linkForOrdering);
        const hasOrderColumn = linkForOrdering.getHasOrderColumn();
        const fkHost = opts.fkHostTableName!;
        const selfKey = opts.selfKeyName;
        const foreignKey = opts.foreignKeyName;
        // Adapt expression and filter subquery to inner alias "f"
        const exprForInner = expression.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
        const subForInner = sub.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
        if (usesJunctionTable) {
          const ordCol = hasOrderColumn ? `j."${linkForOrdering.getOrderColumnName()}"` : undefined;
          const order = ordCol
            ? `(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC, ${ordCol} ASC, j."__id" ASC`
            : `j."__id" ASC`;
          return `(
            SELECT CASE WHEN SUM(CASE WHEN (EXISTS ${subForInner}) THEN 1 ELSE 0 END) > 0
              THEN json_group_array(CASE WHEN (EXISTS ${subForInner}) AND ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
              ELSE NULL END
            FROM "${fkHost}" AS j
            JOIN "${foreignDb}" AS f ON j."${foreignKey}" = f."__id"
            WHERE j."${selfKey}" = "${mainAlias}"."__id"
            ORDER BY ${order}
          )`;
        } else {
          const ordCol = hasOrderColumn ? `f."${selfKey}_order"` : undefined;
          const order = ordCol
            ? `(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC, ${ordCol} ASC, f."__id" ASC`
            : `f."__id" ASC`;
          return `(
            SELECT CASE WHEN SUM(CASE WHEN (EXISTS ${subForInner}) THEN 1 ELSE 0 END) > 0
              THEN json_group_array(CASE WHEN (EXISTS ${subForInner}) AND ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
              ELSE NULL END
            FROM "${foreignDb}" AS f
            WHERE f."${selfKey}" = "${mainAlias}"."__id"
            ORDER BY ${order}
          )`;
        }
      }
      // Default ordering using the current link field
      const baseLink = field as LinkFieldCore;
      const opts = baseLink.options as ILinkFieldOptions;
      const usesJunctionTable = getLinkUsesJunctionTable(baseLink);
      const hasOrderColumn = baseLink.getHasOrderColumn();
      const fkHost = opts.fkHostTableName!;
      const selfKey = opts.selfKeyName;
      const foreignKey = opts.foreignKeyName;
      const exprForInner = expression.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
      const subForInner = sub.replaceAll(`"${this.getForeignAlias()}"`, '"f"');
      if (usesJunctionTable) {
        const ordCol = hasOrderColumn ? `j."${baseLink.getOrderColumnName()}"` : undefined;
        const order = ordCol
          ? `(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC, ${ordCol} ASC, j."__id" ASC`
          : `j."__id" ASC`;
        return `(
          SELECT CASE WHEN SUM(CASE WHEN (EXISTS ${subForInner}) THEN 1 ELSE 0 END) > 0
            THEN json_group_array(CASE WHEN (EXISTS ${subForInner}) AND ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
            ELSE NULL END
          FROM "${fkHost}" AS j
          JOIN "${foreignDb}" AS f ON j."${foreignKey}" = f."__id"
          WHERE j."${selfKey}" = "${mainAlias}"."__id"
          ORDER BY ${order}
        )`;
      }
      {
        const ordCol = hasOrderColumn ? `f."${selfKey}_order"` : undefined;
        const order = ordCol
          ? `(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC, ${ordCol} ASC, f."__id" ASC`
          : `f."__id" ASC`;
        return `(
          SELECT CASE WHEN SUM(CASE WHEN (EXISTS ${subForInner}) THEN 1 ELSE 0 END) > 0
            THEN json_group_array(CASE WHEN (EXISTS ${subForInner}) AND ${exprForInner} IS NOT NULL THEN ${exprForInner} END)
            ELSE NULL END
          FROM "${foreignDb}" AS f
          WHERE f."${selfKey}" = "${mainAlias}"."__id"
          ORDER BY ${order}
        )`;
      }
    } catch (_) {
      // fall back
    }
    // Fallback: emulate FILTER and null removal using CASE inside the aggregate
    return `json_group_array(CASE WHEN (EXISTS ${sub}) AND ${expression} IS NOT NULL THEN ${expression} END)`;
  }
  visitNumberField(field: NumberFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitSingleLineTextField(field: SingleLineTextFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLongTextField(field: LongTextFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitAttachmentField(field: AttachmentFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitCheckboxField(field: CheckboxFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitDateField(field: DateFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitRatingField(field: RatingFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitAutoNumberField(field: AutoNumberFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLinkField(field: LinkFieldCore): IFieldSelectName {
    // If this Link field is itself a lookup (lookup-of-link), treat it as a generic lookup
    // so we resolve via nested CTEs instead of using physical link options.
    if (field.isLookup) {
      return this.visitLookupField(field);
    }
    const foreignTable = this.foreignTable;
    const driver = this.dbProvider.driver;
    const junctionAlias = JUNCTION_ALIAS;

    const targetLookupField = foreignTable.mustGetField(field.options.lookupFieldId);
    const usesJunctionTable = getLinkUsesJunctionTable(field);
    const foreignTableAlias = this.getForeignAlias();
    const isMultiValue = field.getIsMultiValue();
    const hasOrderColumn = field.getHasOrderColumn();

    // Use table alias for cleaner SQL
    const recordIdRef = `"${foreignTableAlias}"."${ID_FIELD_NAME}"`;

    // Prefer physical column values to avoid recursive formula/lookup expansion.
    let rawSelectionExpression = this.buildPhysicalFieldExpression(
      targetLookupField,
      foreignTableAlias
    );

    // Apply field formatting to build the display expression
    const formattingVisitor = new FieldFormattingVisitor(rawSelectionExpression, this.dialect);
    let formattedSelectionExpression = targetLookupField.accept(formattingVisitor);
    // Self-join: ensure expressions use the foreign alias override
    const defaultForeignAlias = getTableAliasFromTable(foreignTable);
    if (defaultForeignAlias !== foreignTableAlias) {
      formattedSelectionExpression = formattedSelectionExpression.replaceAll(
        `"${defaultForeignAlias}"`,
        `"${foreignTableAlias}"`
      );
      rawSelectionExpression = rawSelectionExpression.replaceAll(
        `"${defaultForeignAlias}"`,
        `"${foreignTableAlias}"`
      );
    }

    // Determine if this relationship should return multiple values (array) or single value (object)
    // Apply field-level filter for Link (only affects this column)
    const linkFieldFilter = (field as FieldCore).getFilter?.();
    const linkFilterSub = linkFieldFilter
      ? this.buildForeignFilterSubquery(linkFieldFilter)
      : undefined;
    return match(driver)
      .with(DriverClient.Pg, () => {
        // Build JSON object with id and title, then strip null values to remove title key when null
        const conditionalJsonObject = this.dialect.buildLinkJsonObject(
          recordIdRef,
          formattedSelectionExpression,
          rawSelectionExpression
        );

        if (isMultiValue) {
          // Filter out null records and return empty array if no valid records exist
          // Build an ORDER BY clause with NULLS FIRST semantics and stable tie-breaks using __id

          const orderByClause = match({ usesJunctionTable, hasOrderColumn })
            .with({ usesJunctionTable: true, hasOrderColumn: true }, () => {
              // ManyMany with order column: NULLS FIRST, then order column ASC, then junction __id ASC
              const linkField = field as LinkFieldCore;
              const ord = `${junctionAlias}."${linkField.getOrderColumnName()}"`;
              return `${ord} IS NULL DESC, ${ord} ASC, ${junctionAlias}."__id" ASC`;
            })
            .with({ usesJunctionTable: true, hasOrderColumn: false }, () => {
              // ManyMany without order column: order by junction __id
              return `${junctionAlias}."__id" ASC`;
            })
            .with({ usesJunctionTable: false, hasOrderColumn: true }, () => {
              // OneMany/ManyOne/OneOne with order column: NULLS FIRST, then order ASC, then foreign __id ASC
              const linkField = field as LinkFieldCore;
              const ord = `"${foreignTableAlias}"."${linkField.getOrderColumnName()}"`;
              return `${ord} IS NULL DESC, ${ord} ASC, "${foreignTableAlias}"."__id" ASC`;
            })
            .with({ usesJunctionTable: false, hasOrderColumn: false }, () => `${recordIdRef} ASC`) // Fallback to record ID if no order column is available
            .exhaustive();

          const baseFilter = `${recordIdRef} IS NOT NULL`;
          const appliedFilter = linkFilterSub
            ? `(EXISTS ${linkFilterSub}) AND ${baseFilter}`
            : baseFilter;
          const sanitizedExpression = this.normalizeJsonAggregateExpression(conditionalJsonObject);
          return `json_agg(${sanitizedExpression} ORDER BY ${orderByClause}) FILTER (WHERE ${appliedFilter})`;
        } else {
          // For single value relationships (ManyOne, OneOne) always return a single object or null
          const cond = linkFilterSub
            ? `${recordIdRef} IS NOT NULL AND EXISTS ${linkFilterSub}`
            : `${recordIdRef} IS NOT NULL`;
          return `CASE WHEN ${cond} THEN ${conditionalJsonObject} ELSE NULL END`;
        }
      })
      .with(DriverClient.Sqlite, () => {
        // Create conditional JSON object that only includes title if it's not null
        const conditionalJsonObject = this.dialect.buildLinkJsonObject(
          recordIdRef,
          formattedSelectionExpression,
          rawSelectionExpression
        );

        if (isMultiValue) {
          // For SQLite, build a correlated, ordered subquery to ensure deterministic ordering
          const mainAlias = getTableAliasFromTable(this.table);
          const foreignDb = this.foreignTable.dbTableName;
          const usesJunctionTable = getLinkUsesJunctionTable(field);
          const hasOrderColumn = field.getHasOrderColumn();

          const innerIdRef = `"f"."${ID_FIELD_NAME}"`;
          const innerTitleExpr = formattedSelectionExpression.replaceAll(
            `"${foreignTableAlias}"`,
            '"f"'
          );
          const innerRawExpr = rawSelectionExpression.replaceAll(`"${foreignTableAlias}"`, '"f"');
          const innerJson = `CASE WHEN ${innerRawExpr} IS NOT NULL THEN json_object('id', ${innerIdRef}, 'title', ${innerTitleExpr}) ELSE json_object('id', ${innerIdRef}) END`;
          const innerFilter = linkFilterSub
            ? `(EXISTS ${linkFilterSub.replaceAll(`"${foreignTableAlias}"`, '"f"')})`
            : '1=1';

          const opts = field.options as ILinkFieldOptions;
          return (
            this.dialect.buildDeterministicLookupAggregate({
              tableDbName: this.table.dbTableName,
              mainAlias: getTableAliasFromTable(this.table),
              foreignDbName: this.foreignTable.dbTableName,
              foreignAlias: foreignTableAlias,
              linkFieldOrderColumn: hasOrderColumn
                ? `${JUNCTION_ALIAS}."${field.getOrderColumnName()}"`
                : undefined,
              linkFieldHasOrderColumn: hasOrderColumn,
              usesJunctionTable,
              selfKeyName: opts.selfKeyName,
              foreignKeyName: opts.foreignKeyName,
              recordIdRef,
              formattedSelectionExpression,
              rawSelectionExpression,
              linkFilterSubquerySql: linkFilterSub,
              // Pass the actual junction table name here; the dialect will alias it as "j".
              junctionAlias: opts.fkHostTableName!,
            }) || this.getJsonAggregationFunction(conditionalJsonObject)
          );
        } else {
          const cond = linkFilterSub
            ? `${recordIdRef} IS NOT NULL AND EXISTS ${linkFilterSub}`
            : `${recordIdRef} IS NOT NULL`;
          return `CASE WHEN ${cond} THEN ${conditionalJsonObject} ELSE NULL END`;
        }
      })
      .otherwise(() => {
        throw new Error(`Unsupported database driver: ${driver}`);
      });
  }
  visitRollupField(field: RollupFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.visitLookupField(field);
    }

    // If rollup field is marked as error, don't attempt to resolve; just return NULL
    if (field.hasError) {
      return this.dialect.typedNullFor(field.dbFieldType);
    }

    const foreignAlias = this.getForeignAlias();
    const targetLookupField = field.getForeignLookupField(this.foreignTable);
    if (!targetLookupField) {
      return this.dialect.typedNullFor(field.dbFieldType);
    }
    // Prefer physical column values to avoid recursive formula/lookup expansion.
    const expression = this.buildPhysicalFieldExpression(targetLookupField, foreignAlias);
    const linkField = field.getLinkField(this.table);
    const options = linkField?.options as ILinkFieldOptions;
    const isSingleValueRelationship =
      options.relationship === Relationship.ManyOne || options.relationship === Relationship.OneOne;

    if (isSingleValueRelationship) {
      return this.buildSingleValueRollup(field, targetLookupField, expression);
    }
    return this.buildAggregateRollup(field, targetLookupField, expression);
  }

  visitConditionalRollupField(field: ConditionalRollupFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.visitLookupField(field);
    }
    const cteName = this.fieldCteMap.get(field.id);
    if (!cteName) {
      return this.dialect.typedNullFor(field.dbFieldType);
    }

    return `"${cteName}"."conditional_rollup_${field.id}"`;
  }
  visitSingleSelectField(field: SingleSelectFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitMultipleSelectField(field: MultipleSelectFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitFormulaField(field: FormulaFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitCreatedTimeField(field: CreatedTimeFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitUserField(field: UserFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitCreatedByField(field: CreatedByFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLastModifiedByField(field: LastModifiedByFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitButtonField(field: ButtonFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
}

export class FieldCteVisitor implements IFieldVisitor<ICteResult> {
  private logger = new Logger(FieldCteVisitor.name);

  static generateCTENameForField(table: TableDomain, field: LinkFieldCore) {
    return `CTE_${getTableAliasFromTable(table)}_${field.id}`;
  }

  private readonly _table: TableDomain;
  private readonly state: IMutableQueryBuilderState;
  private readonly conditionalRollupGenerationStack = new Set<string>();
  private readonly conditionalLookupGenerationStack = new Set<string>();
  private readonly linkCteGenerationStack = new Set<string>();
  private readonly emittedLinkCteIds = new Set<string>();
  private readonly pendingLinkCteNames = new Map<string, string>();
  private filteredIdSet?: Set<string>;
  private readonly projection?: string[];
  private readonly expandFormulaReferences: boolean;

  constructor(
    public readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly tables: Tables,
    state: IMutableQueryBuilderState | undefined,
    private readonly dialect: IRecordQueryDialectProvider,
    projection?: string[],
    expandFormulaReferences: boolean = true
  ) {
    this.state = state ?? new RecordQueryBuilderManager('table');
    this._table = tables.mustGetEntryTable();
    this.projection = projection;
    this.expandFormulaReferences = expandFormulaReferences;
  }

  get table() {
    return this._table;
  }

  get fieldCteMap(): ReadonlyMap<string, string> {
    return this.state.getFieldCteMap();
  }

  private unwrapSelectName(selection: IFieldSelectName | string): string {
    return typeof selection === 'string' ? selection : selection.toQuery();
  }

  private getReadyLinkFieldIdsSnapshotForVisitor(): ReadonlySet<string> | undefined {
    return new Set(this.emittedLinkCteIds);
  }

  private createFieldSelectVisitor(
    table: TableDomain,
    alias?: string,
    rawProjection = true,
    preferRawFieldReferences = true,
    blockedLinkFieldIds?: Iterable<string | undefined>
  ): FieldSelectVisitor {
    let blocked: Set<string> | undefined;
    if (this.linkCteGenerationStack.size) {
      blocked = new Set(this.linkCteGenerationStack);
    }
    if (blockedLinkFieldIds) {
      for (const id of blockedLinkFieldIds) {
        if (!id) continue;
        if (!blocked) {
          blocked = new Set();
        }
        blocked.add(id);
      }
    }

    let currentLinkFieldId: string | undefined;
    for (const id of this.linkCteGenerationStack) {
      currentLinkFieldId = id;
    }
    return new FieldSelectVisitor(
      this.qb.client.queryBuilder(),
      this.dbProvider,
      table,
      new ScopedSelectionState(this.state),
      this.dialect,
      alias,
      rawProjection,
      preferRawFieldReferences,
      blocked,
      new Set(this.emittedLinkCteIds),
      currentLinkFieldId
    );
  }

  private getCteNameForField(fieldId: string): string | undefined {
    return this.state.getCteName(fieldId) ?? this.pendingLinkCteNames.get(fieldId);
  }

  private buildFieldReferenceContext(
    table: TableDomain,
    foreignTable: TableDomain,
    mainAlias: string,
    foreignAlias: string
  ): {
    fieldReferenceSelectionMap: Map<string, string>;
    fieldReferenceFieldMap: Map<string, FieldCore>;
  } {
    const fieldReferenceSelectionMap = new Map<string, string>();
    const fieldReferenceFieldMap = new Map<string, FieldCore>();

    if (table.id === foreignTable.id) {
      for (const field of table.fields.ordered) {
        fieldReferenceSelectionMap.set(field.id, `"${foreignAlias}"."${field.dbFieldName}"`);
        fieldReferenceFieldMap.set(field.id, field as FieldCore);
      }
      return { fieldReferenceSelectionMap, fieldReferenceFieldMap };
    }

    for (const field of table.fields.ordered) {
      fieldReferenceSelectionMap.set(field.id, `"${mainAlias}"."${field.dbFieldName}"`);
      fieldReferenceFieldMap.set(field.id, field as FieldCore);
    }

    for (const field of foreignTable.fields.ordered) {
      if (fieldReferenceSelectionMap.has(field.id)) continue;
      fieldReferenceSelectionMap.set(field.id, `"${foreignAlias}"."${field.dbFieldName}"`);
      fieldReferenceFieldMap.set(field.id, field as FieldCore);
    }

    return { fieldReferenceSelectionMap, fieldReferenceFieldMap };
  }

  private buildPhysicalFieldExpression(field: FieldCore, alias: string): string {
    if (field.hasError) {
      return this.dialect.typedNullFor(field.dbFieldType);
    }
    return `"${alias}"."${field.dbFieldName}"`;
  }

  private buildConditionalFilterSelectionMap(
    foreignTable: TableDomain,
    foreignAlias: string,
    filter: IFilter | null | undefined,
    selectVisitor: FieldSelectVisitor
  ): Map<string, string> {
    const selectionMap = new Map<string, string>();
    if (!filter) return selectionMap;

    const filterFieldIds = extractFieldIdsFromFilter(filter);
    for (const fieldId of filterFieldIds) {
      const field = foreignTable.getField(fieldId);
      if (!field) continue;
      let selection = this.buildPhysicalFieldExpression(field, foreignAlias);
      if (
        this.expandFormulaReferences &&
        (field.type === FieldType.ConditionalRollup || field.isConditionalLookup)
      ) {
        selection = this.resolveConditionalComputedTargetExpression(
          field,
          foreignTable,
          foreignAlias,
          selectVisitor
        );
      }
      selectionMap.set(field.id, selection);
    }

    return selectionMap;
  }

  private getBaseIdSubquery(): Knex.QueryBuilder | undefined {
    const baseCteName = this.state.getBaseCteName();
    if (!baseCteName) {
      return undefined;
    }
    return this.qb.client.queryBuilder().select(ID_FIELD_NAME).from(baseCteName);
  }

  private applyMainTableRestriction(builder: Knex.QueryBuilder, alias: string): void {
    const subquery = this.getBaseIdSubquery();
    if (!subquery) {
      return;
    }
    builder.whereIn(`${alias}.${ID_FIELD_NAME}`, subquery);
  }

  private withCte(
    name: string,
    builder: (qb: Knex.QueryBuilder) => void,
    opts?: { materialized?: boolean }
  ): void {
    const qbWithMaterialized = this.qb as Knex.QueryBuilder & {
      withMaterialized?: (
        alias: string,
        expression: Knex.QueryBuilder | ((qb: Knex.QueryBuilder) => void)
      ) => Knex.QueryBuilder;
    };
    if (opts?.materialized && typeof qbWithMaterialized.withMaterialized === 'function') {
      qbWithMaterialized.withMaterialized(name, builder);
      return;
    }
    this.qb.with(name, builder);
  }

  private fromTableWithRestriction(
    builder: Knex.QueryBuilder,
    table: TableDomain,
    alias: string
  ): void {
    const source =
      table.id === this.table.id
        ? this.state.getOriginalMainTableSource() ?? table.dbTableName
        : table.dbTableName;
    builder.from(`${source} as ${alias}`);
    if (table.id === this.table.id) {
      this.applyMainTableRestriction(builder, alias);
    }
  }

  private ensureLinkDependencyForScope(
    candidate: LinkFieldCore | null | undefined,
    foreignTable: TableDomain,
    currentLinkFieldId: string,
    nestedJoins: Set<string>
  ): void {
    if (!candidate?.id || candidate.id === currentLinkFieldId) {
      return;
    }
    // When the candidate link field is currently being generated higher up the stack,
    // avoid joining to its CTE (it does not exist yet and would create a cyclic dependency).
    if (this.linkCteGenerationStack.has(candidate.id)) {
      return;
    }
    if (!this.fieldCteMap.has(candidate.id)) {
      this.generateLinkFieldCteForTable(foreignTable, candidate);
    }
    // Only join nested CTEs that have already been materialized earlier in the WITH clause.
    if (this.fieldCteMap.has(candidate.id) && this.emittedLinkCteIds.has(candidate.id)) {
      nestedJoins.add(candidate.id);
    }
  }

  private getBlockedLinkFieldIds(currentLinkFieldId: string): ReadonlySet<string> | undefined {
    if (!this.linkCteGenerationStack.size) {
      return undefined;
    }
    const blocked = new Set(this.linkCteGenerationStack);
    return blocked.size ? blocked : undefined;
  }

  /**
   * Apply an explicit cast to align the SQL expression type with the target field's DB column type.
   * This prevents Postgres from rejecting UPDATE ... FROM assignments due to type mismatches
   * (e.g., assigning a text expression to a double precision column).
   */
  private castExpressionForDbType(expression: string, field: FieldCore): string {
    if (this.dbProvider.driver !== DriverClient.Pg) return expression;
    const castSuffix = (() => {
      switch (field.dbFieldType) {
        case DbFieldType.Json:
          return '::jsonb';
        case DbFieldType.Integer:
          return '::integer';
        case DbFieldType.Real:
          return '::double precision';
        case DbFieldType.DateTime:
          return '::timestamptz';
        case DbFieldType.Boolean:
          return '::boolean';
        case DbFieldType.Blob:
          return '::bytea';
        case DbFieldType.Text:
        default:
          return '::text';
      }
    })();
    return `(${expression})${castSuffix}`;
  }

  private rollupFunctionSupportsOrdering(expression: string): boolean {
    const fn = parseRollupFunctionName(expression);
    switch (fn) {
      case 'array_join':
      case 'array_compact':
      case 'concatenate':
        return true;
      default:
        return false;
    }
  }

  private buildConditionalRollupAggregation(
    rollupExpression: string,
    fieldExpression: string,
    targetField: FieldCore,
    foreignAlias: string,
    orderByClause?: string
  ): string {
    const fn = parseRollupFunctionName(rollupExpression);
    const shouldFlattenNestedArray =
      fn === 'array_compact' &&
      ((targetField?.isMultipleCellValue ?? false) || (targetField?.isConditionalLookup ?? false));
    return this.dialect.rollupAggregate(fn, fieldExpression, {
      targetField,
      rowPresenceExpr: `"${foreignAlias}"."${ID_FIELD_NAME}"`,
      orderByField: orderByClause,
      flattenNestedArray: shouldFlattenNestedArray,
    });
  }

  private extractConditionalEqualityJoinPlan(
    filter: IFilter | null | undefined,
    table: TableDomain,
    foreignTable: TableDomain,
    mainAlias: string,
    foreignAlias: string
  ): {
    joinKeys: Array<{ alias: string; hostExpr: string; foreignExpr: string }>;
    residualFilter: IFilter | null;
  } | null {
    if (!filter?.filterSet?.length) return null;

    const joinKeys: Array<{ alias: string; hostExpr: string; foreignExpr: string }> = [];

    type FilterNode = Exclude<IFilter, null>;

    const buildResidual = (
      current: IFilter | null | undefined
    ): { ok: boolean; residual: IFilter } => {
      if (!current?.filterSet?.length) return { ok: false, residual: null };
      const conjunction = current.conjunction ?? 'and';
      if (conjunction !== 'and') return { ok: false, residual: null };

      const residualEntries: Array<FilterNode | IFilterItem> = [];

      for (const entry of current.filterSet ?? []) {
        if (!entry) continue;
        if ('fieldId' in entry) {
          const item = entry as IFilterItem;

          if (item.operator === FilterOperatorIs.value && isFieldReferenceValue(item.value)) {
            const hostRef = item.value;
            if (hostRef.tableId && hostRef.tableId !== table.id) {
              return { ok: false, residual: null };
            }
            const foreignField = foreignTable.getField(item.fieldId);
            const hostField = table.getField(hostRef.fieldId);
            if (!foreignField || !hostField) {
              return { ok: false, residual: null };
            }
            if (isDateLikeField(foreignField) || isDateLikeField(hostField)) {
              return { ok: false, residual: null };
            }
            // When the foreign scope is the same table, compare the host record's fieldId
            // against the foreign row's referenced field so "Field A is {Field B}" reads as
            // host.FieldA = foreign.FieldB instead of the reverse.
            const hostJoinField = foreignTable.id === table.id ? foreignField : hostField;
            const foreignJoinField = foreignTable.id === table.id ? hostField : foreignField;
            const joinKey = this.buildConditionalEqualityJoinKey(
              hostJoinField,
              foreignJoinField,
              mainAlias,
              foreignAlias
            );
            if (!joinKey) {
              return { ok: false, residual: null };
            }
            const alias = `__cr_key_${joinKeys.length}`;
            joinKeys.push({ alias, ...joinKey });
            continue;
          }

          if (isFieldReferenceValue(item.value)) {
            return { ok: false, residual: null };
          }

          if (!SUPPORTED_EQUALITY_RESIDUAL_OPERATORS.has(item.operator)) {
            return { ok: false, residual: null };
          }

          residualEntries.push(entry);
          continue;
        }

        if ('filterSet' in entry) {
          const nested = buildResidual(entry as IFilter);
          if (!nested.ok) {
            return { ok: false, residual: null };
          }
          const nestedResidual = nested.residual;
          if (nestedResidual && 'filterSet' in nestedResidual && nestedResidual.filterSet?.length) {
            residualEntries.push(nestedResidual as FilterNode);
          }
          continue;
        }

        return { ok: false, residual: null };
      }

      if (!residualEntries.length) {
        return { ok: true, residual: null };
      }

      return {
        ok: true,
        residual: {
          conjunction,
          filterSet: residualEntries,
        } as FilterNode,
      };
    };

    const { ok, residual } = buildResidual(filter);
    if (!ok || !joinKeys.length) return null;
    return { joinKeys, residualFilter: residual };
  }

  private getConditionalEqualityFallback(aggregationFn: string, field: FieldCore): string | null {
    switch (aggregationFn) {
      case 'countall':
      case 'count':
      case 'sum':
      case 'average':
        return '0::double precision';
      case 'max':
      case 'min': {
        const dbType = field.dbFieldType ?? DbFieldType.Text;
        return this.dialect.typedNullFor(dbType);
      }
      default:
        return null;
    }
  }

  private buildConditionalEqualityJoinKey(
    hostField: FieldCore,
    foreignField: FieldCore,
    mainAlias: string,
    foreignAlias: string
  ): { hostExpr: string; foreignExpr: string } | null {
    const hostDbType = hostField.dbFieldType;
    const foreignDbType = foreignField.dbFieldType;
    const hostRef = `"${mainAlias}"."${hostField.dbFieldName}"`;
    const foreignRef = `"${foreignAlias}"."${foreignField.dbFieldName}"`;

    const isTextHost = hostDbType === DbFieldType.Text;
    const isTextForeign = foreignDbType === DbFieldType.Text;
    const isJsonHost = hostDbType === DbFieldType.Json;
    const isJsonForeign = foreignDbType === DbFieldType.Json;

    const isUserOrLinkField = (field: FieldCore) =>
      [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy, FieldType.Link].includes(
        field.type
      );

    if (
      isJsonHost &&
      isJsonForeign &&
      isUserOrLinkField(hostField) &&
      isUserOrLinkField(foreignField)
    ) {
      if (hostField.isMultipleCellValue || foreignField.isMultipleCellValue) {
        return null;
      }
      if (this.dbProvider.driver === DriverClient.Pg) {
        return {
          hostExpr: `jsonb_extract_path_text(${hostRef}::jsonb, 'id')`,
          foreignExpr: `jsonb_extract_path_text(${foreignRef}::jsonb, 'id')`,
        };
      }
      if (this.dbProvider.driver === DriverClient.Sqlite) {
        return {
          hostExpr: `json_extract(${hostRef}, '$.id')`,
          foreignExpr: `json_extract(${foreignRef}, '$.id')`,
        };
      }
    }

    // Exact type match (e.g., text-text, integer-integer)
    if (hostDbType === foreignDbType) {
      if (isTextHost && isTextForeign) {
        return { hostExpr: `LOWER(${hostRef})`, foreignExpr: `LOWER(${foreignRef})` };
      }
      return { hostExpr: hostRef, foreignExpr: foreignRef };
    }

    // Link-title equality against text fields (Postgres only).
    // When comparing a link field to a text field with "is" in conditional rollups,
    // match on linked record titles instead of the raw JSON payload. For multi-link
    // foreign fields, jsonb_path_query expands each title, so any matching title
    // satisfies the equality join.
    if (this.dbProvider.driver === DriverClient.Pg) {
      if (isTextHost && isJsonForeign && foreignField.type === FieldType.Link) {
        const path = foreignField.isMultipleCellValue ? '$[*].title' : '$.title';
        const hostExpr = `LOWER(${hostRef})`;
        const foreignExpr = `LOWER(jsonb_path_query(${foreignRef}::jsonb, '${path}') #>> '{}')`;
        return { hostExpr, foreignExpr };
      }

      if (isJsonHost && isTextForeign && hostField.type === FieldType.Link) {
        if (!hostField.isMultipleCellValue) {
          const path = '$.title';
          const hostExpr = `LOWER(jsonb_path_query(${hostRef}::jsonb, '${path}') #>> '{}')`;
          const foreignExpr = `LOWER(${foreignRef})`;
          return { hostExpr, foreignExpr };
        }
        // Multi-link on the host side can't be expanded without duplicating host rows.
        // Fall through to the generic text/json coercion.
      }
    }

    // Text/JSON combos: coerce both sides to text to avoid operator errors (text = jsonb)
    if ((isTextHost && isJsonForeign) || (isJsonHost && isTextForeign)) {
      const hostExpr = `LOWER((${hostRef})::text)`;
      const foreignExpr = `LOWER((${foreignRef})::text)`;
      return { hostExpr, foreignExpr };
    }

    return null;
  }

  private resolveConditionalComputedTargetExpression(
    targetField: FieldCore,
    foreignTable: TableDomain,
    foreignAlias: string,
    selectVisitor: FieldSelectVisitor
  ): string {
    if (
      !this.expandFormulaReferences &&
      (targetField.isLookup ||
        targetField.type === FieldType.Rollup ||
        targetField.type === FieldType.ConditionalRollup ||
        targetField.type === FieldType.Link)
    ) {
      return this.buildPhysicalFieldExpression(targetField, foreignAlias);
    }

    if (targetField.type === FieldType.ConditionalRollup) {
      const conditionalTarget = targetField as ConditionalRollupFieldCore;
      this.generateConditionalRollupFieldCteForScope(foreignTable, conditionalTarget);
      const nestedCteName = this.getCteNameForField(conditionalTarget.id);
      if (nestedCteName) {
        return `((SELECT "conditional_rollup_${conditionalTarget.id}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
      }
      const fallback = conditionalTarget.accept(selectVisitor);
      return this.unwrapSelectName(fallback);
    }

    if (targetField.isConditionalLookup) {
      const options = targetField.getConditionalLookupOptions?.();
      if (options) {
        this.generateConditionalLookupFieldCteForScope(foreignTable, targetField, options);
      }
      const nestedCteName = this.getCteNameForField(targetField.id);
      if (nestedCteName) {
        const column = `conditional_lookup_${targetField.id}`;
        return `((SELECT "${column}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
      }
    }

    const targetSelect = targetField.accept(selectVisitor);
    return this.unwrapSelectName(targetSelect);
  }

  private coerceConditionalLookupTargetExpression(
    expression: string,
    targetField: FieldCore
  ): string {
    if (targetField.isConditionalLookup || targetField.isMultipleCellValue) {
      return expression;
    }
    if (targetField.cellValueType === CellValueType.Number) {
      if (this.dbProvider.driver === DriverClient.Pg) {
        return `(${expression})::double precision`;
      }
      if (this.dbProvider.driver === DriverClient.Sqlite) {
        return `CAST(${expression} AS NUMERIC)`;
      }
    }
    if (targetField.cellValueType === CellValueType.Boolean) {
      if (this.dbProvider.driver === DriverClient.Pg) {
        return `(${expression})::boolean`;
      }
      if (this.dbProvider.driver === DriverClient.Sqlite) {
        return `CAST(${expression} AS NUMERIC)`;
      }
    }
    return expression;
  }

  private generateConditionalRollupFieldCte(field: ConditionalRollupFieldCore): void {
    this.generateConditionalRollupFieldCteForScope(this.table, field);
  }

  private generateConditionalRollupFieldCteForScope(
    table: TableDomain,
    field: ConditionalRollupFieldCore
  ): void {
    if (field.hasError) return;
    if (this.state.getFieldCteMap().has(field.id)) return;
    if (this.conditionalRollupGenerationStack.has(field.id)) return;

    this.conditionalRollupGenerationStack.add(field.id);
    try {
      const {
        foreignTableId,
        lookupFieldId,
        expression = 'countall({values})',
        filter,
        sort,
        limit,
      } = field.options;
      if (!foreignTableId || !lookupFieldId) {
        return;
      }

      const foreignTable = this.tables.getTable(foreignTableId);
      if (!foreignTable) {
        return;
      }

      const targetField = foreignTable.getField(lookupFieldId);
      if (!targetField) {
        return;
      }

      const joinToMain = table === this.table;

      const cteName = `CTE_REF_${field.id}`;
      const mainAlias = getTableAliasFromTable(table);
      const foreignAlias = getTableAliasFromTable(foreignTable);
      const foreignAliasUsed = foreignAlias === mainAlias ? `${foreignAlias}_ref` : foreignAlias;

      const selectVisitor = this.createFieldSelectVisitor(
        foreignTable,
        foreignAliasUsed,
        true,
        !this.expandFormulaReferences
      );

      const rawExpression = this.resolveConditionalComputedTargetExpression(
        targetField,
        foreignTable,
        foreignAliasUsed,
        selectVisitor
      );
      const normalizedExpression = this.coerceConditionalLookupTargetExpression(
        rawExpression,
        targetField
      );
      const formattingVisitor = new FieldFormattingVisitor(rawExpression, this.dialect);
      const formattedExpression = targetField.accept(formattingVisitor);

      const aggregationFn = parseRollupFunctionName(expression);
      const useFormattedForArrayFunctions =
        (targetField.type === FieldType.Link ||
          targetField.type === FieldType.Formula ||
          targetField.type === FieldType.ConditionalRollup) &&
        (aggregationFn === 'array_join' ||
          aggregationFn === 'concatenate' ||
          aggregationFn === 'array_unique' ||
          aggregationFn === 'array_compact');
      const aggregationInputExpression = useFormattedForArrayFunctions
        ? formattedExpression
        : rawExpression;

      const supportsOrdering = this.rollupFunctionSupportsOrdering(expression);

      let orderByClause: string | undefined;
      if (supportsOrdering && sort?.fieldId) {
        const sortField = foreignTable.getField(sort.fieldId);
        if (sortField) {
          let sortExpression = this.resolveConditionalComputedTargetExpression(
            sortField,
            foreignTable,
            foreignAliasUsed,
            selectVisitor
          );

          const defaultForeignAlias = getTableAliasFromTable(foreignTable);
          if (defaultForeignAlias !== foreignAliasUsed) {
            sortExpression = sortExpression.replaceAll(
              `"${defaultForeignAlias}"`,
              `"${foreignAliasUsed}"`
            );
          }

          const direction = sort.order === SortFunc.Desc ? 'DESC' : 'ASC';
          orderByClause = `${sortExpression} ${direction}`;
        }
      }

      const aggregateExpression = this.buildConditionalRollupAggregation(
        expression,
        aggregationInputExpression,
        targetField,
        foreignAliasUsed,
        supportsOrdering ? orderByClause : undefined
      );
      const aggregatesToJson = JSON_AGG_FUNCTIONS.has(aggregationFn);
      const normalizedAggregateExpression = unwrapJsonAggregateForScalar(
        this.dbProvider.driver,
        aggregateExpression,
        field,
        aggregatesToJson
      );
      const castedAggregateExpression = this.castExpressionForDbType(
        normalizedAggregateExpression,
        field
      );

      const equalityEnabledFns = new Set(['countall', 'count', 'sum', 'average', 'max', 'min']);
      const canUseEqualityPlan =
        equalityEnabledFns.has(aggregationFn) &&
        !supportsOrdering &&
        !orderByClause &&
        !sort?.fieldId;
      const equalityPlan = canUseEqualityPlan
        ? this.extractConditionalEqualityJoinPlan(
            filter,
            table,
            foreignTable,
            mainAlias,
            foreignAliasUsed
          )
        : null;
      const preferMaterializedCte = this.dbProvider.driver === DriverClient.Pg;

      if (equalityPlan?.joinKeys.length) {
        const countsAlias = `__cr_counts_${field.id}`;
        const countsQuery = this.qb.client
          .queryBuilder()
          .from(`${foreignTable.dbTableName} as ${foreignAliasUsed}`);
        for (const cond of equalityPlan.joinKeys) {
          countsQuery.select(this.qb.client.raw(`${cond.foreignExpr} as "${cond.alias}"`));
          countsQuery.groupByRaw(cond.foreignExpr);
        }
        countsQuery.select(this.qb.client.raw(`${castedAggregateExpression} as "reference_value"`));

        if (equalityPlan.residualFilter) {
          const fieldMap = foreignTable.fieldList.reduce(
            (map, f) => {
              map[f.id] = f as FieldCore;
              return map;
            },
            {} as Record<string, FieldCore>
          );

          const selectionMap = new Map<string, IFieldSelectName>();
          for (const f of foreignTable.fields.ordered) {
            selectionMap.set(f.id, `"${foreignAliasUsed}"."${f.dbFieldName}"`);
          }

          const { fieldReferenceSelectionMap, fieldReferenceFieldMap } =
            this.buildFieldReferenceContext(table, foreignTable, mainAlias, foreignAliasUsed);

          this.dbProvider
            .filterQuery(countsQuery, fieldMap, equalityPlan.residualFilter, undefined, {
              selectionMap,
              fieldReferenceSelectionMap,
              fieldReferenceFieldMap,
            })
            .appendQueryBuilder();
        }

        const equalityFallback = this.getConditionalEqualityFallback(aggregationFn, field);
        // Materialize to stop Postgres from re-running the aggregate for every outer row
        // when the host table is re-joined during UPDATE ... LIMIT pagination.
        this.withCte(
          cteName,
          (cqb) => {
            cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
            const refValueSql =
              equalityFallback != null
                ? `COALESCE(${countsAlias}."reference_value", ${equalityFallback})`
                : `${countsAlias}."reference_value"`;
            cqb.select(cqb.client.raw(`${refValueSql} as "conditional_rollup_${field.id}"`));
            this.fromTableWithRestriction(cqb, table, mainAlias);
            const countsSql = countsQuery.toQuery();
            cqb.leftJoin(this.qb.client.raw(`(${countsSql}) as ${countsAlias}`), (join) => {
              for (const cond of equalityPlan.joinKeys) {
                join.on(
                  this.qb.client.raw(cond.hostExpr),
                  '=',
                  this.qb.client.raw(`${countsAlias}."${cond.alias}"`)
                );
              }
            });
          },
          { materialized: preferMaterializedCte }
        );

        if (joinToMain && !this.state.isCteJoined(cteName)) {
          this.qb.leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);
          this.state.markCteJoined(cteName);
        }

        this.state.setFieldCte(field.id, cteName);
        return;
      }

      const aggregateSourceQuery = this.qb.client
        .queryBuilder()
        .select('*')
        .from(`${foreignTable.dbTableName} as ${foreignAliasUsed}`);

      if (filter) {
        const fieldMap = foreignTable.fieldList.reduce(
          (map, f) => {
            map[f.id] = f as FieldCore;
            return map;
          },
          {} as Record<string, FieldCore>
        );

        const selectionMap = this.buildConditionalFilterSelectionMap(
          foreignTable,
          foreignAliasUsed,
          filter,
          selectVisitor
        );

        const { fieldReferenceSelectionMap, fieldReferenceFieldMap } =
          this.buildFieldReferenceContext(table, foreignTable, mainAlias, foreignAliasUsed);

        this.dbProvider
          .filterQuery(aggregateSourceQuery, fieldMap, filter, undefined, {
            selectionMap,
            fieldReferenceSelectionMap,
            fieldReferenceFieldMap,
          })
          .appendQueryBuilder();
      }

      if (supportsOrdering && orderByClause) {
        aggregateSourceQuery.orderByRaw(orderByClause);
      }

      if (supportsOrdering) {
        const resolvedLimit = normalizeConditionalLimit(limit);
        aggregateSourceQuery.limit(resolvedLimit);
      }

      const aggregateQuery = this.qb.client
        .queryBuilder()
        .from(aggregateSourceQuery.as(foreignAliasUsed));

      aggregateQuery.select(this.qb.client.raw(`${castedAggregateExpression} as reference_value`));
      const aggregateSql = aggregateQuery.toQuery();

      this.withCte(
        cteName,
        (cqb) => {
          cqb
            .select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`)
            .select(cqb.client.raw(`(${aggregateSql}) as "conditional_rollup_${field.id}"`))
            .modify((builder) => this.fromTableWithRestriction(builder, table, mainAlias));
        },
        { materialized: preferMaterializedCte }
      );

      if (joinToMain && !this.state.isCteJoined(cteName)) {
        this.qb.leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);
        this.state.markCteJoined(cteName);
      }

      this.state.setFieldCte(field.id, cteName);
    } finally {
      this.conditionalRollupGenerationStack.delete(field.id);
    }
  }

  private generateConditionalLookupFieldCte(field: FieldCore, options: IConditionalLookupOptions) {
    this.generateConditionalLookupFieldCteForScope(this.table, field, options);
  }

  private generateConditionalLookupFieldCteForScope(
    table: TableDomain,
    field: FieldCore,
    options: IConditionalLookupOptions
  ): void {
    if (field.hasError) {
      this.logger.warn(
        `[ConditionalLookup] Skipping CTE generation for field ${field.id} (${field.name}): field.hasError=true`
      );
      return;
    }
    if (this.state.getFieldCteMap().has(field.id)) return;
    if (this.conditionalLookupGenerationStack.has(field.id)) return;

    this.conditionalLookupGenerationStack.add(field.id);
    try {
      const { foreignTableId, lookupFieldId, filter, sort, limit } = options;
      if (!foreignTableId || !lookupFieldId) {
        this.logger.warn(
          `[ConditionalLookup] Skipping CTE generation for field ${field.id} (${field.name}): ` +
            `foreignTableId=${foreignTableId}, lookupFieldId=${lookupFieldId}`
        );
        return;
      }

      const foreignTable = this.tables.getTable(foreignTableId);
      if (!foreignTable) {
        this.logger.warn(
          `[ConditionalLookup] Skipping CTE generation for field ${field.id} (${field.name}): ` +
            `foreignTable not found for foreignTableId=${foreignTableId}`
        );
        return;
      }

      const targetField = foreignTable.getField(lookupFieldId);
      if (!targetField) {
        this.logger.warn(
          `[ConditionalLookup] Skipping CTE generation for field ${field.id} (${field.name}): ` +
            `targetField not found for lookupFieldId=${lookupFieldId} in foreignTable=${foreignTableId}`
        );
        return;
      }

      const requiredLinkFields = new Map<string, LinkFieldCore>();

      const ensureLinkDependencies = (candidate?: FieldCore) => {
        if (!candidate) return;
        if (candidate.type === FieldType.Link) {
          const linkField = candidate as LinkFieldCore;
          requiredLinkFields.set(linkField.id, linkField);
          if (!this.state.getFieldCteMap().has(linkField.id)) {
            this.generateLinkFieldCteForTable(foreignTable, linkField);
          }
        }
        for (const linkField of candidate.getLinkFields(foreignTable)) {
          if (!linkField) continue;
          requiredLinkFields.set(linkField.id, linkField as LinkFieldCore);
          if (this.state.getFieldCteMap().has(linkField.id)) continue;
          this.generateLinkFieldCteForTable(foreignTable, linkField as LinkFieldCore);
        }
      };
      ensureLinkDependencies(targetField);
      const preferMaterializedCte = this.dbProvider.driver === DriverClient.Pg;

      const joinToMain = table === this.table;

      const cteName = `CTE_CONDITIONAL_LOOKUP_${field.id}`;
      const mainAlias = getTableAliasFromTable(table);
      const foreignAlias = getTableAliasFromTable(foreignTable);
      const foreignAliasUsed = foreignAlias === mainAlias ? `${foreignAlias}_ref` : foreignAlias;

      const selectVisitor = this.createFieldSelectVisitor(
        foreignTable,
        foreignAliasUsed,
        true,
        !this.expandFormulaReferences
      );

      const rawExpression = this.resolveConditionalComputedTargetExpression(
        targetField,
        foreignTable,
        foreignAliasUsed,
        selectVisitor
      );

      const joinLinkDependencies = (qb: Knex.QueryBuilder) => {
        for (const linkField of requiredLinkFields.values()) {
          const cteName = this.getCteNameForField(linkField.id);
          if (!cteName) continue;
          qb.leftJoin(cteName, `${foreignAliasUsed}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);
        }
      };

      const aggregateBase = this.qb.client
        .queryBuilder()
        .select('*')
        .from(`${foreignTable.dbTableName} as ${foreignAliasUsed}`);

      joinLinkDependencies(aggregateBase);

      const normalizedExpression = this.coerceConditionalLookupTargetExpression(
        rawExpression,
        targetField
      );
      const targetValueAlias = `__cl_target_${field.id}`;
      aggregateBase.select(this.qb.client.raw(`${normalizedExpression} as "${targetValueAlias}"`));
      const projectedTargetExpr = `"${foreignAliasUsed}"."${targetValueAlias}"`;

      let orderByClause: string | undefined;
      if (sort?.fieldId) {
        const sortField = foreignTable.getField(sort.fieldId);
        if (sortField) {
          ensureLinkDependencies(sortField);

          let sortExpression = this.resolveConditionalComputedTargetExpression(
            sortField,
            foreignTable,
            foreignAliasUsed,
            selectVisitor
          );

          const defaultForeignAlias = getTableAliasFromTable(foreignTable);
          if (defaultForeignAlias !== foreignAliasUsed) {
            sortExpression = sortExpression.replaceAll(
              `"${defaultForeignAlias}"`,
              `"${foreignAliasUsed}"`
            );
          }

          const direction = sort.order === SortFunc.Desc ? 'DESC' : 'ASC';
          const sortAlias = `__cl_sort_${sort.fieldId}_${field.id}`;
          aggregateBase.select(this.qb.client.raw(`${sortExpression} as "${sortAlias}"`));
          orderByClause = `"${sortAlias}" ${direction}`;
        }
      }

      const aggregateExpressionInfo =
        field.type === FieldType.ConditionalRollup
          ? {
              expression: this.dialect.jsonAggregateNonNull(projectedTargetExpr, orderByClause),
              isJsonAggregate: true,
            }
          : (() => {
              const expression = this.buildConditionalRollupAggregation(
                'array_compact({values})',
                projectedTargetExpr,
                targetField,
                foreignAliasUsed,
                orderByClause
              );
              return {
                expression,
                isJsonAggregate: JSON_AGG_FUNCTIONS.has('array_compact'),
              };
            })();
      const normalizedAggregateExpression = unwrapJsonAggregateForScalar(
        this.dbProvider.driver,
        aggregateExpressionInfo.expression,
        field,
        aggregateExpressionInfo.isJsonAggregate
      );
      const castedAggregateExpression = this.castExpressionForDbType(
        normalizedAggregateExpression,
        field
      );

      const resolvedLimit = normalizeConditionalLimit(limit);
      const equalityPlan = this.extractConditionalEqualityJoinPlan(
        filter,
        table,
        foreignTable,
        mainAlias,
        foreignAliasUsed
      );
      const lookupAlias = `conditional_lookup_${field.id}`;
      const rollupAlias = `conditional_rollup_${field.id}`;

      const applyConditionalFilter = (
        targetQb: Knex.QueryBuilder,
        targetFilter: IFilter | null | undefined = filter
      ) => {
        if (!targetFilter) return;

        const fieldMap = foreignTable.fieldList.reduce(
          (map, f) => {
            map[f.id] = f as FieldCore;
            return map;
          },
          {} as Record<string, FieldCore>
        );

        const selectionMap = this.buildConditionalFilterSelectionMap(
          foreignTable,
          foreignAliasUsed,
          targetFilter,
          selectVisitor
        );

        const { fieldReferenceSelectionMap, fieldReferenceFieldMap } =
          this.buildFieldReferenceContext(table, foreignTable, mainAlias, foreignAliasUsed);

        this.dbProvider
          .filterQuery(targetQb, fieldMap, targetFilter, undefined, {
            selectionMap,
            fieldReferenceSelectionMap,
            fieldReferenceFieldMap,
          })
          .appendQueryBuilder();
      };

      if (equalityPlan?.joinKeys.length) {
        const partitionClause = equalityPlan.joinKeys.map((cond) => cond.foreignExpr).join(', ');
        const windowOrder = orderByClause ? ` ORDER BY ${orderByClause}` : '';
        const windowClause = partitionClause
          ? `PARTITION BY ${partitionClause}${windowOrder}`
          : windowOrder.trim();
        const rowNumberExpr = windowClause
          ? `ROW_NUMBER() OVER (${windowClause})`
          : 'ROW_NUMBER() OVER ()';

        const rankedSourceQuery = aggregateBase.clone();
        applyConditionalFilter(rankedSourceQuery, equalityPlan.residualFilter);

        const rankedWithWindow = this.qb.client
          .queryBuilder()
          .from(rankedSourceQuery.as(foreignAliasUsed))
          .select(`${foreignAliasUsed}.*`)
          .select(this.qb.client.raw(`${rowNumberExpr} as "__cl_rank"`));

        const limitedSourceQuery = this.qb.client
          .queryBuilder()
          .from(rankedWithWindow.as(foreignAliasUsed))
          .select('*')
          .whereRaw('"__cl_rank" <= ?', [resolvedLimit]);

        const aggregateQuery = this.qb.client
          .queryBuilder()
          .from(limitedSourceQuery.as(foreignAliasUsed));

        for (const cond of equalityPlan.joinKeys) {
          aggregateQuery
            .select(this.qb.client.raw(`${cond.foreignExpr} as "${cond.alias}"`))
            .groupByRaw(cond.foreignExpr);
        }

        aggregateQuery.select(
          this.qb.client.raw(`${castedAggregateExpression} as reference_value`)
        );
        const aggregateSql = aggregateQuery.toQuery();
        const joinAlias = `__cl_${field.id}`;

        this.withCte(
          cteName,
          (cqb) => {
            cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
            cqb.select(cqb.client.raw(`${joinAlias}."reference_value" as "${lookupAlias}"`));
            if (field.type === FieldType.ConditionalRollup) {
              cqb.select(cqb.client.raw(`${joinAlias}."reference_value" as "${rollupAlias}"`));
            }
            this.fromTableWithRestriction(cqb, table, mainAlias);
            cqb.leftJoin(this.qb.client.raw(`(${aggregateSql}) as ${joinAlias}`), (join) => {
              for (const cond of equalityPlan.joinKeys) {
                join.on(
                  this.qb.client.raw(cond.hostExpr),
                  '=',
                  this.qb.client.raw(`${joinAlias}."${cond.alias}"`)
                );
              }
            });
          },
          { materialized: preferMaterializedCte }
        );

        if (joinToMain && !this.state.isCteJoined(cteName)) {
          this.qb.leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);
          this.state.markCteJoined(cteName);
        }

        this.state.setFieldCte(field.id, cteName);
        return;
      }

      const aggregateSourceQuery = aggregateBase.clone();
      applyConditionalFilter(aggregateSourceQuery);

      if (orderByClause) {
        aggregateSourceQuery.orderByRaw(orderByClause);
      }

      aggregateSourceQuery.limit(resolvedLimit);

      const aggregateQuery = this.qb.client
        .queryBuilder()
        .from(aggregateSourceQuery.as(foreignAliasUsed));

      aggregateQuery.select(this.qb.client.raw(`${castedAggregateExpression} as reference_value`));

      const aggregateSql = aggregateQuery.toQuery();

      this.withCte(
        cteName,
        (cqb) => {
          cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
          const makeAggregateSelect = (alias: string) =>
            cqb.client.raw(`(${aggregateSql}) as "${alias}"`);
          cqb.select(makeAggregateSelect(lookupAlias));
          if (field.type === FieldType.ConditionalRollup) {
            cqb.select(makeAggregateSelect(rollupAlias));
          }
          this.fromTableWithRestriction(cqb, table, mainAlias);
        },
        { materialized: preferMaterializedCte }
      );

      if (joinToMain && !this.state.isCteJoined(cteName)) {
        this.qb.leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);
        this.state.markCteJoined(cteName);
      }

      this.state.setFieldCte(field.id, cteName);
    } finally {
      this.conditionalLookupGenerationStack.delete(field.id);
    }
  }

  public build() {
    const list = getOrderedFieldsByProjection(
      this.table,
      this.projection,
      this.expandFormulaReferences
    ) as FieldCore[];
    this.filteredIdSet = new Set(list.map((f) => f.id));

    // Ensure CTEs for any link fields that are dependencies of the projected fields.
    // This allows selecting lookup/rollup values even when the link fields themselves
    // are not part of the projection.
    for (const field of list) {
      const linkFields =
        !this.expandFormulaReferences && field.type === FieldType.Formula
          ? []
          : field.getLinkFields(this.table);
      for (const lf of linkFields) {
        if (!lf) continue;
        if (!this.state.getFieldCteMap().has(lf.id)) {
          this.generateLinkFieldCte(lf);
        }
      }

      if (field.isConditionalLookup) {
        const options = field.getConditionalLookupOptions?.();
        if (options) {
          this.generateConditionalLookupFieldCte(field, options);
        } else {
          this.logger.warn(
            `[ConditionalLookup] getConditionalLookupOptions returned undefined for field ${field.id} (${field.name}). ` +
              `isConditionalLookup=${field.isConditionalLookup}, lookupOptions=${JSON.stringify(field.lookupOptions)}`
          );
        }
      }
    }

    for (const field of list) {
      field.accept(this);
    }
  }

  private generateLinkFieldCte(linkField: LinkFieldCore): void {
    // Avoid defining the same CTE multiple times in a single WITH clause
    if (this.state.getFieldCteMap().has(linkField.id)) {
      return;
    }
    if (this.linkCteGenerationStack.has(linkField.id)) {
      return;
    }
    const foreignTable = this.tables.getLinkForeignTable(linkField);
    // Skip CTE generation if foreign table is missing (e.g., deleted)
    if (!foreignTable) {
      return;
    }
    const cteName = FieldCteVisitor.generateCTENameForField(this.table, linkField);
    const usesJunctionTable = getLinkUsesJunctionTable(linkField);
    const options = linkField.options as ILinkFieldOptions;
    const mainAlias = getTableAliasFromTable(this.table);
    const foreignAlias = getTableAliasFromTable(foreignTable);
    const foreignAliasUsed = foreignAlias === mainAlias ? `${foreignAlias}_f` : foreignAlias;
    const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = options;

    this.linkCteGenerationStack.add(linkField.id);
    this.pendingLinkCteNames.set(linkField.id, cteName);

    try {
      const buildLinkCte = () => {
        // Determine which lookup/rollup fields depend on this link. Even if a field isn't part of
        // the current projection we still need to expose its computed column, otherwise nested CTEs
        // that reuse this link cannot reference the precomputed values mid-query.
        const lookupFields = linkField.getLookupFields(this.table);
        const rollupFields = linkField.getRollupFields(this.table);

        // Pre-generate nested CTEs limited to selected lookup/rollup dependencies
        this.generateNestedForeignCtesIfNeeded(
          this.table,
          foreignTable,
          linkField,
          new Set(lookupFields.map((f) => f.id)),
          new Set(rollupFields.map((f) => f.id))
        );

        // Hard guarantee: if any main-table lookup targets a foreign-table lookup, ensure the
        // foreign link CTE used by that target lookup is generated before referencing it.
        for (const lk of lookupFields) {
          const target = lk.getForeignLookupField(foreignTable);
          const nestedLinkId = target ? getLinkFieldId(target.lookupOptions) : undefined;
          if (nestedLinkId) {
            const nestedLink = foreignTable.getField(nestedLinkId) as LinkFieldCore | undefined;
            if (nestedLink && !this.state.getFieldCteMap().has(nestedLink.id)) {
              this.generateLinkFieldCteForTable(foreignTable, nestedLink);
            }
          }
        }

        // Collect all nested link dependencies that need to be JOINed
        const nestedJoins = new Set<string>();

        const ensureConditionalComputedCteForField = (targetField?: FieldCore) => {
          if (!targetField) {
            return;
          }
          if (targetField.type === FieldType.ConditionalRollup && !targetField.isLookup) {
            this.generateConditionalRollupFieldCteForScope(
              foreignTable,
              targetField as ConditionalRollupFieldCore
            );
          }
          if (targetField.isConditionalLookup) {
            const options = targetField.getConditionalLookupOptions?.();
            if (options) {
              this.generateConditionalLookupFieldCteForScope(foreignTable, targetField, options);
            }
          }
        };

        const ensureLinkDependency = (linkFieldCore?: LinkFieldCore | null) =>
          this.ensureLinkDependencyForScope(linkFieldCore, foreignTable, linkField.id, nestedJoins);

        const collectLinkDependencies = (
          field: FieldCore | undefined,
          visited: Set<string> = new Set()
        ) => {
          if (!field || visited.has(field.id)) {
            return;
          }
          visited.add(field.id);

          ensureConditionalComputedCteForField(field);

          if (field.type === FieldType.Link) {
            ensureLinkDependency(field as LinkFieldCore);
          }

          const viaLookupId = getLinkFieldId(field.lookupOptions);
          if (viaLookupId) {
            const nestedLinkField = foreignTable.getField(viaLookupId) as LinkFieldCore | undefined;
            ensureLinkDependency(nestedLinkField);
          }

          const directLinks = field.getLinkFields(foreignTable);
          for (const lf of directLinks) {
            ensureLinkDependency(lf);
          }

          const maybeGetReferenceFields = (
            field as unknown as {
              getReferenceFields?: (table: TableDomain) => FieldCore[];
            }
          ).getReferenceFields;
          if (typeof maybeGetReferenceFields === 'function') {
            if (this.expandFormulaReferences) {
              const referencedFields = maybeGetReferenceFields.call(field, foreignTable) ?? [];
              for (const refField of referencedFields) {
                collectLinkDependencies(refField, visited);
              }
            }
          }
        };

        // Helper: add dependent link fields from a target field
        const addDepLinksFromTarget = (field: FieldCore) => {
          const targetField = field.getForeignLookupField(foreignTable);
          if (!targetField) return;
          collectLinkDependencies(targetField);
        };

        // Ensure lookup-of-link targets bring along their nested link CTEs and are JOINed
        for (const lookupField of lookupFields) {
          const nestedLinkId = getLinkFieldId(lookupField.lookupOptions);
          if (!nestedLinkId) continue;
          const nestedLinkField = foreignTable.getField(nestedLinkId) as LinkFieldCore | undefined;
          ensureLinkDependency(nestedLinkField);
        }

        const ensureDisplayFieldDependencies = () => {
          const displayFieldIds = new Set<string>();
          const lookupFieldId = (linkField.options as ILinkFieldOptions).lookupFieldId;
          if (lookupFieldId) {
            displayFieldIds.add(lookupFieldId);
          }
          const primaryField = foreignTable.getPrimaryField();
          if (primaryField?.id) {
            displayFieldIds.add(primaryField.id);
          }

          for (const displayFieldId of displayFieldIds) {
            const displayField = foreignTable.getField(displayFieldId) as FieldCore | undefined;
            if (displayField) {
              collectLinkDependencies(displayField);
            }
          }
        };

        ensureDisplayFieldDependencies();

        // Explicitly join nested link CTEs referenced by lookup-of-link targets so lookup values
        // remain available when the target field itself is a lookup.
        for (const lookupField of lookupFields) {
          const nestedLinkId = getLinkFieldId(lookupField.lookupOptions);
          if (!nestedLinkId) continue;
          const nestedLinkField = foreignTable.getField(nestedLinkId) as LinkFieldCore | undefined;
          ensureLinkDependency(nestedLinkField);
        }

        if (process.env.DEBUG_NESTED_CTE === '1' && nestedJoins.size) {
          // eslint-disable-next-line no-console
          console.log('[FieldCteVisitor] nested CTE dependencies', {
            linkFieldId: linkField.id,
            linkFieldName: linkField.name,
            relationship,
            usesJunctionTable,
            nested: Array.from(nestedJoins),
          });
        }

        // Check lookup fields: collect all dependent link fields
        for (const lookupField of lookupFields) {
          addDepLinksFromTarget(lookupField);
        }

        // Check rollup fields: collect all dependent link fields
        for (const rollupField of rollupFields) {
          addDepLinksFromTarget(rollupField);
        }

        addDepLinksFromTarget(linkField);

        this.qb
          // eslint-disable-next-line sonarjs/cognitive-complexity
          .with(cteName, (cqb) => {
            // Create set of JOINed CTEs for this scope
            const joinedCtesInScope = new Set(nestedJoins);
            const blockedLinkFieldIds = this.getBlockedLinkFieldIds(linkField.id);
            const readyLinkFieldIds = this.getReadyLinkFieldIdsSnapshotForVisitor();

            const visitor = new FieldCteSelectionVisitor(
              cqb,
              this.dbProvider,
              this.dialect,
              this.table,
              foreignTable,
              this.state,
              joinedCtesInScope,
              usesJunctionTable || relationship === Relationship.OneMany ? false : true,
              foreignAliasUsed,
              linkField.id,
              blockedLinkFieldIds,
              readyLinkFieldIds
            );
            const linkValue = linkField.accept(visitor);

            cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
            // Ensure jsonb type on Postgres to avoid type mismatch (e.g., NULL defaults)
            const linkValueExpr =
              this.dbProvider.driver === DriverClient.Pg ? `${linkValue}::jsonb` : `${linkValue}`;
            cqb.select(cqb.client.raw(`${linkValueExpr} as link_value`));

            for (const lookupField of lookupFields) {
              const visitor = new FieldCteSelectionVisitor(
                cqb,
                this.dbProvider,
                this.dialect,
                this.table,
                foreignTable,
                this.state,
                joinedCtesInScope,
                usesJunctionTable || relationship === Relationship.OneMany ? false : true,
                foreignAliasUsed,
                linkField.id,
                blockedLinkFieldIds,
                readyLinkFieldIds
              );
              const lookupValue = lookupField.accept(visitor);
              cqb.select(cqb.client.raw(`${lookupValue} as "lookup_${lookupField.id}"`));
            }

            for (const rollupField of rollupFields) {
              const visitor = new FieldCteSelectionVisitor(
                cqb,
                this.dbProvider,
                this.dialect,
                this.table,
                foreignTable,
                this.state,
                joinedCtesInScope,
                usesJunctionTable || relationship === Relationship.OneMany ? false : true,
                foreignAliasUsed,
                linkField.id,
                blockedLinkFieldIds,
                readyLinkFieldIds
              );
              const rollupValue = rollupField.accept(visitor);
              cqb.select(cqb.client.raw(`${rollupValue} as "rollup_${rollupField.id}"`));
            }

            if (usesJunctionTable) {
              if (process.env.DEBUG_NESTED_CTE === '1') {
                // eslint-disable-next-line no-console
                console.log('[FieldCteVisitor] join scope (junction)', {
                  linkFieldId: linkField.id,
                  relationship,
                  nestedCount: nestedJoins.size,
                });
              }
              this.fromTableWithRestriction(cqb, this.table, mainAlias);
              cqb
                .leftJoin(
                  `${fkHostTableName} as ${JUNCTION_ALIAS}`,
                  `${mainAlias}.__id`,
                  `${JUNCTION_ALIAS}.${selfKeyName}`
                )
                .leftJoin(
                  `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
                  `${JUNCTION_ALIAS}.${foreignKeyName}`,
                  `${foreignAliasUsed}.__id`
                );

              // Add LEFT JOINs to nested CTEs
              for (const nestedLinkFieldId of nestedJoins) {
                const nestedCteName = this.getCteNameForField(nestedLinkFieldId);
                if (!nestedCteName) {
                  continue;
                }
                cqb.leftJoin(
                  nestedCteName,
                  `${nestedCteName}.main_record_id`,
                  `${foreignAliasUsed}.__id`
                );
              }

              // Removed global application of all lookup/rollup filters: we now apply per-field filters only at selection time

              cqb.groupBy(`${mainAlias}.__id`);

              // For SQLite, add ORDER BY at query level since json_group_array doesn't support internal ordering
              if (this.dbProvider.driver === DriverClient.Sqlite) {
                cqb.orderBy(`${JUNCTION_ALIAS}.__id`);
              }
            } else if (relationship === Relationship.OneMany) {
              if (process.env.DEBUG_NESTED_CTE === '1') {
                // eslint-disable-next-line no-console
                console.log('[FieldCteVisitor] join scope (one-many)', {
                  linkFieldId: linkField.id,
                  relationship,
                  nestedCount: nestedJoins.size,
                });
              }
              // For non-one-way OneMany relationships, foreign key is stored in the foreign table
              // No junction table needed

              this.fromTableWithRestriction(cqb, this.table, mainAlias);
              cqb.leftJoin(
                `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
                `${mainAlias}.__id`,
                `${foreignAliasUsed}.${selfKeyName}`
              );

              // Add LEFT JOINs to nested CTEs
              for (const nestedLinkFieldId of nestedJoins) {
                const nestedCteName = this.getCteNameForField(nestedLinkFieldId);
                if (!nestedCteName) {
                  continue;
                }
                cqb.leftJoin(
                  nestedCteName,
                  `${nestedCteName}.main_record_id`,
                  `${foreignAliasUsed}.__id`
                );
              }

              // Removed global application of all lookup/rollup filters

              cqb.groupBy(`${mainAlias}.__id`);

              // For SQLite, add ORDER BY at query level (NULLS FIRST + stable tie-breaker)
              if (this.dbProvider.driver === DriverClient.Sqlite) {
                if (linkField.getHasOrderColumn()) {
                  cqb.orderByRaw(
                    `(CASE WHEN ${foreignAliasUsed}.${selfKeyName}_order IS NULL THEN 0 ELSE 1 END) ASC`
                  );
                  cqb.orderBy(`${foreignAliasUsed}.${selfKeyName}_order`, 'asc');
                }
                // Always tie-break by record id for deterministic order
                cqb.orderBy(`${foreignAliasUsed}.__id`, 'asc');
              }
            } else if (
              relationship === Relationship.ManyOne ||
              relationship === Relationship.OneOne
            ) {
              // Direct join for many-to-one and one-to-one relationships
              // No GROUP BY needed for single-value relationships

              // For OneOne and ManyOne relationships, the foreign key is always stored in fkHostTableName
              // But we need to determine the correct join condition based on which table we're querying from
              const isForeignKeyInMainTable = fkHostTableName === this.table.dbTableName;

              this.fromTableWithRestriction(cqb, this.table, mainAlias);

              if (isForeignKeyInMainTable) {
                // Foreign key is stored in the main table (original field case)
                // Join: main_table.foreign_key_column = foreign_table.__id
                cqb.leftJoin(
                  `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
                  `${mainAlias}.${foreignKeyName}`,
                  `${foreignAliasUsed}.__id`
                );
              } else {
                // Foreign key is stored in the foreign table (symmetric field case)
                // Join: foreign_table.foreign_key_column = main_table.__id
                // Note: for symmetric fields, selfKeyName and foreignKeyName are swapped
                cqb.leftJoin(
                  `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
                  `${foreignAliasUsed}.${selfKeyName}`,
                  `${mainAlias}.__id`
                );
              }

              // Removed global application of all lookup/rollup filters

              // Add LEFT JOINs to nested CTEs for single-value relationships
              for (const nestedLinkFieldId of nestedJoins) {
                const nestedCteName = this.getCteNameForField(nestedLinkFieldId);
                if (!nestedCteName) {
                  continue;
                }
                cqb.leftJoin(
                  nestedCteName,
                  `${nestedCteName}.main_record_id`,
                  `${foreignAliasUsed}.__id`
                );
              }
            }
          });

        if (!this.state.isCteJoined(cteName)) {
          this.qb.leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);
          this.state.markCteJoined(cteName);
        }
      };

      buildLinkCte();
      this.state.setFieldCte(linkField.id, cteName);
      this.emittedLinkCteIds.add(linkField.id);
    } finally {
      this.linkCteGenerationStack.delete(linkField.id);
      this.pendingLinkCteNames.delete(linkField.id);
    }
  }

  /**
   * Generate CTEs for foreign table's dependent link fields if any of the lookup/rollup targets
   * on the current link field point to lookup fields in the foreign table.
   * This ensures multi-layer lookup/rollup can reference precomputed values via nested CTEs.
   */
  private generateNestedForeignCtesIfNeeded(
    mainTable: TableDomain,
    foreignTable: TableDomain,
    mainToForeignLinkField: LinkFieldCore,
    limitLookupIds?: Set<string>,
    limitRollupIds?: Set<string>
  ): void {
    const nestedLinkFields = new Map<string, LinkFieldCore>();
    const ensureConditionalComputedCte = (table: TableDomain, targetField?: FieldCore) => {
      if (!targetField) return;
      if (targetField.type === FieldType.ConditionalRollup && !targetField.isLookup) {
        this.generateConditionalRollupFieldCteForScope(
          table,
          targetField as ConditionalRollupFieldCore
        );
      }
      if (targetField.isConditionalLookup) {
        const options = targetField.getConditionalLookupOptions?.();
        if (options) {
          this.generateConditionalLookupFieldCteForScope(table, targetField, options);
        }
      }
    };

    // Collect lookup fields on main table that depend on this link
    let lookupFields = mainToForeignLinkField.getLookupFields(mainTable);
    if (limitLookupIds) {
      lookupFields = lookupFields.filter((f) => limitLookupIds.has(f.id));
    }
    for (const lookupField of lookupFields) {
      const target = lookupField.getForeignLookupField(foreignTable);
      if (target) {
        ensureConditionalComputedCte(foreignTable, target);
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
        for (const lf of target.getLinkFields(foreignTable)) {
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
      } else {
        const nestedId = lookupField.lookupOptions?.lookupFieldId;
        const nestedField = nestedId ? foreignTable.getField(nestedId) : undefined;
        if (
          nestedField &&
          nestedField.type === FieldType.Link &&
          !nestedLinkFields.has(nestedField.id)
        ) {
          nestedLinkFields.set(nestedField.id, nestedField as LinkFieldCore);
        }
        ensureConditionalComputedCte(foreignTable, nestedField);
      }
    }

    // Collect rollup fields on main table that depend on this link
    let rollupFields = mainToForeignLinkField.getRollupFields(mainTable);
    if (limitRollupIds) {
      rollupFields = rollupFields.filter((f) => limitRollupIds.has(f.id));
    }
    for (const rollupField of rollupFields) {
      const target = rollupField.getForeignLookupField(foreignTable);
      if (target) {
        ensureConditionalComputedCte(foreignTable, target);
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
        for (const lf of target.getLinkFields(foreignTable)) {
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
      } else {
        const nestedId = rollupField.lookupOptions?.lookupFieldId;
        const nestedField = nestedId ? foreignTable.getField(nestedId) : undefined;
        if (
          nestedField &&
          nestedField.type === FieldType.Link &&
          !nestedLinkFields.has(nestedField.id)
        ) {
          nestedLinkFields.set(nestedField.id, nestedField as LinkFieldCore);
        }
        ensureConditionalComputedCte(foreignTable, nestedField);
      }
    }

    // Generate CTEs for each nested link field on the foreign table if not already generated
    for (const [nestedLinkFieldId, nestedLinkFieldCore] of nestedLinkFields) {
      if (this.state.getFieldCteMap().has(nestedLinkFieldId)) continue;
      this.generateLinkFieldCteForTable(foreignTable, nestedLinkFieldCore);
    }
  }

  /**
   * Generate CTE for a link field using the provided table as the "main" table context.
   * This is used to build nested CTEs for foreign tables.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private generateLinkFieldCteForTable(table: TableDomain, linkField: LinkFieldCore): void {
    if (this.fieldCteMap.has(linkField.id)) {
      return;
    }
    if (this.linkCteGenerationStack.has(linkField.id)) {
      return;
    }
    const foreignTable = this.tables.getLinkForeignTable(linkField);
    if (!foreignTable) {
      return;
    }
    const cteName = FieldCteVisitor.generateCTENameForField(table, linkField);
    const usesJunctionTable = getLinkUsesJunctionTable(linkField);
    const options = linkField.options as ILinkFieldOptions;
    const mainAlias = getTableAliasFromTable(table);
    const foreignAlias = getTableAliasFromTable(foreignTable);
    const foreignAliasUsed = foreignAlias === mainAlias ? `${foreignAlias}_f` : foreignAlias;
    const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = options;

    this.linkCteGenerationStack.add(linkField.id);
    this.pendingLinkCteNames.set(linkField.id, cteName);

    try {
      const buildForeignLinkCte = () => {
        // Ensure deeper nested dependencies for this nested link are also generated
        this.generateNestedForeignCtesIfNeeded(table, foreignTable, linkField);

        const ensureConditionalComputedCteForField = (targetField?: FieldCore) => {
          if (!targetField) {
            return;
          }
          if (targetField.type === FieldType.ConditionalRollup && !targetField.isLookup) {
            this.generateConditionalRollupFieldCteForScope(
              foreignTable,
              targetField as ConditionalRollupFieldCore
            );
          }
          if (targetField.isConditionalLookup) {
            const options = targetField.getConditionalLookupOptions?.();
            if (options) {
              this.generateConditionalLookupFieldCteForScope(foreignTable, targetField, options);
            }
          }
        };

        const ensureLinkDependency = (linkFieldCore?: LinkFieldCore | null) =>
          this.ensureLinkDependencyForScope(linkFieldCore, foreignTable, linkField.id, nestedJoins);

        // Collect all nested link dependencies that need to be JOINed
        const nestedJoins = new Set<string>();
        const lookupFields = linkField.getLookupFields(table);
        const rollupFields = linkField.getRollupFields(table);
        if (this.filteredIdSet) {
          // filteredIdSet belongs to the main table. For nested tables, we cannot filter
          // by main-table projection IDs; keep all nested lookup/rollup columns to ensure correctness.
        }

        const collectLinkDependencies = (
          field: FieldCore | undefined,
          visited: Set<string> = new Set()
        ) => {
          if (!field || visited.has(field.id)) {
            return;
          }
          visited.add(field.id);

          ensureConditionalComputedCteForField(field);

          if (field.type === FieldType.Link) {
            ensureLinkDependency(field as LinkFieldCore);
          }

          const viaLookupId = getLinkFieldId(field.lookupOptions);
          if (viaLookupId) {
            const nestedLinkField = foreignTable.getField(viaLookupId) as LinkFieldCore | undefined;
            ensureLinkDependency(nestedLinkField);
          }

          const directLinks = field.getLinkFields(foreignTable);
          for (const lf of directLinks) {
            ensureLinkDependency(lf);
          }

          const maybeGetReferenceFields = (
            field as unknown as {
              getReferenceFields?: (table: TableDomain) => FieldCore[];
            }
          ).getReferenceFields;
          if (typeof maybeGetReferenceFields === 'function') {
            const referencedFields = maybeGetReferenceFields.call(field, foreignTable) ?? [];
            for (const refField of referencedFields) {
              collectLinkDependencies(refField, visited);
            }
          }
        };

        // Check if any lookup/rollup fields depend on nested CTEs
        for (const lookupField of lookupFields) {
          const target = lookupField.getForeignLookupField(foreignTable);
          if (target) {
            collectLinkDependencies(target);
          }
        }

        for (const rollupField of rollupFields) {
          const target = rollupField.getForeignLookupField(foreignTable);
          if (target) {
            collectLinkDependencies(target);
          }
        }

        collectLinkDependencies(linkField.getForeignLookupField(foreignTable));

        this.qb.with(cteName, (cqb) => {
          // Create set of JOINed CTEs for this scope
          const joinedCtesInScope = new Set(nestedJoins);
          const blockedLinkFieldIds = this.getBlockedLinkFieldIds(linkField.id);
          const readyLinkFieldIds = this.getReadyLinkFieldIdsSnapshotForVisitor();

          const visitor = new FieldCteSelectionVisitor(
            cqb,
            this.dbProvider,
            this.dialect,
            table,
            foreignTable,
            this.state,
            joinedCtesInScope,
            usesJunctionTable || relationship === Relationship.OneMany ? false : true,
            foreignAliasUsed,
            linkField.id,
            blockedLinkFieldIds,
            readyLinkFieldIds
          );
          const linkValue = linkField.accept(visitor);

          cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
          // Ensure jsonb type on Postgres to avoid type mismatch (e.g., NULL defaults)
          const linkValueExpr =
            this.dbProvider.driver === DriverClient.Pg ? `${linkValue}::jsonb` : `${linkValue}`;
          cqb.select(cqb.client.raw(`${linkValueExpr} as link_value`));

          for (const lookupField of lookupFields) {
            const visitor = new FieldCteSelectionVisitor(
              cqb,
              this.dbProvider,
              this.dialect,
              table,
              foreignTable,
              this.state,
              joinedCtesInScope,
              usesJunctionTable || relationship === Relationship.OneMany ? false : true,
              foreignAliasUsed,
              linkField.id,
              blockedLinkFieldIds,
              readyLinkFieldIds
            );
            const lookupValue = lookupField.accept(visitor);
            cqb.select(cqb.client.raw(`${lookupValue} as "lookup_${lookupField.id}"`));
          }

          for (const rollupField of rollupFields) {
            const visitor = new FieldCteSelectionVisitor(
              cqb,
              this.dbProvider,
              this.dialect,
              table,
              foreignTable,
              this.state,
              joinedCtesInScope,
              usesJunctionTable || relationship === Relationship.OneMany ? false : true,
              foreignAliasUsed,
              linkField.id,
              blockedLinkFieldIds,
              readyLinkFieldIds
            );
            const rollupValue = rollupField.accept(visitor);
            // Ensure the rollup CTE column has a type that matches the physical column
            // to avoid Postgres UPDATE ... FROM assignment type mismatches (e.g., text vs numeric).
            const value = typeof rollupValue === 'string' ? rollupValue : rollupValue.toQuery();
            const castedRollupValue = this.castExpressionForDbType(value, rollupField);
            cqb.select(cqb.client.raw(`${castedRollupValue} as "rollup_${rollupField.id}"`));
          }

          if (usesJunctionTable) {
            this.fromTableWithRestriction(cqb, table, mainAlias);
            cqb
              .leftJoin(
                `${fkHostTableName} as ${JUNCTION_ALIAS}`,
                `${mainAlias}.__id`,
                `${JUNCTION_ALIAS}.${selfKeyName}`
              )
              .leftJoin(
                `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
                `${JUNCTION_ALIAS}.${foreignKeyName}`,
                `${foreignAliasUsed}.__id`
              );

            // Add LEFT JOINs to nested CTEs
            for (const nestedLinkFieldId of nestedJoins) {
              const nestedCteName = this.getCteNameForField(nestedLinkFieldId);
              if (!nestedCteName) {
                if (process.env.DEBUG_NESTED_CTE === '1') {
                  // eslint-disable-next-line no-console
                  console.log('[FieldCteVisitor] missing nested CTE mapping', {
                    linkFieldId: linkField.id,
                    nestedLinkFieldId,
                    relationship,
                  });
                }
                continue;
              }
              if (process.env.DEBUG_NESTED_CTE === '1') {
                // eslint-disable-next-line no-console
                console.log('[FieldCteVisitor] joining nested CTE', {
                  linkFieldId: linkField.id,
                  nestedLinkFieldId,
                  nestedCteName,
                  relationship,
                });
              }
              cqb.leftJoin(
                nestedCteName,
                `${nestedCteName}.main_record_id`,
                `${foreignAliasUsed}.__id`
              );
            }

            cqb.groupBy(`${mainAlias}.__id`);

            if (this.dbProvider.driver === DriverClient.Sqlite) {
              if (linkField.getHasOrderColumn()) {
                const ordCol = `${JUNCTION_ALIAS}.${linkField.getOrderColumnName()}`;
                cqb.orderByRaw(`(CASE WHEN ${ordCol} IS NULL THEN 0 ELSE 1 END) ASC`);
                cqb.orderBy(ordCol, 'asc');
              }
              cqb.orderBy(`${JUNCTION_ALIAS}.__id`, 'asc');
            }
          } else if (relationship === Relationship.OneMany) {
            this.fromTableWithRestriction(cqb, table, mainAlias);
            cqb.leftJoin(
              `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
              `${mainAlias}.__id`,
              `${foreignAliasUsed}.${selfKeyName}`
            );

            // Add LEFT JOINs to nested CTEs
            for (const nestedLinkFieldId of nestedJoins) {
              const nestedCteName = this.getCteNameForField(nestedLinkFieldId);
              if (!nestedCteName) {
                continue;
              }
              if (process.env.DEBUG_NESTED_CTE === '1') {
                // eslint-disable-next-line no-console
                console.log('[FieldCteVisitor] joining nested CTE', {
                  linkFieldId: linkField.id,
                  nestedLinkFieldId,
                  nestedCteName,
                  relationship,
                });
              }
              cqb.leftJoin(
                nestedCteName,
                `${nestedCteName}.main_record_id`,
                `${foreignAliasUsed}.__id`
              );
            }

            cqb.groupBy(`${mainAlias}.__id`);

            if (this.dbProvider.driver === DriverClient.Sqlite) {
              if (linkField.getHasOrderColumn()) {
                cqb.orderByRaw(
                  `(CASE WHEN ${foreignAliasUsed}.${selfKeyName}_order IS NULL THEN 0 ELSE 1 END) ASC`
                );
                cqb.orderBy(`${foreignAliasUsed}.${selfKeyName}_order`, 'asc');
              }
              cqb.orderBy(`${foreignAliasUsed}.__id`, 'asc');
            }
          } else if (
            relationship === Relationship.ManyOne ||
            relationship === Relationship.OneOne
          ) {
            const isForeignKeyInMainTable = fkHostTableName === table.dbTableName;
            this.fromTableWithRestriction(cqb, table, mainAlias);

            if (isForeignKeyInMainTable) {
              cqb.leftJoin(
                `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
                `${mainAlias}.${foreignKeyName}`,
                `${foreignAliasUsed}.__id`
              );
            } else {
              cqb.leftJoin(
                `${foreignTable.dbTableName} as ${foreignAliasUsed}`,
                `${foreignAliasUsed}.${selfKeyName}`,
                `${mainAlias}.__id`
              );
            }

            // Add LEFT JOINs to nested CTEs for single-value relationships
            for (const nestedLinkFieldId of nestedJoins) {
              const nestedCteName = this.getCteNameForField(nestedLinkFieldId);
              if (!nestedCteName) {
                if (process.env.DEBUG_NESTED_CTE === '1') {
                  // eslint-disable-next-line no-console
                  console.log('[FieldCteVisitor] missing nested CTE mapping', {
                    linkFieldId: linkField.id,
                    nestedLinkFieldId,
                    relationship,
                  });
                }
                continue;
              }
              if (process.env.DEBUG_NESTED_CTE === '1') {
                // eslint-disable-next-line no-console
                console.log('[FieldCteVisitor] joining nested CTE', {
                  linkFieldId: linkField.id,
                  nestedLinkFieldId,
                  nestedCteName,
                  relationship,
                });
              }
              cqb.leftJoin(
                nestedCteName,
                `${nestedCteName}.main_record_id`,
                `${foreignAliasUsed}.__id`
              );
            }
          }
        });
      };

      buildForeignLinkCte();
      this.state.setFieldCte(linkField.id, cteName);
      this.emittedLinkCteIds.add(linkField.id);
    } finally {
      this.linkCteGenerationStack.delete(linkField.id);
      this.pendingLinkCteNames.delete(linkField.id);
    }
  }

  visitNumberField(_field: NumberFieldCore): void {}
  visitSingleLineTextField(_field: SingleLineTextFieldCore): void {}
  visitLongTextField(_field: LongTextFieldCore): void {}
  visitAttachmentField(_field: AttachmentFieldCore): void {}
  visitCheckboxField(_field: CheckboxFieldCore): void {}
  visitDateField(_field: DateFieldCore): void {}
  visitRatingField(_field: RatingFieldCore): void {}
  visitAutoNumberField(_field: AutoNumberFieldCore): void {}
  visitLinkField(field: LinkFieldCore): void {
    if (field.hasError) return;
    const existingCteName = this.state.getCteName(field.id);
    if (existingCteName) {
      this.ensureLinkCteJoined(existingCteName);
      return;
    }
    this.generateLinkFieldCte(field);
  }
  visitRollupField(_field: RollupFieldCore): void {}
  visitConditionalRollupField(field: ConditionalRollupFieldCore): void {
    if (field.isLookup) {
      return;
    }
    this.generateConditionalRollupFieldCte(field);
  }
  visitSingleSelectField(_field: SingleSelectFieldCore): void {}
  visitMultipleSelectField(_field: MultipleSelectFieldCore): void {}
  visitFormulaField(_field: FormulaFieldCore): void {}
  visitCreatedTimeField(_field: CreatedTimeFieldCore): void {}
  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): void {}
  visitUserField(_field: UserFieldCore): void {}
  visitCreatedByField(_field: CreatedByFieldCore): void {}
  visitLastModifiedByField(_field: LastModifiedByFieldCore): void {}
  visitButtonField(_field: ButtonFieldCore): void {}

  private ensureLinkCteJoined(cteName: string): void {
    if (this.state.isCteJoined(cteName)) {
      return;
    }
    const mainAlias = getTableAliasFromTable(this.table);
    this.qb.leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);
    this.state.markCteJoined(cteName);
  }
}
const getLinkFieldId = (options: FieldCore['lookupOptions']): string | undefined => {
  return options && isLinkLookupOptions(options) ? options.linkFieldId : undefined;
};
