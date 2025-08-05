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
} from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';

/**
 * Field visitor that returns appropriate database column selectors for knex.select()
 *
 * For regular fields: returns the dbFieldName as string
 *
 * The returned value can be used directly with knex.select() or knex.raw()
 */
export class FieldSelectVisitor implements IFieldVisitor<Knex.QueryBuilder> {
  constructor(
    private readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly context: IFormulaConversionContext,
    private readonly fieldCteMap?: Map<string, string>
  ) {}
  /**
   * Returns the appropriate column selector for a field
   * @param field The field to get the selector for
   * @returns String column name
   */
  private getColumnSelector(field: { dbFieldName: string }): Knex.QueryBuilder {
    return this.qb.select(field.dbFieldName);
  }

  /**
   * Check if field is a Lookup field and return appropriate selector
   */
  private checkAndSelectLookupField(field: FieldCore): Knex.QueryBuilder {
    // Check if this is a Lookup field
    if (field.isLookup && field.lookupOptions && this.fieldCteMap) {
      // Use the linkFieldId to find the CTE (since CTE is generated for the Link field)
      const linkFieldId = field.lookupOptions.linkFieldId;
      if (linkFieldId && this.fieldCteMap.has(linkFieldId)) {
        const cteName = this.fieldCteMap.get(linkFieldId)!;
        // Select from the CTE using the field-specific column name
        return this.qb.select(
          this.qb.client.raw(`??."lookup_${field.id}" as ??`, [cteName, field.dbFieldName])
        );
      }
    }

    // Fallback to the original column
    return this.getColumnSelector(field);
  }

  /**
   * Generate CTE name for a foreign table
   */
  private getCteNameForForeignTable(foreignTableId: string): string {
    return `cte_${foreignTableId.replace(/[^a-z0-9]/gi, '_')}`;
  }

  /**
   * Returns the generated column selector for formula fields
   * @param field The formula field
   */
  private getFormulaColumnSelector(field: FormulaFieldCore): Knex.QueryBuilder {
    if (!field.isLookup) {
      const isPersistedAsGeneratedColumn = field.getIsPersistedAsGeneratedColumn();
      if (!isPersistedAsGeneratedColumn) {
        const sql = this.dbProvider.convertFormulaToSelectQuery(field.options.expression, {
          fieldMap: this.context.fieldMap,
        });
        return this.qb.select(this.qb.client.raw(`${sql} as ??`, [field.getGeneratedColumnName()]));
      }
      return this.qb.select(field.getGeneratedColumnName());
    }
    return this.qb.select(field.dbFieldName);
  }

  // Basic field types
  visitNumberField(field: NumberFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitSingleLineTextField(field: SingleLineTextFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitLongTextField(field: LongTextFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitAttachmentField(field: AttachmentFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitCheckboxField(field: CheckboxFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitDateField(field: DateFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitRatingField(field: RatingFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitAutoNumberField(field: AutoNumberFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitLinkField(field: LinkFieldCore): Knex.QueryBuilder {
    // Check if this is a Lookup field first
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }

    // For non-Lookup Link fields, check if we have a CTE for this field
    if (this.fieldCteMap && this.fieldCteMap.has(field.id)) {
      const cteName = this.fieldCteMap.get(field.id)!;
      // Select from the CTE instead of the pre-computed column
      return this.qb.select(
        this.qb.client.raw(`??.link_value as ??`, [cteName, field.dbFieldName])
      );
    }

    // Fallback to the original pre-computed column for backward compatibility
    return this.getColumnSelector(field);
  }

  visitRollupField(field: RollupFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  // Select field types
  visitSingleSelectField(field: SingleSelectFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitMultipleSelectField(field: MultipleSelectFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  // Formula field types - these may use generated columns
  visitFormulaField(field: FormulaFieldCore): Knex.QueryBuilder {
    // For Formula fields, check Lookup first, then use formula logic
    if (field.isLookup) {
      return this.checkAndSelectLookupField(field);
    }
    return this.getFormulaColumnSelector(field);
  }

  visitCreatedTimeField(field: CreatedTimeFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  // User field types
  visitUserField(field: UserFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitCreatedByField(field: CreatedByFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): Knex.QueryBuilder {
    return this.checkAndSelectLookupField(field);
  }
}
