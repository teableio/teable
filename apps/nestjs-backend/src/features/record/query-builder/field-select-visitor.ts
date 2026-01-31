/* eslint-disable sonarjs/cognitive-complexity */
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
  ConditionalRollupFieldCore,
  SingleLineTextFieldCore,
  SingleSelectFieldCore,
  UserFieldCore,
  IFieldVisitor,
  ButtonFieldCore,
  TableDomain,
} from '@teable/core';
import { DbFieldType, FieldType, isLinkLookupOptions, DriverClient } from '@teable/core';
// no driver-specific logic here; use dialect for differences
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../db-provider/db.provider.interface';
import { AUTO_NUMBER_FIELD_NAME } from '../../field/constant';
import { isSystemUserField } from '../../field/fields-utils';
import type { IFieldSelectName } from './field-select.type';
import type {
  IRecordSelectionMap,
  IMutableQueryBuilderState,
} from './record-query-builder.interface';
import { getTableAliasFromTable } from './record-query-builder.util';
import type { IRecordQueryDialectProvider } from './record-query-dialect.interface';

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
    private readonly dialect: IRecordQueryDialectProvider,
    private readonly aliasOverride?: string,
    /**
     * When true, select raw scalar values for lookup/rollup CTEs instead of formatted display values.
     * This avoids type mismatches when propagating values back into physical columns (e.g. timestamptz).
     */
    private readonly rawProjection: boolean = false,
    private readonly preferRawFieldReferences: boolean = false,
    private readonly blockedLinkFieldIds?: ReadonlySet<string>,
    private readonly readyLinkFieldIds?: ReadonlySet<string>,
    private readonly currentLinkFieldId?: string
  ) {}

  private get tableAlias() {
    return this.aliasOverride || getTableAliasFromTable(this.table);
  }

  private isLinkFieldBlocked(fieldId?: string | null): boolean {
    return !!fieldId && !!this.blockedLinkFieldIds?.has(fieldId);
  }

  private isLinkFieldReady(fieldId?: string | null): boolean {
    if (!fieldId) return false;
    if (!this.readyLinkFieldIds) return true;
    return this.readyLinkFieldIds.has(fieldId);
  }

  private isViewContext(): boolean {
    return this.state.getContext() === 'view';
  }

  private isTableCacheContext(): boolean {
    return this.state.getContext() === 'tableCache';
  }

  /**
   * Whether we should select from the materialized view or table directly
   */
  private shouldSelectRaw() {
    return this.isViewContext() || this.isTableCacheContext();
  }

  private castExpressionForDbType(expression: string, field: FieldCore): string {
    if (this.dbProvider.driver !== DriverClient.Pg) {
      return expression;
    }

    const suffix = this.getCastSuffixForDbType(field.dbFieldType);
    if (!suffix) {
      return expression;
    }

    return `(${expression})${suffix}`;
  }

  private getCastSuffixForDbType(dbFieldType?: DbFieldType): string | null {
    switch (dbFieldType) {
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
        return null;
    }
  }

  private buildTypedNull(field: FieldCore): string {
    return this.dialect.typedNullFor(field.dbFieldType);
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
  private getColumnSelector(field: FieldCore): IFieldSelectName {
    return this.generateColumnSelect(field.dbFieldName);
  }

  private selectSystemColumn(field: FieldCore, columnName: string): IFieldSelectName {
    const alias = this.tableAlias;
    const selector = alias ? `"${alias}"."${columnName}"` : columnName;
    this.state.setSelection(field.id, selector);
    return selector;
  }

  // Typed NULL generation is delegated to the dialect implementation

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
      if (this.shouldSelectRaw()) {
        if (isSystemUserField(field) && !field.isLookup) {
          const columnSelector = this.getColumnSelector(field) as string;
          const expr = this.dialect.buildUserJsonObjectById(columnSelector);
          this.state.setSelection(field.id, expr);
          return this.qb.client.raw(expr);
        }
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      // Check if the field has error (e.g., target field deleted)
      if (field.hasError || !field.lookupOptions) {
        // Base-table context: return typed NULL to match the physical column type
        const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
        const raw = this.qb.client.raw(nullExpr);
        this.state.setSelection(field.id, nullExpr);
        return raw;
      }

      // Conditional lookup CTEs are stored against the field itself.
      if (field.isConditionalLookup) {
        if (!fieldCteMap.has(field.id)) {
          console.warn(
            `[ConditionalLookup] CTE not in fieldCteMap for field ${field.id} (${(field as unknown as { name?: string }).name}). ` +
              `Available CTE keys: [${Array.from(fieldCteMap.keys()).join(', ')}]`
          );
        } else {
          const conditionalCteName = fieldCteMap.get(field.id)!;
          if (!this.state.isCteJoined(conditionalCteName)) {
            // If the CTE isn't joined in this scope, fall back to raw column access.
            console.warn(
              `[ConditionalLookup] CTE ${conditionalCteName} for field ${field.id} (${(field as unknown as { name?: string }).name}) is not joined in current scope`
            );
          } else {
            const column =
              field.type === FieldType.ConditionalRollup
                ? `conditional_rollup_${field.id}`
                : `conditional_lookup_${field.id}`;
            const rawExpression = this.qb.client.raw(`??."${column}"`, [conditionalCteName]);
            this.state.setSelection(field.id, `"${conditionalCteName}"."${column}"`);
            return rawExpression;
          }
        }
      }

      // For regular lookup fields, use the corresponding link field CTE
      if (field.lookupOptions && isLinkLookupOptions(field.lookupOptions)) {
        const { linkFieldId } = field.lookupOptions;
        if (
          linkFieldId &&
          fieldCteMap.has(linkFieldId) &&
          !this.isLinkFieldBlocked(linkFieldId) &&
          this.isLinkFieldReady(linkFieldId)
        ) {
          const cteName = fieldCteMap.get(linkFieldId)!;
          const flattenedExpr = this.dialect.flattenLookupCteValue(
            cteName,
            field.id,
            !!field.isMultipleCellValue,
            field.dbFieldType
          );
          if (flattenedExpr) {
            this.state.setSelection(field.id, flattenedExpr);
            return this.qb.client.raw(flattenedExpr);
          }
          // Default: return CTE column directly
          const rawExpression = this.qb.client.raw(`??."lookup_${field.id}"`, [cteName]);
          this.state.setSelection(field.id, `"${cteName}"."lookup_${field.id}"`);
          return rawExpression;
        }
      }

      if (this.rawProjection) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }

      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const raw = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
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
      if (this.shouldSelectRaw()) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      // If any referenced field (recursively) is unresolved, fall back to NULL
      if (field.hasUnresolvedReferences(this.table)) {
        const nullExpr = this.buildTypedNull(field);
        this.state.setSelection(field.id, nullExpr);
        return this.qb.client.raw(nullExpr);
      }

      const expression = field.getExpression();
      const timezone = field.options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

      // In raw/propagation context (used by UPDATE ... FROM SELECT), avoid referencing
      // the physical generated column directly, since it may have been dropped by
      // cascading schema changes (e.g., deleting a referenced base column). Instead,
      // always emit the computed expression which degrades to NULL when references
      // are unresolved.
      if (this.rawProjection) {
        const formulaSql = this.dbProvider.convertFormulaToSelectQuery(expression, {
          table: this.table,
          tableAlias: this.tableAlias,
          selectionMap: this.getSelectionMap(),
          fieldCteMap: this.state.getFieldCteMap(),
          readyLinkFieldIds: this.readyLinkFieldIds,
          currentLinkFieldId: this.currentLinkFieldId,
          timeZone: timezone,
          preferRawFieldReferences: this.preferRawFieldReferences,
          targetDbFieldType: field.dbFieldType,
        });
        const normalized =
          field.dbFieldType === DbFieldType.Json ? `to_jsonb(${formulaSql})` : formulaSql;
        const casted = this.castExpressionForDbType(normalized as string, field);
        this.state.setSelection(field.id, casted);
        return casted;
      }

      if (!field.getIsPersistedAsGeneratedColumn()) {
        const formulaSql = this.dbProvider.convertFormulaToSelectQuery(expression, {
          table: this.table,
          tableAlias: this.tableAlias,
          selectionMap: this.getSelectionMap(),
          fieldCteMap: this.state.getFieldCteMap(),
          readyLinkFieldIds: this.readyLinkFieldIds,
          currentLinkFieldId: this.currentLinkFieldId,
          timeZone: timezone,
          preferRawFieldReferences: this.preferRawFieldReferences,
          targetDbFieldType: field.dbFieldType,
        });
        const normalized =
          field.dbFieldType === DbFieldType.Json ? `to_jsonb(${formulaSql})` : formulaSql;
        const casted = this.castExpressionForDbType(normalized as string, field);
        this.state.setSelection(field.id, casted);
        return casted;
      }

      // For non-raw contexts where the generated column exists, select it directly
      const columnName = field.getGeneratedColumnName();
      const columnSelector = this.generateColumnSelect(columnName);
      this.state.setSelection(field.id, columnSelector);
      return columnSelector;
    }
    // For lookup formula fields, use table alias if provided
    if (field.hasError) {
      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const rawNull = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
      return rawNull;
    }
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

    // In lookup/rollup CTE context, return the raw column (timestamptz) to preserve type
    // so UPDATE ... FROM (SELECT ...) can assign into timestamp columns without casting issues.
    if (this.rawProjection) {
      this.state.setSelection(field.id, name);
      return name;
    }

    this.state.setSelection(field.id, name);
    return name;
  }

  visitRatingField(field: RatingFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitAutoNumberField(field: AutoNumberFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }
    if (this.rawProjection) {
      const selector = this.generateColumnSelect(AUTO_NUMBER_FIELD_NAME);
      this.state.setSelection(field.id, selector);
      return selector;
    }
    return this.checkAndSelectLookupField(field);
  }

  visitLinkField(field: LinkFieldCore): IFieldSelectName {
    // Check if this is a Lookup field first
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }

    const fieldCteMap = this.state.getFieldCteMap();
    const cteName = fieldCteMap?.get(field.id);
    const canUseCte =
      !!cteName && !this.isLinkFieldBlocked(field.id) && this.isLinkFieldReady(field.id);
    const isSelfReference = this.currentLinkFieldId === field.id;

    if (!canUseCte || isSelfReference) {
      // If we are selecting from a materialized view, the view already exposes
      // the projected column for this field, so select the physical column.
      if (this.shouldSelectRaw()) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      if (this.rawProjection) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      if (!field.hasError) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      // When building directly from base table and no CTE is available
      // (e.g., foreign table deleted or errored), return a dialect-typed NULL
      // to avoid type mismatch when assigning into persisted columns.
      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const raw = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
      return raw;
    }

    const resolvedCteName = cteName!;
    // Return Raw expression for selecting from CTE
    const rawExpression = this.qb.client.raw(`??."link_value"`, [resolvedCteName]);
    // For WHERE clauses, store the CTE column reference
    this.state.setSelection(field.id, `"${resolvedCteName}"."link_value"`);
    return rawExpression;
  }

  visitRollupField(field: RollupFieldCore): IFieldSelectName {
    if (this.shouldSelectRaw()) {
      // In view context, select the view column directly
      const columnSelector = this.getColumnSelector(field);
      this.state.setSelection(field.id, columnSelector);
      return columnSelector;
    }

    const fieldCteMap = this.state.getFieldCteMap();
    if (!isLinkLookupOptions(field.lookupOptions)) {
      if (this.rawProjection) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }

      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const raw = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
      return raw;
    }

    const linkLookupOptions = field.lookupOptions;

    const linkFieldId = linkLookupOptions.linkFieldId;
    if (
      !linkFieldId ||
      !fieldCteMap?.has(linkFieldId) ||
      this.isLinkFieldBlocked(linkFieldId) ||
      !this.isLinkFieldReady(linkFieldId)
    ) {
      if (this.rawProjection) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      // From base table context, without CTE, return dialect-typed NULL to match column type
      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const raw = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
      return raw;
    }

    // Rollup fields use the link field's CTE with pre-computed rollup values
    // Check if the field has error (e.g., target field deleted)
    if (field.hasError) {
      // Field has error, return dialect-typed NULL to indicate this field should be null
      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const rawExpression = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
      return rawExpression;
    }

    const linkField = field.getLinkField(this.table);
    if (!linkField) {
      if (this.rawProjection) {
        const columnSelector = this.getColumnSelector(field);
        this.state.setSelection(field.id, columnSelector);
        return columnSelector;
      }
      const nullExpr = this.buildTypedNull(field);
      this.state.setSelection(field.id, nullExpr);
      return this.qb.client.raw(nullExpr);
    }
    const cteName = fieldCteMap.get(linkFieldId)!;

    // Return Raw expression for selecting pre-computed rollup value from link CTE
    const rawExpression = this.qb.client.raw(`??."rollup_${field.id}"`, [cteName]);
    // For WHERE clauses, store the CTE column reference
    this.state.setSelection(field.id, `"${cteName}"."rollup_${field.id}"`);
    return rawExpression;
  }

  visitConditionalRollupField(field: ConditionalRollupFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }

    const fieldCteMap = this.state.getFieldCteMap();

    if (this.rawProjection && (!fieldCteMap.has(field.id) || !this.isLinkFieldReady(field.id))) {
      const columnSelector = this.getColumnSelector(field);
      this.state.setSelection(field.id, columnSelector);
      return columnSelector;
    }

    if (this.shouldSelectRaw()) {
      const columnSelector = this.getColumnSelector(field);
      this.state.setSelection(field.id, columnSelector);
      return columnSelector;
    }

    const cteName = fieldCteMap.get(field.id);
    if (!cteName) {
      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const raw = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
      return raw;
    }

    const columnName = `conditional_rollup_${field.id}`;
    const selectionExpr = `"${cteName}"."${columnName}"`;
    this.state.setSelection(field.id, selectionExpr);
    return this.qb.client.raw('??.??', [cteName, columnName]);
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
      const nullExpr = this.dialect.typedNullFor(field.dbFieldType);
      const rawExpression = this.qb.client.raw(nullExpr);
      this.state.setSelection(field.id, nullExpr);
      return rawExpression;
    }

    // For Formula fields, check Lookup first, then use formula logic
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }
    return this.getFormulaColumnSelector(field);
  }

  // User field types
  visitUserField(field: UserFieldCore): IFieldSelectName {
    return this.checkAndSelectLookupField(field);
  }

  visitCreatedTimeField(field: CreatedTimeFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }

    return this.selectSystemColumn(field, '__created_time');
  }

  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }

    const trackAll = field.isTrackAll();

    // For track-all (generated column) fields, selecting the system column yields the same value
    if (trackAll) {
      return this.selectSystemColumn(field, '__last_modified_time');
    }

    const selector = this.getColumnSelector(field);
    if (typeof selector === 'string') {
      this.state.setSelection(field.id, selector);
    }
    return selector;
  }

  visitCreatedByField(field: CreatedByFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }
    // Build JSON with user info from system column __created_by
    const alias = this.tableAlias;
    const idRef = alias ? `"${alias}"."__created_by"` : `"__created_by"`;
    const expr = this.dialect.buildUserJsonObjectById(idRef);
    this.state.setSelection(field.id, expr);
    return this.qb.client.raw(expr);
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): IFieldSelectName {
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }

    const trackAll = field.isTrackAll();
    if (trackAll) {
      // Build JSON with user info from system column __last_modified_by
      const alias = this.tableAlias;
      const idRef = alias ? `"${alias}"."__last_modified_by"` : `"__last_modified_by"`;
      const expr = this.dialect.buildUserJsonObjectById(idRef);
      this.state.setSelection(field.id, expr);
      return this.qb.client.raw(expr);
    }

    return this.checkAndSelectLookupField(field);
  }
}
