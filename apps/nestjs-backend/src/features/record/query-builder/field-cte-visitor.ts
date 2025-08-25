/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-duplicated-branches */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-empty-function */
import { Logger } from '@nestjs/common';
import { DriverClient, FieldType, Relationship } from '@teable/core';
import type {
  IFieldVisitor,
  AttachmentFieldCore,
  AutoNumberFieldCore,
  CheckboxFieldCore,
  CreatedByFieldCore,
  CreatedTimeFieldCore,
  DateFieldCore,
  FormulaFieldCore,
  LastModifiedByFieldCore,
  LastModifiedTimeFieldCore,
  LinkFieldCore,
  LongTextFieldCore,
  MultipleSelectFieldCore,
  NumberFieldCore,
  RatingFieldCore,
  RollupFieldCore,
  SingleLineTextFieldCore,
  SingleSelectFieldCore,
  UserFieldCore,
  ButtonFieldCore,
  Tables,
  TableDomain,
  ILinkFieldOptions,
  FieldCore,
  IRollupFieldOptions,
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
import { getLinkUsesJunctionTable, getTableAliasFromTable } from './record-query-builder.util';

type ICteResult = void;

const JUNCTION_ALIAS = 'j';

class FieldCteSelectionVisitor implements IFieldVisitor<IFieldSelectName> {
  constructor(
    private readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly table: TableDomain,
    private readonly foreignTable: TableDomain,
    private readonly state: IReadonlyQueryBuilderState,
    private readonly joinedCtes?: Set<string>, // Track which CTEs are already JOINed in current scope
    private readonly isSingleValueRelationshipContext: boolean = false, // In ManyOne/OneOne CTEs, avoid aggregates
    private readonly foreignAliasOverride?: string
  ) {}

  private get fieldCteMap() {
    return this.state.getFieldCteMap();
  }

  private getForeignAlias(): string {
    return this.foreignAliasOverride || getTableAliasFromTable(this.foreignTable);
  }
  private getJsonAggregationFunction(fieldReference: string): string {
    const driver = this.dbProvider.driver;

    if (driver === DriverClient.Pg) {
      // Filter out null values to prevent null entries in the JSON array
      return `json_agg(${fieldReference}) FILTER (WHERE ${fieldReference} IS NOT NULL)`;
    } else if (driver === DriverClient.Sqlite) {
      // For SQLite, we need to handle null filtering differently
      return `json_group_array(${fieldReference}) WHERE ${fieldReference} IS NOT NULL`;
    }

    throw new Error(`Unsupported database driver: ${driver}`);
  }

  /**
   * Generate rollup aggregation expression based on rollup function
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private generateRollupAggregation(
    expression: string,
    fieldExpression: string,
    targetField: FieldCore,
    orderByField?: string
  ): string {
    // Parse the rollup function from expression like 'sum({values})'
    const functionMatch = expression.match(/^(\w+)\(\{values\}\)$/);
    if (!functionMatch) {
      throw new Error(`Invalid rollup expression: ${expression}`);
    }

    const functionName = functionMatch[1].toLowerCase();
    const castIfPg = (sql: string) =>
      this.dbProvider.driver === DriverClient.Pg ? `CAST(${sql} AS DOUBLE PRECISION)` : sql;

    switch (functionName) {
      case 'sum':
        return castIfPg(`COALESCE(SUM(${fieldExpression}), 0)`);
      case 'count':
        return castIfPg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'countall':
        // For multiple select fields, count individual elements in JSON arrays
        if (targetField.type === FieldType.MultipleSelect) {
          if (this.dbProvider.driver === DriverClient.Pg) {
            // PostgreSQL: Sum the length of each JSON array, ensure 0 when no records
            return castIfPg(
              `COALESCE(SUM(CASE WHEN ${fieldExpression} IS NOT NULL THEN jsonb_array_length(${fieldExpression}::jsonb) ELSE 0 END), 0)`
            );
          } else {
            // SQLite: Sum the length of each JSON array, ensure 0 when no records
            return castIfPg(
              `COALESCE(SUM(CASE WHEN ${fieldExpression} IS NOT NULL THEN json_array_length(${fieldExpression}) ELSE 0 END), 0)`
            );
          }
        }
        // For other field types, count non-null values, ensure 0 when no records
        return castIfPg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'counta':
        return castIfPg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'max':
        return castIfPg(`MAX(${fieldExpression})`);
      case 'min':
        return castIfPg(`MIN(${fieldExpression})`);
      case 'and':
        // For boolean AND, all values must be true (non-zero/non-null)
        return this.dbProvider.driver === DriverClient.Pg
          ? `BOOL_AND(${fieldExpression}::boolean)`
          : `MIN(${fieldExpression})`;
      case 'or':
        // For boolean OR, at least one value must be true
        return this.dbProvider.driver === DriverClient.Pg
          ? `BOOL_OR(${fieldExpression}::boolean)`
          : `MAX(${fieldExpression})`;
      case 'xor':
        // XOR is more complex, we'll use a custom expression
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COUNT(CASE WHEN ${fieldExpression}::boolean THEN 1 END) % 2 = 1)`
          : `(COUNT(CASE WHEN ${fieldExpression} THEN 1 END) % 2 = 1)`;
      case 'array_join':
      case 'concatenate':
        // Join all values into a single string with deterministic ordering
        if (this.dbProvider.driver === DriverClient.Pg) {
          return orderByField
            ? `STRING_AGG(${fieldExpression}::text, ', ' ORDER BY ${orderByField})`
            : `STRING_AGG(${fieldExpression}::text, ', ')`;
        }
        return `GROUP_CONCAT(${fieldExpression}, ', ')`;
      case 'array_unique':
        // Get unique values as JSON array
        return this.dbProvider.driver === DriverClient.Pg
          ? `json_agg(DISTINCT ${fieldExpression})`
          : `json_group_array(DISTINCT ${fieldExpression})`;
      case 'array_compact':
        // Get non-null values as JSON array
        return this.dbProvider.driver === DriverClient.Pg
          ? `json_agg(${fieldExpression}) FILTER (WHERE ${fieldExpression} IS NOT NULL)`
          : `json_group_array(${fieldExpression}) WHERE ${fieldExpression} IS NOT NULL`;
      default:
        throw new Error(`Unsupported rollup function: ${functionName}`);
    }
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

    switch (functionName) {
      case 'sum':
        // For single-value relationship, sum reduces to the value itself, but should be 0 when null
        return `COALESCE(${fieldExpression}, 0)`;
      case 'max':
      case 'min':
      case 'array_join':
      case 'concatenate':
        // For single-value relationship, these reduce to the value itself
        return `${fieldExpression}`;
      case 'count':
      case 'countall':
      case 'counta':
        // Presence check: 1 if not null, else 0
        return `CASE WHEN ${fieldExpression} IS NULL THEN 0 ELSE 1 END`;
      case 'and':
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COALESCE((${fieldExpression})::boolean, false))`
          : `(CASE WHEN ${fieldExpression} THEN 1 ELSE 0 END)`;
      case 'or':
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COALESCE((${fieldExpression})::boolean, false))`
          : `(CASE WHEN ${fieldExpression} THEN 1 ELSE 0 END)`;
      case 'xor':
        // With a single value, XOR is equivalent to the value itself
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COALESCE((${fieldExpression})::boolean, false))`
          : `(CASE WHEN ${fieldExpression} THEN 1 ELSE 0 END)`;
      case 'array_unique':
      case 'array_compact':
        // Wrap single value into JSON array if present else empty array
        return this.dbProvider.driver === DriverClient.Pg
          ? `(CASE WHEN ${fieldExpression} IS NULL THEN '[]'::json ELSE json_build_array(${fieldExpression}) END)`
          : `(CASE WHEN ${fieldExpression} IS NULL THEN json('[]') ELSE json_array(${fieldExpression}) END)`;
      default:
        // Fallback to the value to keep behavior sensible
        return `${fieldExpression}`;
    }
  }
  private visitLookupField(field: FieldCore): IFieldSelectName {
    if (!field.isLookup) {
      throw new Error('Not a lookup field');
    }

    // If this lookup field is marked as error, don't attempt to resolve, just return NULL
    if (field.hasError) {
      return 'NULL';
    }

    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      this.foreignTable,
      new ScopedSelectionState(this.state),
      false
    );

    const foreignAlias = this.getForeignAlias();
    const targetLookupField = field.getForeignLookupField(this.foreignTable);
    // 如果 lookup 指向 formula，则为 formula 内部引用到的 lookup/rollup 注入 CTE 列映射（覆盖 selectVisitor 的 state）
    if (targetLookupField?.type === FieldType.Formula) {
      const formulaField = targetLookupField as FormulaFieldCore;
      const referenced = formulaField.getReferenceFields(this.foreignTable);
      const overrideState = new ScopedSelectionState(this.state);
      for (const ref of referenced) {
        const linkId = ref.lookupOptions?.linkFieldId;
        if (!linkId) continue;
        const cteName = this.fieldCteMap.get(linkId);
        if (!cteName) continue;
        if (ref.isLookup) {
          overrideState.setSelection(ref.id, `"${cteName}"."lookup_${ref.id}"`);
        } else if (ref.type === FieldType.Rollup) {
          overrideState.setSelection(ref.id, `"${cteName}"."rollup_${ref.id}"`);
        }
      }
      (selectVisitor as unknown as { state: IMutableQueryBuilderState }).state = overrideState;
    }

    if (!targetLookupField) {
      // Try to fetch via the CTE of the foreign link if present
      const nestedLinkFieldId = field.lookupOptions?.linkFieldId;
      const fieldCteMap = this.state.getFieldCteMap();
      if (nestedLinkFieldId && fieldCteMap.has(nestedLinkFieldId)) {
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
      if (fieldCteMap.has(nestedLinkFieldId)) {
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
      if (nestedLinkFieldId && fieldCteMap.has(nestedLinkFieldId)) {
        const nestedCteName = fieldCteMap.get(nestedLinkFieldId)!;
        // Check if this CTE is JOINed in current scope
        if (this.joinedCtes?.has(nestedLinkFieldId)) {
          expression = `"${nestedCteName}"."lookup_${targetLookupField.id}"`;
        } else {
          // Fallback to subquery if CTE not JOINed in current scope
          expression = `((SELECT "lookup_${targetLookupField.id}" FROM "${nestedCteName}" WHERE "${nestedCteName}"."main_record_id" = "${foreignAlias}"."${ID_FIELD_NAME}"))`;
        }
      } else {
        // Fallback to direct select (should not happen if nested CTEs were generated correctly)
        const targetFieldResult = targetLookupField.accept(selectVisitor);
        expression =
          typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
      }
    } else {
      const targetFieldResult = targetLookupField.accept(selectVisitor);
      expression =
        typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
    }
    if (!field.isMultipleCellValue) {
      return expression;
    }
    // In single-value relationship context (ManyOne/OneOne), avoid aggregation to prevent unnecessary GROUP BY
    if (this.isSingleValueRelationshipContext) {
      return expression;
    }
    return this.getJsonAggregationFunction(expression);
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
      false
    );
    const targetFieldResult = targetLookupField.accept(selectVisitor);
    let targetFieldSelectionExpression =
      typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;

    // Apply field formatting if targetLookupField is provided
    const formattingVisitor = new FieldFormattingVisitor(targetFieldSelectionExpression, driver);
    targetFieldSelectionExpression = targetLookupField.accept(formattingVisitor);

    // Determine if this relationship should return multiple values (array) or single value (object)
    return match(driver)
      .with(DriverClient.Pg, () => {
        // Build JSON object with id and title, then strip null values to remove title key when null
        const conditionalJsonObject = `jsonb_strip_nulls(jsonb_build_object('id', ${recordIdRef}, 'title', ${targetFieldSelectionExpression}))::jsonb`;

        if (isMultiValue) {
          // Filter out null records and return empty array if no valid records exist
          // Order by junction table __id if available (for consistent insertion order)
          // For relationships without junction table, use the order column if field has order column

          const orderByField = match({ usesJunctionTable, hasOrderColumn })
            .with({ usesJunctionTable: true, hasOrderColumn: true }, () => {
              // ManyMany relationship: use junction table order column if available
              const linkField = field as LinkFieldCore;
              return `${junctionAlias}."${linkField.getOrderColumnName()}"`;
            })
            .with({ usesJunctionTable: true, hasOrderColumn: false }, () => {
              // ManyMany relationship: use junction table __id
              return `${junctionAlias}."__id"`;
            })
            .with({ usesJunctionTable: false, hasOrderColumn: true }, () => {
              // OneMany/ManyOne/OneOne relationship: use the order column in the foreign key table
              const linkField = field as LinkFieldCore;
              return `"${foreignTableAlias}"."${linkField.getOrderColumnName()}"`;
            })
            .with({ usesJunctionTable: false, hasOrderColumn: false }, () => recordIdRef) // Fallback to record ID if no order column is available
            .exhaustive();

          return `COALESCE(json_agg(${conditionalJsonObject} ORDER BY ${orderByField}) FILTER (WHERE ${recordIdRef} IS NOT NULL), '[]'::json)`;
        } else {
          // For single value relationships (ManyOne, OneOne), return single object or null
          return `CASE WHEN ${recordIdRef} IS NOT NULL THEN ${conditionalJsonObject} ELSE NULL END`;
        }
      })
      .with(DriverClient.Sqlite, () => {
        // Create conditional JSON object that only includes title if it's not null
        const conditionalJsonObject = `CASE
          WHEN ${targetFieldSelectionExpression} IS NOT NULL THEN json_object('id', ${recordIdRef}, 'title', ${targetFieldSelectionExpression})
          ELSE json_object('id', ${recordIdRef})
        END`;

        if (isMultiValue) {
          // For SQLite, we need to handle null filtering differently
          // Note: SQLite's json_group_array doesn't support ORDER BY, so ordering must be handled at query level
          return `CASE WHEN COUNT(${recordIdRef}) > 0 THEN json_group_array(${conditionalJsonObject}) ELSE '[]' END`;
        } else {
          // For single value relationships, return single object or null
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
      false
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
    const rollupOptions = field.options as IRollupFieldOptions;
    const linkField = field.getLinkField(this.table);
    const options = linkField?.options as ILinkFieldOptions;
    const isSingleValueRelationship =
      options.relationship === Relationship.ManyOne || options.relationship === Relationship.OneOne;

    if (isSingleValueRelationship) {
      return this.generateSingleValueRollupAggregation(rollupOptions.expression, expression);
    }

    // For aggregate rollups, derive a deterministic orderBy field if possible
    let orderByField: string | undefined;
    if (this.dbProvider.driver === DriverClient.Pg && linkField && options) {
      const usesJunctionTable = getLinkUsesJunctionTable(linkField);
      const hasOrderColumn = linkField.getHasOrderColumn();
      if (usesJunctionTable) {
        orderByField = hasOrderColumn
          ? `${JUNCTION_ALIAS}."${linkField.getOrderColumnName()}"`
          : `${JUNCTION_ALIAS}."__id"`;
      } else if (options.relationship === Relationship.OneMany) {
        const foreignAlias = this.getForeignAlias();
        orderByField = hasOrderColumn
          ? `"${foreignAlias}"."${linkField.getOrderColumnName()}"`
          : `"${foreignAlias}"."__id"`;
      }
    }

    return this.generateRollupAggregation(
      rollupOptions.expression,
      expression,
      targetLookupField,
      orderByField
    );
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

  constructor(
    public readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly tables: Tables,
    state?: IMutableQueryBuilderState
  ) {
    this.state = state ?? new RecordQueryBuilderManager();
    this._table = tables.mustGetEntryTable();
  }

  get table() {
    return this._table;
  }

  get fieldCteMap(): ReadonlyMap<string, string> {
    return this.state.getFieldCteMap();
  }

  public build() {
    for (const field of this.table.fields) {
      field.accept(this);
    }
  }

  private generateLinkFieldCte(linkField: LinkFieldCore): void {
    const foreignTable = this.tables.mustGetLinkForeignTable(linkField);
    const cteName = FieldCteVisitor.generateCTENameForField(this.table, linkField);
    const usesJunctionTable = getLinkUsesJunctionTable(linkField);
    const options = linkField.options as ILinkFieldOptions;
    const mainAlias = getTableAliasFromTable(this.table);
    const foreignAlias = getTableAliasFromTable(foreignTable);
    const foreignAliasUsed = foreignAlias === mainAlias ? `${foreignAlias}_f` : foreignAlias;
    const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = options;

    // Pre-generate nested CTEs for foreign-table link dependencies if any lookup/rollup targets are themselves lookup fields.
    this.generateNestedForeignCtesIfNeeded(this.table, foreignTable, linkField);

    // Collect all nested link dependencies that need to be JOINed
    const nestedJoins = new Set<string>();
    const lookupFields = linkField.getLookupFields(this.table);
    const rollupFields = linkField.getRollupFields(this.table);

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
          this.table,
          foreignTable,
          this.state,
          joinedCtesInScope,
          usesJunctionTable || relationship === Relationship.OneMany ? false : true,
          foreignAliasUsed
        );
        const linkValue = linkField.accept(visitor);

        cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
        cqb.select(cqb.client.raw(`${linkValue} as link_value`));

        for (const lookupField of lookupFields) {
          const visitor = new FieldCteSelectionVisitor(
            cqb,
            this.dbProvider,
            this.table,
            foreignTable,
            this.state,
            joinedCtesInScope,
            usesJunctionTable || relationship === Relationship.OneMany ? false : true,
            foreignAliasUsed
          );
          const lookupValue = lookupField.accept(visitor);
          cqb.select(cqb.client.raw(`${lookupValue} as "lookup_${lookupField.id}"`));
        }

        for (const rollupField of rollupFields) {
          const visitor = new FieldCteSelectionVisitor(
            cqb,
            this.dbProvider,
            this.table,
            foreignTable,
            this.state,
            joinedCtesInScope,
            usesJunctionTable || relationship === Relationship.OneMany ? false : true,
            foreignAliasUsed
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

          cqb.groupBy(`${mainAlias}.__id`);

          // For SQLite, add ORDER BY at query level
          if (this.dbProvider.driver === DriverClient.Sqlite) {
            if (linkField.getHasOrderColumn()) {
              cqb.orderBy(`${foreignAliasUsed}.${selfKeyName}_order`);
            } else {
              cqb.orderBy(`${foreignAliasUsed}.__id`);
            }
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
    mainToForeignLinkField: LinkFieldCore
  ): void {
    const nestedLinkFields = new Map<string, LinkFieldCore>();

    // Collect lookup fields on main table that depend on this link
    const lookupFields = mainToForeignLinkField.getLookupFields(mainTable);
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
    const rollupFields = mainToForeignLinkField.getRollupFields(mainTable);
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
    const foreignTable = this.tables.mustGetLinkForeignTable(linkField);
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
        table,
        foreignTable,
        this.state,
        joinedCtesInScope,
        usesJunctionTable || relationship === Relationship.OneMany ? false : true,
        foreignAliasUsed
      );
      const linkValue = linkField.accept(visitor);

      cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
      cqb.select(cqb.client.raw(`${linkValue} as link_value`));

      for (const lookupField of lookupFields) {
        const visitor = new FieldCteSelectionVisitor(
          cqb,
          this.dbProvider,
          table,
          foreignTable,
          this.state,
          joinedCtesInScope,
          usesJunctionTable || relationship === Relationship.OneMany ? false : true,
          foreignAliasUsed
        );
        const lookupValue = lookupField.accept(visitor);
        cqb.select(cqb.client.raw(`${lookupValue} as "lookup_${lookupField.id}"`));
      }

      for (const rollupField of rollupFields) {
        const visitor = new FieldCteSelectionVisitor(
          cqb,
          this.dbProvider,
          table,
          foreignTable,
          this.state,
          joinedCtesInScope,
          usesJunctionTable || relationship === Relationship.OneMany ? false : true,
          foreignAliasUsed
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
          cqb.orderBy(`${JUNCTION_ALIAS}.__id`);
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
            cqb.orderBy(`${foreignAliasUsed}.${selfKeyName}_order`);
          } else {
            cqb.orderBy(`${foreignAliasUsed}.__id`);
          }
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
