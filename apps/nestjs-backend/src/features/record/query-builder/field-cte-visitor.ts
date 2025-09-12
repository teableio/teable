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
  type SingleLineTextFieldCore,
  type SingleSelectFieldCore,
  type UserFieldCore,
  type ButtonFieldCore,
  type Tables,
  type TableDomain,
  type ILinkFieldOptions,
  type FieldCore,
  type IRollupFieldOptions,
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
    // Use untyped NULL to safely fit any target column type.
    if (field.hasError) {
      return 'NULL';
    }

    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      this.foreignTable,
      new ScopedSelectionState(this.state),
      this.dialect,
      undefined,
      true
    );

    const foreignAlias = this.getForeignAlias();
    const targetLookupField = field.getForeignLookupField(this.foreignTable);
    // 依赖解析交由 SQL 转换器通过 CTE map 处理（不再注入 selection 覆盖）

    if (!targetLookupField) {
      // Try to fetch via the CTE of the foreign link if present
      const nestedLinkFieldId = field.lookupOptions?.linkFieldId;
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
      return 'NULL';
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
      return 'NULL';
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
    if (targetLookupField.isLookup && targetLookupField.lookupOptions) {
      const nestedLinkFieldId = targetLookupField.lookupOptions.linkFieldId;
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
    const linkForOrderingId = field.lookupOptions?.linkFieldId;
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
          const linkForOrderingId = field.lookupOptions?.linkFieldId;
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
      const linkForOrderingId = field.lookupOptions?.linkFieldId;
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
      return 'NULL';
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
      true
    );

    const foreignAlias = this.getForeignAlias();
    const targetLookupField = field.getForeignLookupField(this.foreignTable);
    if (!targetLookupField) {
      return 'NULL';
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
    if (targetLookupField.lookupOptions) {
      const nestedLinkFieldId = targetLookupField.lookupOptions.linkFieldId;
      if (nestedLinkFieldId && this.fieldCteMap.has(nestedLinkFieldId)) {
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
    const linkField = field.getLinkField(this.table);
    const options = linkField?.options as ILinkFieldOptions;
    const isSingleValueRelationship =
      options.relationship === Relationship.ManyOne || options.relationship === Relationship.OneOne;

    if (isSingleValueRelationship) {
      return this.buildSingleValueRollup(field, expression);
    }
    return this.buildAggregateRollup(field, targetLookupField, expression);
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

  public build() {
    const list = getOrderedFieldsByProjection(this.table, this.projection) as FieldCore[];
    this.filteredIdSet = new Set(list.map((f) => f.id));
    for (const field of list) {
      field.accept(this);
    }
  }

  private generateLinkFieldCte(linkField: LinkFieldCore): void {
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
      const nestedLinkId = target?.lookupOptions?.linkFieldId;
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
        cqb.select(cqb.client.raw(`${linkValue} as link_value`));

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
          cqb
            .from(`${this.table.dbTableName} as ${mainAlias}`)
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

          cqb
            .from(`${this.table.dbTableName} as ${mainAlias}`)
            .leftJoin(
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

          cqb.from(`${this.table.dbTableName} as ${mainAlias}`);

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
      })
      .leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);

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

    // Collect lookup fields on main table that depend on this link
    let lookupFields = mainToForeignLinkField.getLookupFields(mainTable);
    if (limitLookupIds) {
      lookupFields = lookupFields.filter((f) => limitLookupIds.has(f.id));
    }
    for (const lookupField of lookupFields) {
      const target = lookupField.getForeignLookupField(foreignTable);
      if (target) {
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
        for (const lf of target.getLinkFields(foreignTable)) {
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
      } else {
        const nestedId = lookupField.lookupOptions?.lookupFieldId;
        const lf = nestedId
          ? (foreignTable.getField(nestedId) as LinkFieldCore | undefined)
          : undefined;
        if (lf && lf.type === FieldType.Link && !nestedLinkFields.has(lf.id)) {
          nestedLinkFields.set(lf.id, lf);
        }
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
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
        for (const lf of target.getLinkFields(foreignTable)) {
          if (!nestedLinkFields.has(lf.id)) nestedLinkFields.set(lf.id, lf);
        }
      } else {
        const nestedId = rollupField.lookupOptions?.lookupFieldId;
        const lf = nestedId
          ? (foreignTable.getField(nestedId) as LinkFieldCore | undefined)
          : undefined;
        if (lf && lf.type === FieldType.Link && !nestedLinkFields.has(lf.id)) {
          nestedLinkFields.set(lf.id, lf);
        }
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
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (this.fieldCteMap.has(lf.id)) {
            nestedJoins.add(lf.id);
          }
        }
        if (
          target.lookupOptions?.linkFieldId &&
          this.fieldCteMap.has(target.lookupOptions.linkFieldId)
        ) {
          nestedJoins.add(target.lookupOptions.linkFieldId);
        }
      }
    }

    for (const rollupField of rollupFields) {
      const target = rollupField.getForeignLookupField(foreignTable);
      if (target) {
        if (target.type === FieldType.Link) {
          const lf = target as LinkFieldCore;
          if (this.fieldCteMap.has(lf.id)) {
            nestedJoins.add(lf.id);
          }
        }
        if (
          target.lookupOptions?.linkFieldId &&
          this.fieldCteMap.has(target.lookupOptions.linkFieldId)
        ) {
          nestedJoins.add(target.lookupOptions.linkFieldId);
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
      cqb.select(cqb.client.raw(`${linkValue} as link_value`));

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
        cqb.select(cqb.client.raw(`${rollupValue} as "rollup_${rollupField.id}"`));
      }

      if (usesJunctionTable) {
        cqb
          .from(`${table.dbTableName} as ${mainAlias}`)
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
        cqb
          .from(`${table.dbTableName} as ${mainAlias}`)
          .leftJoin(
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
        cqb.from(`${table.dbTableName} as ${mainAlias}`);

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
    // Skip errored link fields
    if (field.hasError) return;
    return this.generateLinkFieldCte(field);
  }
  visitRollupField(_field: RollupFieldCore): void {}
  visitSingleSelectField(_field: SingleSelectFieldCore): void {}
  visitMultipleSelectField(_field: MultipleSelectFieldCore): void {}
  visitFormulaField(_field: FormulaFieldCore): void {}
  visitCreatedTimeField(_field: CreatedTimeFieldCore): void {}
  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): void {}
  visitUserField(_field: UserFieldCore): void {}
  visitCreatedByField(_field: CreatedByFieldCore): void {}
  visitLastModifiedByField(_field: LastModifiedByFieldCore): void {}
  visitButtonField(_field: ButtonFieldCore): void {}
}
