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
    private readonly aliasOverride?: string
  ) {}

  private get tableAlias() {
    return this.aliasOverride || getTableAliasFromTable(this.table);
  }

  private isViewContext(): boolean {
    return this.state.getContext() === 'view';
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
    return `"${alias}"."${name}"`;
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
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private checkAndSelectLookupField(field: FieldCore): IFieldSelectName {
    // Check if this is a Lookup field
    if (field.isLookup) {
      const fieldCteMap = this.state.getFieldCteMap();
      // Lookup has no standard column in base table.
      // When building from a materialized view, fallback to the view's column.
      if (this.isViewContext()) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      // Check if the field has error (e.g., target field deleted)
      if (field.hasError || !field.lookupOptions) {
        // Base-table context: return NULL to avoid missing-column errors.
        const raw = this.qb.client.raw('NULL');
        this.state.setSelection(field.id, 'NULL');
        return raw;
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
          this.state.setSelection(field.id, flattenedExpr);
          return this.qb.client.raw(flattenedExpr);
        }
        // Default: return CTE column directly
        const rawExpression = this.qb.client.raw(`??."lookup_${field.id}"`, [cteName]);
        this.state.setSelection(field.id, `"${cteName}"."lookup_${field.id}"`);
        return rawExpression;
      }

      const raw = this.qb.client.raw('NULL');
      this.state.setSelection(field.id, 'NULL');
      return raw;
    } else {
      const columnSelector = this.getColumnSelector(field);
      this.state.setSelection(field.id, columnSelector);
      return columnSelector;
    }
  }

  /**
   * Returns the generated column selector for formula fields
   * @param field The formula field
   */
  private getFormulaColumnSelector(field: FormulaFieldCore): IFieldSelectName {
    if (!field.isLookup) {
      // If any referenced field (recursively) is unresolved, fall back to NULL
      if (field.hasUnresolvedReferences(this.table)) {
        const raw = this.qb.client.raw('NULL');
        this.state.setSelection(field.id, 'NULL');
        return raw;
      }

      const isPersistedAsGeneratedColumn = field.getIsPersistedAsGeneratedColumn();
      if (!isPersistedAsGeneratedColumn) {
        // Return just the expression without alias for use in jsonb_build_object
        return this.dbProvider.convertFormulaToSelectQuery(field.options.expression, {
          table: this.table,
          tableAlias: this.tableAlias, // Pass table alias to the conversion context
          selectionMap: this.getSelectionMap(),
          // Provide CTE map so formula references can resolve link/lookup/rollup via CTEs directly
          fieldCteMap: this.state.getFieldCteMap(),
          // Pass timezone for date/time function evaluation in SELECT context
          timeZone: field.options?.timeZone,
        });
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
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }
    const name = this.getColumnSelector(field);

    const raw = `to_char(${name} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
    const selection = this.qb.client.raw(raw);

    this.state.setSelection(field.id, name);
    return selection;
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
      // If we are selecting from a materialized view, the view already exposes
      // the projected column for this field, so select the physical column.
      if (this.isViewContext()) {
        return this.getColumnSelector(field);
      }
      // When building directly from base table and no CTE is available
      // (e.g., foreign table deleted), return NULL instead of a physical column.
      const raw = this.qb.client.raw('NULL');
      this.state.setSelection(field.id, 'NULL');
      return raw;
    }

    const cteName = fieldCteMap.get(field.id)!;
    // Return Raw expression for selecting from CTE
    const rawExpression = this.qb.client.raw(`??."link_value"`, [cteName]);
    // For WHERE clauses, store the CTE column reference
    this.state.setSelection(field.id, `"${cteName}"."link_value"`);
    return rawExpression;
  }

  visitRollupField(field: RollupFieldCore): IFieldSelectName {
    if (this.isViewContext()) {
      // In view context, select the view column directly
      return this.getColumnSelector(field);
    }

    const fieldCteMap = this.state.getFieldCteMap();
    if (!fieldCteMap?.has(field.lookupOptions.linkFieldId)) {
      // From base table context, without CTE, return NULL fallback
      const raw = this.qb.client.raw('NULL');
      this.state.setSelection(field.id, 'NULL');
      return raw;
    }

    // Rollup fields use the link field's CTE with pre-computed rollup values
    // Check if the field has error (e.g., target field deleted)
    if (field.hasError) {
      // Field has error, return NULL to indicate this field should be null
      const rawExpression = this.qb.client.raw(`NULL`);
      this.state.setSelection(field.id, 'NULL');
      return rawExpression;
    }

    const linkField = field.getLinkField(this.table);
    if (!linkField) {
      const raw = this.qb.client.raw('NULL');
      this.state.setSelection(field.id, 'NULL');
      return raw;
    }

    const cteName = fieldCteMap.get(field.lookupOptions.linkFieldId)!;

    // Return Raw expression for selecting pre-computed rollup value from link CTE
    const rawExpression = this.qb.client.raw(`??."rollup_${field.id}"`, [cteName]);
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
    // If the formula field has an error (e.g., referenced field deleted), return NULL
    if (field.hasError) {
      const rawExpression = this.qb.client.raw(`NULL`);
      this.state.setSelection(field.id, 'NULL');
      return rawExpression;
    }

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
    // Build JSON with user info from system column __created_by
    const alias = this.tableAlias;
    const idRef = alias ? `"${alias}"."__created_by"` : `"__created_by"`;

    if (this.dbProvider.driver === DriverClient.Pg) {
      const expr = `(
        SELECT jsonb_build_object('id', u.id, 'title', u.name, 'email', u.email)
        FROM users u
        WHERE u.id = ${idRef}
      )`;
      this.state.setSelection(field.id, expr);
      return this.qb.client.raw(expr);
    } else {
      // SQLite returns TEXT JSON via json_object
      const expr = `json_object(
        'id', ${idRef},
        'title', (SELECT name FROM users WHERE id = ${idRef}),
        'email', (SELECT email FROM users WHERE id = ${idRef})
      )`;
      this.state.setSelection(field.id, expr);
      return this.qb.client.raw(expr);
    }
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): IFieldSelectName {
    // Build JSON with user info from system column __last_modified_by
    const alias = this.tableAlias;
    const idRef = alias ? `"${alias}"."__last_modified_by"` : `"__last_modified_by"`;

    if (this.dbProvider.driver === DriverClient.Pg) {
      const expr = `(
        SELECT jsonb_build_object('id', u.id, 'title', u.name, 'email', u.email)
        FROM users u
        WHERE u.id = ${idRef}
      )`;
      this.state.setSelection(field.id, expr);
      return this.qb.client.raw(expr);
    } else {
      const expr = `json_object(
        'id', ${idRef},
        'title', (SELECT name FROM users WHERE id = ${idRef}),
        'email', (SELECT email FROM users WHERE id = ${idRef})
      )`;
      this.state.setSelection(field.id, expr);
      return this.qb.client.raw(expr);
    }
  }
}
