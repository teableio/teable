import {
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
  type IFieldVisitor,
  type IFormulaConversionContext,
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
    return this.getColumnSelector(field);
  }

  visitSingleLineTextField(field: SingleLineTextFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitLongTextField(field: LongTextFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitAttachmentField(field: AttachmentFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitCheckboxField(field: CheckboxFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitDateField(field: DateFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitRatingField(field: RatingFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitAutoNumberField(field: AutoNumberFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitLinkField(field: LinkFieldCore): Knex.QueryBuilder {
    // Check if we have a CTE for this Link field
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
    return this.getColumnSelector(field);
  }

  // Select field types
  visitSingleSelectField(field: SingleSelectFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitMultipleSelectField(field: MultipleSelectFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  // Formula field types - these may use generated columns
  visitFormulaField(field: FormulaFieldCore): Knex.QueryBuilder {
    return this.getFormulaColumnSelector(field);
  }

  visitCreatedTimeField(field: CreatedTimeFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  // User field types
  visitUserField(field: UserFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitCreatedByField(field: CreatedByFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): Knex.QueryBuilder {
    return this.getColumnSelector(field);
  }
}
