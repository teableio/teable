import type {
  FieldCore,
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
  IFieldVisitor,
  ButtonFieldCore,
  TableDomain,
} from '@teable/core';
import { DriverClient } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../db-provider/db.provider.interface';
import type { IFieldSelectName } from './field-select.type';
import type {
  IRecordSelectionMap,
  IMutableQueryBuilderState,
} from './record-query-builder.interface';
import { getTableAliasFromTable } from './record-query-builder.util';

/**
 * Field visitor that returns appropriate database column selectors for knex.select()
 *
 * For regular fields: returns the dbFieldName as string
 *
 * The returned value can be used directly with knex.select() or knex.raw()
 *
 * Also maintains a selectionMap that tracks field ID to selector name mappings,
 * which can be accessed via getSelectionMap() method.
 */
export class FieldSelectVisitor implements IFieldVisitor<IFieldSelectName> {
  constructor(
    private readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly table: TableDomain,
    private readonly state: IMutableQueryBuilderState,
    private readonly withAlias: boolean = true
  ) {}

  private get tableAlias() {
    return getTableAliasFromTable(this.table);
  }

  /**
   * Returns the selection map containing field ID to selector name mappings
   * @returns Map where key is field ID and value is the selector name/expression
   */
  public getSelectionMap(): IRecordSelectionMap {
    return new Map(this.state.getSelectionMap());
  }

  /**
   * Generate column select with
   *
   * @example
   *   generateColumnSelectWithAlias('name') // returns 'name'
   *
   * @param name  column name
   * @returns String column name with table alias or Raw expression
   */
  private generateColumnSelect(name: string): IFieldSelectName {
    const alias = this.tableAlias;
    if (!alias) {
      return name;
    }
    return this.qb.client.raw(`??."${name}"`, [alias]);
  }

  /**
   * Returns the appropriate column selector for a field
   * @param field The field to get the selector for
   * @returns String column name with table alias or Raw expression
   */
  private getColumnSelector(field: { dbFieldName: string }): IFieldSelectName {
    return this.generateColumnSelect(field.dbFieldName);
  }

  /**
   * Check if field is a Lookup field and return appropriate selector
   */
  private checkAndSelectLookupField(field: FieldCore): IFieldSelectName {
    // Check if this is a Lookup field
    const fieldCteMap = this.state.getFieldCteMap();
    if (field.isLookup && field.lookupOptions && fieldCteMap) {
      // Check if the field has error (e.g., target field deleted)
      if (field.hasError) {
        // Field has error, return NULL to indicate this field should be null
        const rawExpression = this.qb.client.raw(`NULL as ??`, [field.dbFieldName]);
        this.state.setSelection(field.id, 'NULL');
        return rawExpression;
      }

      // For regular lookup fields, use the corresponding link field CTE
      const { linkFieldId } = field.lookupOptions;
      if (linkFieldId && fieldCteMap.has(linkFieldId)) {
        const cteName = fieldCteMap.get(linkFieldId)!;
        // For PostgreSQL multi-value lookup, flatten nested arrays via per-row recursive CTE
        if (this.dbProvider.driver === DriverClient.Pg && field.isMultipleCellValue) {
          const flattenedExpr = `(
            WITH RECURSIVE f(e) AS (
              SELECT "${cteName}"."lookup_${field.id}"::jsonb
              UNION ALL
              SELECT jsonb_array_elements(f.e)
              FROM f
              WHERE jsonb_typeof(f.e) = 'array'
            )
            SELECT jsonb_agg(e) FILTER (WHERE jsonb_typeof(e) <> 'array') FROM f
          )`;
          const rawExpression = this.qb.client.raw(`${flattenedExpr} as ??`, [field.dbFieldName]);
          // 让 WHERE/公式等引用到拍平后的表达式
          this.state.setSelection(field.id, flattenedExpr);
          return rawExpression;
        }
        // Default: return CTE column directly
        const rawExpression = this.qb.client.raw(`??."lookup_${field.id}" as ??`, [
          cteName,
          field.dbFieldName,
        ]);
        this.state.setSelection(field.id, `"${cteName}"."lookup_${field.id}"`);
        return rawExpression;
      }
    }

    // Fallback to the original column
    const columnSelector = this.getColumnSelector(field);
    this.state.setSelection(field.id, columnSelector);
    return columnSelector;
  }

  /**
   * Returns the generated column selector for formula fields
   * @param field The formula field
   */
  private getFormulaColumnSelector(field: FormulaFieldCore): IFieldSelectName {
    if (!field.isLookup) {
      const isPersistedAsGeneratedColumn = field.getIsPersistedAsGeneratedColumn();
      if (!isPersistedAsGeneratedColumn) {
        const sql = this.dbProvider.convertFormulaToSelectQuery(field.options.expression, {
          table: this.table,
          tableAlias: this.tableAlias, // Pass table alias to the conversion context
          selectionMap: this.getSelectionMap(),
        });
        // The table alias is now handled inside the SQL conversion visitor
        const finalSql = sql;

        if (this.withAlias) {
          const rawExpression = this.qb.client.raw(`${finalSql} as ??`, [
            field.getGeneratedColumnName(),
          ]);
          const selectorName = this.qb.client.raw(finalSql);
          this.state.setSelection(field.id, selectorName);
          return rawExpression;
        } else {
          // Return just the expression without alias for use in jsonb_build_object
          return finalSql;
        }
      }
      // For generated columns, use table alias if provided
      const columnName = field.getGeneratedColumnName();
      const columnSelector = this.generateColumnSelect(columnName);
      this.state.setSelection(field.id, columnSelector);
      return columnSelector;
    }
    // For lookup formula fields, use table alias if provided
    const lookupSelector = this.generateColumnSelect(field.dbFieldName);
    this.state.setSelection(field.id, lookupSelector);
    return lookupSelector;
  }

  // Basic field types
  visitNumberField(field: NumberFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitSingleLineTextField(field: SingleLineTextFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitLongTextField(field: LongTextFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitAttachmentField(field: AttachmentFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitCheckboxField(field: CheckboxFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitDateField(field: DateFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitRatingField(field: RatingFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitAutoNumberField(field: AutoNumberFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitLinkField(field: LinkFieldCore): IFieldSelectName {
    // Check if this is a Lookup field first
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }

    const fieldCteMap = this.state.getFieldCteMap();
    if (!fieldCteMap?.has(field.id)) {
      throw new Error(`Link field ${field.id} should always select from a CTE, but no CTE found`);
    }

    const cteName = fieldCteMap.get(field.id)!;
    // Return Raw expression for selecting from CTE
    const rawExpression = this.qb.client.raw(`??.link_value as ??`, [cteName, field.dbFieldName]);
    // For WHERE clauses, store the CTE column reference
    this.state.setSelection(field.id, `"${cteName}"."link_value"`);
    return rawExpression;
  }

  visitRollupField(field: RollupFieldCore): IFieldSelectName {
    const fieldCteMap = this.state.getFieldCteMap();
    if (!fieldCteMap?.has(field.lookupOptions.linkFieldId)) {
      throw new Error(`Rollup field ${field.id} requires a field CTE map`);
    }

    // Rollup fields use the link field's CTE with pre-computed rollup values
    // Check if the field has error (e.g., target field deleted)
    if (field.hasError) {
      // Field has error, return NULL to indicate this field should be null
      const rawExpression = this.qb.client.raw(`NULL as ??`, [field.dbFieldName]);
      this.state.setSelection(field.id, 'NULL');
      return rawExpression;
    }

    const cteName = fieldCteMap.get(field.lookupOptions.linkFieldId)!;

    // Return Raw expression for selecting pre-computed rollup value from link CTE
    const rawExpression = this.qb.client.raw(`??."rollup_${field.id}" as ??`, [
      cteName,
      field.dbFieldName,
    ]);
    // For WHERE clauses, store the CTE column reference
    this.state.setSelection(field.id, `"${cteName}"."rollup_${field.id}"`);
    return rawExpression;
  }

  // Select field types
  visitSingleSelectField(field: SingleSelectFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitMultipleSelectField(field: MultipleSelectFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitButtonField(field: ButtonFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  // Formula field types - these may use generated columns
  visitFormulaField(field: FormulaFieldCore): IFieldSelectName {
    // For Formula fields, check Lookup first, then use formula logic
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }
    return this.getFormulaColumnSelector(field);
  }

  visitCreatedTimeField(field: CreatedTimeFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  // User field types
  visitUserField(field: UserFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitCreatedByField(field: CreatedByFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }
}
