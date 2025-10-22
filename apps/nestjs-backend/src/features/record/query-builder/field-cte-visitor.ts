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
  SortFunc,
  isLinkLookupOptions,
  normalizeConditionalLimit,
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
    private readonly currentLinkFieldId?: string
  ) {}
  private get fieldCteMap() {
    return this.state.getFieldCteMap();
  }
  private getForeignAlias(): string {
    return this.foreignAliasOverride || getTableAliasFromTable(this.foreignTable);
  }
  private getJsonAggregationFunction(fieldReference: string): string {
    return this.dialect.jsonAggregateNonNull(fieldReference);
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
    // Parse the rollup function from expression like 'sum({values})'
    const functionMatch = expression.match(/^(\w+)\(\{values\}\)$/);
    if (!functionMatch) {
      throw new Error(`Invalid rollup expression: ${expression}`);
    }
    const functionName = functionMatch[1].toLowerCase();
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
    expression: string,
    fieldExpression: string
  ): string {
    const functionMatch = expression.match(/^(\w+)\(\{values\}\)$/);
    if (!functionMatch) {
      throw new Error(`Invalid rollup expression: ${expression}`);
    }

    const functionName = functionMatch[1].toLowerCase();

    return this.dialect.singleValueRollupAggregate(functionName, fieldExpression);
  }
  private buildSingleValueRollup(field: FieldCore, expression: string): string {
    const rollupOptions = field.options as IRollupFieldOptions;
    const rollupFilter = (field as FieldCore).getFilter?.();
    if (rollupFilter) {
      const sub = this.buildForeignFilterSubquery(rollupFilter);
      const filteredExpr =
        this.dbProvider.driver === DriverClient.Pg
          ? `CASE WHEN EXISTS ${sub} THEN ${expression} ELSE NULL END`
          : expression;
      return this.generateSingleValueRollupAggregation(rollupOptions.expression, filteredExpr);
    }
    return this.generateSingleValueRollupAggregation(rollupOptions.expression, expression);
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

    const rollupFilter = (rollupField as FieldCore).getFilter?.();
    if (rollupFilter && this.dbProvider.driver === DriverClient.Pg) {
      const sub = this.buildForeignFilterSubquery(rollupFilter);
      const filteredExpr = `CASE WHEN EXISTS ${sub} THEN ${expression} ELSE NULL END`;
      return this.generateRollupAggregation(
        rollupOptions.expression,
        filteredExpr,
        targetField,
        orderByField,
        rowPresenceField
      );
    }

    return this.generateRollupAggregation(
      rollupOptions.expression,
      expression,
      targetField,
      orderByField,
      rowPresenceField
    );
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
        return this.dialect.typedNullFor(field.dbFieldType);
      }
      return `"${cteName}"."conditional_lookup_${field.id}"`;
    }

    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      this.foreignTable,
      new ScopedSelectionState(this.state),
      this.dialect,
      undefined,
      true,
      true
    );

    const foreignAlias = this.getForeignAlias();
    const targetLookupField = field.getForeignLookupField(this.foreignTable);

    if (!targetLookupField) {
      // Try to fetch via the CTE of the foreign link if present
      const nestedLinkFieldId = getLinkFieldId(field.lookupOptions);
      const fieldCteMap = this.state.getFieldCteMap();
      // Guard against self-referencing the CTE being defined (would require WITH RECURSIVE)
      if (
        nestedLinkFieldId &&
        fieldCteMap.has(nestedLinkFieldId) &&
        nestedLinkFieldId !== this.currentLinkFieldId
      ) {
        const nestedCteName = fieldCteMap.get(nestedLinkFieldId)!;
        // Check if this CTE is JOINed in current scope
        if (this.joinedCtes?.has(nestedLinkFieldId)) {
          const linkExpr = `"${nestedCteName}"."link_value"`;
          return this.isSingleValueRelationshipContext
            ? linkExpr
            : field.isMultipleCellValue
              ? this.getJsonAggregationFunction(linkExpr)
              : linkExpr;
        } else {
          // Fallback to subquery if CTE not JOINed in current scope
          const linkExpr = `((SELECT link_value FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
          return this.isSingleValueRelationshipContext
            ? linkExpr
            : field.isMultipleCellValue
              ? this.getJsonAggregationFunction(linkExpr)
              : linkExpr;
        }
      }
      // If still not found or field has error, return NULL instead of throwing
      return this.dialect.typedNullFor(field.dbFieldType);
    }

    // If the target is a Link field, read its link_value from the JOINed CTE or subquery
    if (targetLookupField.type === FieldType.Link) {
      const nestedLinkFieldId = (targetLookupField as LinkFieldCore).id;
      const fieldCteMap = this.state.getFieldCteMap();
      if (fieldCteMap.has(nestedLinkFieldId) && nestedLinkFieldId !== this.currentLinkFieldId) {
        const nestedCteName = fieldCteMap.get(nestedLinkFieldId)!;
        // Check if this CTE is JOINed in current scope
        if (this.joinedCtes?.has(nestedLinkFieldId)) {
          const linkExpr = `"${nestedCteName}"."link_value"`;
          return this.isSingleValueRelationshipContext
            ? linkExpr
            : field.isMultipleCellValue
              ? this.getJsonAggregationFunction(linkExpr)
              : linkExpr;
        } else {
          // Fallback to subquery if CTE not JOINed in current scope
          const linkExpr = `((SELECT link_value FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
          return this.isSingleValueRelationshipContext
            ? linkExpr
            : field.isMultipleCellValue
              ? this.getJsonAggregationFunction(linkExpr)
              : linkExpr;
        }
      }
      // If self-referencing or missing, return NULL
      return this.dialect.typedNullFor(field.dbFieldType);
    }

    // If the target is a Rollup field, read its precomputed rollup value from the link CTE
    if (targetLookupField.type === FieldType.Rollup) {
      const rollupField = targetLookupField as RollupFieldCore;
      const rollupLinkField = rollupField.getLinkField(this.foreignTable);
      if (rollupLinkField) {
        const nestedLinkFieldId = rollupLinkField.id;
        if (this.fieldCteMap.has(nestedLinkFieldId)) {
          const nestedCteName = this.fieldCteMap.get(nestedLinkFieldId)!;
          let expr: string;
          if (this.joinedCtes?.has(nestedLinkFieldId)) {
            expr = `"${nestedCteName}"."rollup_${rollupField.id}"`;
          } else {
            expr = `((SELECT "rollup_${rollupField.id}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
          }
          return this.isSingleValueRelationshipContext
            ? expr
            : field.isMultipleCellValue
              ? this.getJsonAggregationFunction(expr)
              : expr;
        }
      }
    }

    // If the target is itself a lookup, reference its precomputed value from the JOINed CTE or subquery
    let expression: string;
    if (targetLookupField.isLookup) {
      const nestedLinkFieldId = getLinkFieldId(targetLookupField.lookupOptions);
      const fieldCteMap = this.state.getFieldCteMap();
      // Prefer nested CTE if available; otherwise, derive CTE name and use subquery
      if (nestedLinkFieldId) {
        // Derive CTE name deterministically to reference the pre-generated nested CTE
        const derivedCteName = `CTE_${getTableAliasFromTable(this.foreignTable)}_${nestedLinkFieldId}`;
        const nestedCteName = fieldCteMap.get(nestedLinkFieldId) ?? derivedCteName;
        if (nestedCteName) {
          if (this.joinedCtes?.has(nestedLinkFieldId)) {
            expression = `"${nestedCteName}"."lookup_${targetLookupField.id}"`;
          } else {
            expression = `((SELECT "lookup_${targetLookupField.id}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
          }
        } else {
          // As a last resort, fallback to direct select using select visitor
          const targetFieldResult = targetLookupField.accept(selectVisitor);
          expression =
            typeof targetFieldResult === 'string'
              ? targetFieldResult
              : targetFieldResult.toSQL().sql;
        }
      } else {
        const targetFieldResult = targetLookupField.accept(selectVisitor);
        expression =
          typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
      }
    } else {
      const targetFieldResult = targetLookupField.accept(selectVisitor);
      expression =
        typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
      // Self-join: ensure expression uses the foreign alias override
      const defaultForeignAlias = getTableAliasFromTable(this.foreignTable);
      if (defaultForeignAlias !== foreignAlias) {
        expression = expression.replaceAll(`"${defaultForeignAlias}"`, `"${foreignAlias}"`);
      }

      // For Postgres multi-value lookups targeting datetime-like fields, normalize the
      // element expression to an ISO8601 UTC string so downstream JSON comparisons using
      // lexicographical ranges (jsonpath @ >= "..." && @ <= "...") behave correctly.
      // Do NOT alter single-value lookups to preserve native type comparisons in filters.
      if (
        this.dbProvider.driver === DriverClient.Pg &&
        field.isMultipleCellValue &&
        isDateLikeField(targetLookupField)
      ) {
        // Format: 2020-01-10T16:00:00.000Z
        expression = `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
      }
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
        return `json_agg(${expression} ORDER BY ${orderByClause}) FILTER (WHERE ${expression} IS NOT NULL)`;
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
      if (orderByClause) {
        return `json_agg(${expression} ORDER BY ${orderByClause}) FILTER (WHERE (EXISTS ${sub}) AND ${expression} IS NOT NULL)`;
      }
      return `json_agg(${expression}) FILTER (WHERE (EXISTS ${sub}) AND ${expression} IS NOT NULL)`;
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

    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      foreignTable,
      new ScopedSelectionState(this.state),
      this.dialect,
      foreignTableAlias,
      true,
      true
    );
    const targetFieldResult = targetLookupField.accept(selectVisitor);
    let rawSelectionExpression =
      typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;

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
          return `json_agg(${conditionalJsonObject} ORDER BY ${orderByClause}) FILTER (WHERE ${appliedFilter})`;
        } else {
          // For single value relationships (ManyOne, OneOne)
          // If lookup field is a Formula, return array-of-one to keep API consistent with tests
          const isFormulaLookup = targetLookupField.type === FieldType.Formula;
          const cond = linkFilterSub
            ? `${recordIdRef} IS NOT NULL AND EXISTS ${linkFilterSub}`
            : `${recordIdRef} IS NOT NULL`;
          if (isFormulaLookup) {
            return `CASE WHEN ${cond} THEN jsonb_build_array(${conditionalJsonObject})::jsonb ELSE '[]'::jsonb END`;
          }
          // Otherwise, return single object or null
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
          // For single value relationships
          // If lookup field is a Formula, keep array-of-one when present, but return NULL when empty
          const isFormulaLookup = targetLookupField.type === FieldType.Formula;
          if (isFormulaLookup) {
            return `CASE WHEN ${recordIdRef} IS NOT NULL THEN json_array(${conditionalJsonObject}) ELSE NULL END`;
          }
          return `CASE WHEN ${recordIdRef} IS NOT NULL THEN ${conditionalJsonObject} ELSE NULL END`;
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

    const qb = this.qb.client.queryBuilder();
    const scopedState = new ScopedSelectionState(this.state);
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      this.foreignTable,
      scopedState,
      this.dialect,
      this.getForeignAlias(),
      true,
      false
    );

    const foreignAlias = this.getForeignAlias();
    const targetLookupField = field.getForeignLookupField(this.foreignTable);
    if (!targetLookupField) {
      return this.dialect.typedNullFor(field.dbFieldType);
    }
    // If the target of rollup depends on a foreign link CTE, reference the JOINed CTE columns or use subquery
    if (targetLookupField.type === FieldType.Formula) {
      const formulaField = targetLookupField as FormulaFieldCore;
      const referenced = formulaField.getReferenceFields(this.foreignTable);
      for (const ref of referenced) {
        // Pre-generate nested CTEs for foreign-table link dependencies if any lookup/rollup targets are themselves lookup fields.
        ref.accept(selectVisitor);
      }
    }

    // If the target of rollup depends on a foreign link CTE, reference the JOINed CTE columns or use subquery
    let expression: string;
    const nestedLinkFieldId = getLinkFieldId(targetLookupField.lookupOptions);
    if (nestedLinkFieldId) {
      if (this.fieldCteMap.has(nestedLinkFieldId)) {
        const nestedCteName = this.fieldCteMap.get(nestedLinkFieldId)!;
        const columnName = targetLookupField.isLookup
          ? `lookup_${targetLookupField.id}`
          : targetLookupField.type === FieldType.Rollup
            ? `rollup_${targetLookupField.id}`
            : undefined;
        if (columnName) {
          // Check if this CTE is JOINed in current scope
          if (this.joinedCtes?.has(nestedLinkFieldId)) {
            expression = `"${nestedCteName}"."${columnName}"`;
          } else {
            // Fallback to subquery if CTE not JOINed in current scope
            expression = `((SELECT "${columnName}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
          }
        } else {
          const targetFieldResult = targetLookupField.accept(selectVisitor);
          expression =
            typeof targetFieldResult === 'string'
              ? targetFieldResult
              : targetFieldResult.toSQL().sql;
        }
      } else {
        const targetFieldResult = targetLookupField.accept(selectVisitor);
        expression =
          typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
      }
    } else {
      const targetFieldResult = targetLookupField.accept(selectVisitor);
      expression =
        typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
    }

    if (
      targetLookupField.isConditionalLookup ||
      (targetLookupField.type === FieldType.ConditionalRollup && !targetLookupField.isLookup)
    ) {
      const nestedCteName = this.fieldCteMap.get(targetLookupField.id);
      if (nestedCteName) {
        const columnName =
          targetLookupField.type === FieldType.ConditionalRollup && !targetLookupField.isLookup
            ? `conditional_rollup_${targetLookupField.id}`
            : `conditional_lookup_${targetLookupField.id}`;
        if (this.joinedCtes?.has(targetLookupField.id)) {
          expression = `"${nestedCteName}"."${columnName}"`;
        } else {
          expression = `((SELECT "${columnName}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
        }
      }
    }
    const linkField = field.getLinkField(this.table);
    const options = linkField?.options as ILinkFieldOptions;
    const isSingleValueRelationship =
      options.relationship === Relationship.ManyOne || options.relationship === Relationship.OneOne;

    if (isSingleValueRelationship) {
      return this.buildSingleValueRollup(field, expression);
    }
    return this.buildAggregateRollup(field, targetLookupField, expression);
  }

  visitConditionalRollupField(field: ConditionalRollupFieldCore): IFieldSelectName {
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
  private filteredIdSet?: Set<string>;
  private readonly projection?: string[];

  constructor(
    public readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly tables: Tables,
    state: IMutableQueryBuilderState | undefined,
    private readonly dialect: IRecordQueryDialectProvider,
    projection?: string[]
  ) {
    this.state = state ?? new RecordQueryBuilderManager('table');
    this._table = tables.mustGetEntryTable();
    this.projection = projection;
  }

  get table() {
    return this._table;
  }

  get fieldCteMap(): ReadonlyMap<string, string> {
    return this.state.getFieldCteMap();
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

  private parseRollupFunction(expression: string): string {
    const match = expression.match(/^(\w+)\(\{values\}\)$/);
    if (!match) {
      throw new Error(`Invalid rollup expression: ${expression}`);
    }
    return match[1].toLowerCase();
  }

  private shouldUseFormattedExpressionForAggregation(fn: string): boolean {
    switch (fn) {
      case 'array_join':
      case 'concatenate':
        return true;
      default:
        return false;
    }
  }

  private rollupFunctionSupportsOrdering(expression: string): boolean {
    const fn = this.parseRollupFunction(expression);
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
    const fn = this.parseRollupFunction(rollupExpression);
    return this.dialect.rollupAggregate(fn, fieldExpression, {
      targetField,
      rowPresenceExpr: `"${foreignAlias}"."${ID_FIELD_NAME}"`,
      orderByField: orderByClause,
      flattenNestedArray: fn === 'array_compact' && !!targetField.isConditionalLookup,
    });
  }

  private resolveConditionalComputedTargetExpression(
    targetField: FieldCore,
    foreignTable: TableDomain,
    foreignAlias: string,
    selectVisitor: FieldSelectVisitor
  ): string {
    if (targetField.type === FieldType.ConditionalRollup && !targetField.isLookup) {
      const conditionalTarget = targetField as ConditionalRollupFieldCore;
      this.generateConditionalRollupFieldCteForScope(foreignTable, conditionalTarget);
      const nestedCteName = this.state.getFieldCteMap().get(conditionalTarget.id);
      if (nestedCteName) {
        return `((SELECT "conditional_rollup_${conditionalTarget.id}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
      }
      const fallback = conditionalTarget.accept(selectVisitor);
      return typeof fallback === 'string' ? fallback : fallback.toSQL().sql;
    }

    if (targetField.isConditionalLookup) {
      const options = targetField.getConditionalLookupOptions?.();
      if (options) {
        this.generateConditionalLookupFieldCteForScope(foreignTable, targetField, options);
      }
      const nestedCteName = this.state.getFieldCteMap().get(targetField.id);
      if (nestedCteName) {
        const column =
          targetField.type === FieldType.ConditionalRollup
            ? `conditional_rollup_${targetField.id}`
            : `conditional_lookup_${targetField.id}`;
        return `((SELECT "${column}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
      }
    }

    const targetSelect = targetField.accept(selectVisitor);
    return typeof targetSelect === 'string' ? targetSelect : targetSelect.toSQL().sql;
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

      const qb = this.qb.client.queryBuilder();
      const selectVisitor = new FieldSelectVisitor(
        qb,
        this.dbProvider,
        foreignTable,
        new ScopedSelectionState(this.state),
        this.dialect,
        foreignAliasUsed,
        true
      );

      const rawExpression = this.resolveConditionalComputedTargetExpression(
        targetField,
        foreignTable,
        foreignAliasUsed,
        selectVisitor
      );
      const formattingVisitor = new FieldFormattingVisitor(rawExpression, this.dialect);
      const formattedExpression = targetField.accept(formattingVisitor);

      const aggregationFn = this.parseRollupFunction(expression);
      const aggregationInputExpression = this.shouldUseFormattedExpressionForAggregation(
        aggregationFn
      )
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
      const castedAggregateExpression = this.castExpressionForDbType(aggregateExpression, field);

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

        const selectionMap = new Map<string, IFieldSelectName>();
        for (const f of foreignTable.fields.ordered) {
          selectionMap.set(f.id, `"${foreignAliasUsed}"."${f.dbFieldName}"`);
        }

        const fieldReferenceSelectionMap = new Map<string, string>();
        const fieldReferenceFieldMap = new Map<string, FieldCore>();
        for (const mainField of table.fields.ordered) {
          fieldReferenceSelectionMap.set(mainField.id, `"${mainAlias}"."${mainField.dbFieldName}"`);
          fieldReferenceFieldMap.set(mainField.id, mainField as FieldCore);
        }

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

      this.qb.with(cteName, (cqb) => {
        cqb
          .select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`)
          .select(cqb.client.raw(`(${aggregateSql}) as "conditional_rollup_${field.id}"`))
          .modify((builder) => this.fromTableWithRestriction(builder, table, mainAlias));
      });

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
    if (field.hasError) return;
    if (this.state.getFieldCteMap().has(field.id)) return;
    if (this.conditionalLookupGenerationStack.has(field.id)) return;

    this.conditionalLookupGenerationStack.add(field.id);
    try {
      const { foreignTableId, lookupFieldId, filter, sort, limit } = options;
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

      const cteName = `CTE_CONDITIONAL_LOOKUP_${field.id}`;
      const mainAlias = getTableAliasFromTable(table);
      const foreignAlias = getTableAliasFromTable(foreignTable);
      const foreignAliasUsed = foreignAlias === mainAlias ? `${foreignAlias}_ref` : foreignAlias;

      const qb = this.qb.client.queryBuilder();
      const selectVisitor = new FieldSelectVisitor(
        qb,
        this.dbProvider,
        foreignTable,
        new ScopedSelectionState(this.state),
        this.dialect,
        foreignAliasUsed,
        true
      );

      const rawExpression = this.resolveConditionalComputedTargetExpression(
        targetField,
        foreignTable,
        foreignAliasUsed,
        selectVisitor
      );

      let orderByClause: string | undefined;
      if (sort?.fieldId) {
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

      const aggregateExpression =
        field.type === FieldType.ConditionalRollup
          ? this.dialect.jsonAggregateNonNull(rawExpression, orderByClause)
          : this.buildConditionalRollupAggregation(
              'array_compact({values})',
              rawExpression,
              targetField,
              foreignAliasUsed,
              orderByClause
            );
      const castedAggregateExpression = this.castExpressionForDbType(aggregateExpression, field);

      const applyConditionalFilter = (targetQb: Knex.QueryBuilder) => {
        if (!filter) return;

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

        const fieldReferenceSelectionMap = new Map<string, string>();
        const fieldReferenceFieldMap = new Map<string, FieldCore>();
        for (const mainField of table.fields.ordered) {
          fieldReferenceSelectionMap.set(mainField.id, `"${mainAlias}"."${mainField.dbFieldName}"`);
          fieldReferenceFieldMap.set(mainField.id, mainField as FieldCore);
        }

        this.dbProvider
          .filterQuery(targetQb, fieldMap, filter, undefined, {
            selectionMap,
            fieldReferenceSelectionMap,
            fieldReferenceFieldMap,
          })
          .appendQueryBuilder();
      };

      const aggregateSourceQuery = this.qb.client
        .queryBuilder()
        .select('*')
        .from(`${foreignTable.dbTableName} as ${foreignAliasUsed}`);

      applyConditionalFilter(aggregateSourceQuery);

      if (orderByClause) {
        aggregateSourceQuery.orderByRaw(orderByClause);
      }

      const resolvedLimit = normalizeConditionalLimit(limit);
      aggregateSourceQuery.limit(resolvedLimit);

      const aggregateQuery = this.qb.client
        .queryBuilder()
        .from(aggregateSourceQuery.as(foreignAliasUsed));

      aggregateQuery.select(this.qb.client.raw(`${castedAggregateExpression} as reference_value`));

      const aggregateSql = aggregateQuery.toQuery();
      const lookupAlias = `conditional_lookup_${field.id}`;
      const rollupAlias = `conditional_rollup_${field.id}`;

      this.qb.with(cteName, (cqb) => {
        cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
        cqb.select(cqb.client.raw(`(${aggregateSql}) as "${lookupAlias}"`));
        if (field.type === FieldType.ConditionalRollup) {
          cqb.select(cqb.client.raw(`(${aggregateSql}) as "${rollupAlias}"`));
        }
        this.fromTableWithRestriction(cqb, table, mainAlias);
      });

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
    const list = getOrderedFieldsByProjection(this.table, this.projection) as FieldCore[];
    this.filteredIdSet = new Set(list.map((f) => f.id));

    // Ensure CTEs for any link fields that are dependencies of the projected fields.
    // This allows selecting lookup/rollup values even when the link fields themselves
    // are not part of the projection.
    for (const field of list) {
      const linkFields = field.getLinkFields(this.table);
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

    // Determine which lookup/rollup fields are actually needed from this link
    let lookupFields = linkField.getLookupFields(this.table);
    let rollupFields = linkField.getRollupFields(this.table);
    if (this.filteredIdSet) {
      lookupFields = lookupFields.filter((f) => this.filteredIdSet!.has(f.id));
      rollupFields = rollupFields.filter((f) => this.filteredIdSet!.has(f.id));
    }

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

    // Helper: add dependent link fields from a target field
    const addDepLinksFromTarget = (field: FieldCore) => {
      const targetField = field.getForeignLookupField(foreignTable);
      if (!targetField) return;
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
      const depLinks = targetField.getLinkFields(foreignTable);
      for (const lf of depLinks) {
        if (!lf?.id) continue;
        if (!this.fieldCteMap.has(lf.id)) {
          // Pre-generate nested CTE for foreign link field
          this.generateLinkFieldCteForTable(foreignTable, lf);
        }
        nestedJoins.add(lf.id);
      }
    };

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
          linkField.id
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
            linkField.id
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
            linkField.id
          );
          const rollupValue = rollupField.accept(visitor);
          cqb.select(cqb.client.raw(`${rollupValue} as "rollup_${rollupField.id}"`));
        }

        if (usesJunctionTable) {
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
            const nestedCteName = this.state.getFieldCteMap().get(nestedLinkFieldId)!;
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
            const nestedCteName = this.state.getFieldCteMap().get(nestedLinkFieldId)!;
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
        } else if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
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
            const nestedCteName = this.state.getFieldCteMap().get(nestedLinkFieldId)!;
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

    this.state.setFieldCte(linkField.id, cteName);
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

    // Ensure deeper nested dependencies for this nested link are also generated
    this.generateNestedForeignCtesIfNeeded(table, foreignTable, linkField);

    // Collect all nested link dependencies that need to be JOINed
    const nestedJoins = new Set<string>();
    const lookupFields = linkField.getLookupFields(table);
    const rollupFields = linkField.getRollupFields(table);
    if (this.filteredIdSet) {
      // filteredIdSet belongs to the main table. For nested tables, we cannot filter
      // by main-table projection IDs; keep all nested lookup/rollup columns to ensure correctness.
    }

    // Check if any lookup/rollup fields depend on nested CTEs
    for (const lookupField of lookupFields) {
      const target = lookupField.getForeignLookupField(foreignTable);
      if (target) {
        if (target.type === FieldType.ConditionalRollup && !target.isLookup) {
          this.generateConditionalRollupFieldCteForScope(
            foreignTable,
            target as ConditionalRollupFieldCore
          );
        }
        if (target.isConditionalLookup) {
          const options = target.getConditionalLookupOptions?.();
          if (options) {
            this.generateConditionalLookupFieldCteForScope(foreignTable, target, options);
          }
        }
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (this.fieldCteMap.has(lf.id)) {
            nestedJoins.add(lf.id);
          }
        }
        const nestedLinkFieldId = getLinkFieldId(target.lookupOptions);
        if (nestedLinkFieldId && this.fieldCteMap.has(nestedLinkFieldId)) {
          nestedJoins.add(nestedLinkFieldId);
        }
      }
    }

    for (const rollupField of rollupFields) {
      const target = rollupField.getForeignLookupField(foreignTable);
      if (target) {
        if (target.type === FieldType.ConditionalRollup && !target.isLookup) {
          this.generateConditionalRollupFieldCteForScope(
            foreignTable,
            target as ConditionalRollupFieldCore
          );
        }
        if (target.isConditionalLookup) {
          const options = target.getConditionalLookupOptions?.();
          if (options) {
            this.generateConditionalLookupFieldCteForScope(foreignTable, target, options);
          }
        }
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (this.fieldCteMap.has(lf.id)) {
            nestedJoins.add(lf.id);
          }
        }
        const nestedLinkFieldId = getLinkFieldId(target.lookupOptions);
        if (nestedLinkFieldId && this.fieldCteMap.has(nestedLinkFieldId)) {
          nestedJoins.add(nestedLinkFieldId);
        }
      }
    }

    this.qb.with(cteName, (cqb) => {
      // Create set of JOINed CTEs for this scope
      const joinedCtesInScope = new Set(nestedJoins);

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
        linkField.id
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
          linkField.id
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
          linkField.id
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
          const nestedCteName = this.state.getFieldCteMap().get(nestedLinkFieldId)!;
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
          const nestedCteName = this.state.getFieldCteMap().get(nestedLinkFieldId)!;
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
      } else if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
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
          const nestedCteName = this.state.getFieldCteMap().get(nestedLinkFieldId)!;
          cqb.leftJoin(
            nestedCteName,
            `${nestedCteName}.main_record_id`,
            `${foreignAliasUsed}.__id`
          );
        }
      }
    });

    this.state.setFieldCte(linkField.id, cteName);
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
