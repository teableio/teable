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
  IFormulaConversionContext,
  ButtonFieldCore,
} from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IRecordSelectionMap } from '../record/query-builder/record-query-builder.interface';
import type { IFieldSelectName } from './field-select.type';

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
  private readonly selectionMap: IRecordSelectionMap = new Map();

  constructor(
    private readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly context: IFormulaConversionContext,
    private readonly fieldCteMap?: Map<string, string>,
    private readonly tableAlias?: string
  ) {}

  /**
   * Returns the selection map containing field ID to selector name mappings
   * @returns Map where key is field ID and value is the selector name/expression
   */
  public getSelectionMap(): Map<string, string> {
    return new Map(this.selectionMap);
  }

  /**
   * Returns the appropriate column selector for a field
   * @param field The field to get the selector for
   * @returns String column name with table alias or Raw expression
   */
  private getColumnSelector(field: { dbFieldName: string }): string {
    if (this.tableAlias) {
      return `${this.tableAlias}."${field.dbFieldName}"`;
    }
    return field.dbFieldName;
  }

  /**
   * Check if field is a Lookup field and return appropriate selector
   */
  private checkAndSelectLookupField(field: FieldCore): IFieldSelectName {
    // Check if this is a Lookup field
    if (field.isLookup && field.lookupOptions && this.fieldCteMap) {
      // First check if this is a nested lookup field with its own CTE
      const nestedCteName = `cte_nested_lookup_${field.id}`;
      if (this.fieldCteMap.has(field.id) && this.fieldCteMap.get(field.id) === nestedCteName) {
        // Return Raw expression for selecting from nested lookup CTE
        const rawExpression = this.qb.client.raw(`??."nested_lookup_value" as ??`, [
          nestedCteName,
          field.dbFieldName,
        ]);
        // For WHERE clauses, store the CTE column reference
        this.selectionMap.set(field.id, `${nestedCteName}.nested_lookup_value`);
        return rawExpression;
      }

      // Check if this is a lookup to link field with its own CTE
      const lookupToLinkCteName = `cte_lookup_to_link_${field.id}`;
      if (
        this.fieldCteMap?.has(field.id) &&
        this.fieldCteMap.get(field.id) === lookupToLinkCteName
      ) {
        // Return Raw expression for selecting from lookup to link CTE
        const rawExpression = this.qb.client.raw(`??."lookup_link_value" as ??`, [
          lookupToLinkCteName,
          field.dbFieldName,
        ]);
        // For WHERE clauses, store the CTE column reference
        this.selectionMap.set(field.id, `${lookupToLinkCteName}.lookup_link_value`);
        return rawExpression;
      }

      // For regular lookup fields, use the corresponding link field CTE
      const { linkFieldId } = field.lookupOptions;
      if (linkFieldId && this.fieldCteMap.has(linkFieldId)) {
        const cteName = this.fieldCteMap.get(linkFieldId)!;
        // Return Raw expression for selecting from link field CTE
        const rawExpression = this.qb.client.raw(`??."lookup_${field.id}" as ??`, [
          cteName,
          field.dbFieldName,
        ]);
        // For WHERE clauses, store the CTE column reference
        this.selectionMap.set(field.id, `${cteName}.lookup_${field.id}`);
        return rawExpression;
      }
    }

    // Fallback to the original column
    const columnSelector = this.getColumnSelector(field);
    this.selectionMap.set(field.id, columnSelector);
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
          fieldMap: this.context.fieldMap,
          fieldCteMap: this.fieldCteMap,
        });
        // Apply table alias to the formula expression if provided
        const finalSql = this.tableAlias ? sql.replace(/\b\w+\./g, `${this.tableAlias}.`) : sql;
        const rawExpression = this.qb.client.raw(`${finalSql} as ??`, [
          field.getGeneratedColumnName(),
        ]);
        const selectorName = this.qb.client.raw(finalSql).toQuery();
        this.selectionMap.set(field.id, selectorName);
        return rawExpression;
      }
      // For generated columns, use table alias if provided
      const columnName = field.getGeneratedColumnName();
      const columnSelector = this.tableAlias ? `${this.tableAlias}."${columnName}"` : columnName;
      this.selectionMap.set(field.id, columnSelector);
      return columnSelector;
    }
    // For lookup formula fields, use table alias if provided
    const lookupSelector = this.tableAlias
      ? `${this.tableAlias}."${field.dbFieldName}"`
      : field.dbFieldName;
    this.selectionMap.set(field.id, lookupSelector);
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

    // For non-Lookup Link fields, check if we have a CTE for this field
    if (this.fieldCteMap && this.fieldCteMap.has(field.id)) {
      const cteName = this.fieldCteMap.get(field.id)!;
      // Return Raw expression for selecting from CTE
      const rawExpression = this.qb.client.raw(`??.link_value as ??`, [cteName, field.dbFieldName]);
      // For WHERE clauses, store the CTE column reference
      this.selectionMap.set(field.id, `${cteName}.link_value`);
      return rawExpression;
    }

    // Fallback to the original pre-computed column for backward compatibility
    const columnSelector = this.getColumnSelector(field);
    this.selectionMap.set(field.id, columnSelector);
    return columnSelector;
  }

  visitRollupField(field: RollupFieldCore): IFieldSelectName {
    // Rollup fields use the link field's CTE with pre-computed rollup values
    if (field.lookupOptions && this.fieldCteMap) {
      const { linkFieldId } = field.lookupOptions;

      // Check if we have a CTE for the link field
      if (this.fieldCteMap.has(linkFieldId)) {
        const cteName = this.fieldCteMap.get(linkFieldId)!;

        // Return Raw expression for selecting pre-computed rollup value from link CTE
        const rawExpression = this.qb.client.raw(`??."rollup_${field.id}" as ??`, [
          cteName,
          field.dbFieldName,
        ]);
        // For WHERE clauses, store the CTE column reference
        this.selectionMap.set(field.id, `${cteName}.rollup_${field.id}`);
        return rawExpression;
      }
    }

    // Fallback to the original pre-computed column for backward compatibility
    const columnSelector = this.getColumnSelector(field);
    this.selectionMap.set(field.id, columnSelector);
    return columnSelector;
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
