import {
  type IFieldVisitor,
  type SingleLineTextFieldCore,
  type LongTextFieldCore,
  type NumberFieldCore,
  type CheckboxFieldCore,
  type DateFieldCore,
  type RatingFieldCore,
  type AutoNumberFieldCore,
  type SingleSelectFieldCore,
  type MultipleSelectFieldCore,
  type AttachmentFieldCore,
  type LinkFieldCore,
  type RollupFieldCore,
  type ConditionalRollupFieldCore,
  type FormulaFieldCore,
  CellValueType,
  type CreatedTimeFieldCore,
  type LastModifiedTimeFieldCore,
  type UserFieldCore,
  type CreatedByFieldCore,
  type LastModifiedByFieldCore,
  type ButtonFieldCore,
  type INumberFormatting,
} from '@teable/core';
import { match, P } from 'ts-pattern';
import type { IRecordQueryDialectProvider } from './record-query-dialect.interface';

/**
 * Field formatting visitor that converts field cellValue2String logic to SQL expressions
 */
export class FieldFormattingVisitor implements IFieldVisitor<string> {
  constructor(
    private readonly fieldExpression: string,
    private readonly dialect: IRecordQueryDialectProvider
  ) {}

  /**
   * Convert field expression to text/string format for database-specific SQL
   */
  private convertToText(): string {
    return this.dialect.toText(this.fieldExpression);
  }

  /**
   * Apply number formatting to field expression
   */
  private applyNumberFormatting(formatting: INumberFormatting): string {
    return this.dialect.formatNumber(this.fieldExpression, formatting);
  }

  /**
   * Apply number formatting to a custom numeric expression
   * Useful for formatting per-element inside JSON array iteration
   */
  private applyNumberFormattingTo(expression: string, formatting: INumberFormatting): string {
    return this.dialect.formatNumber(expression, formatting);
  }

  /**
   * Format multiple numeric values contained in a JSON array to a comma-separated string
   */
  private formatMultipleNumberValues(formatting: INumberFormatting): string {
    return this.dialect.formatNumberArray(this.fieldExpression, formatting);
  }

  /**
   * Format multiple string values (like multiple select) to comma-separated string
   * Also handles link field arrays with objects containing id and title
   */
  private formatMultipleStringValues(): string {
    return this.dialect.formatStringArray(this.fieldExpression);
  }

  visitSingleLineTextField(_field: SingleLineTextFieldCore): string {
    // Text fields don't need special formatting, return as-is
    return this.fieldExpression;
  }

  visitLongTextField(_field: LongTextFieldCore): string {
    // Text fields don't need special formatting, return as-is
    return this.fieldExpression;
  }

  visitNumberField(field: NumberFieldCore): string {
    const formatting = field.options.formatting;
    if (field.isMultipleCellValue) {
      return this.formatMultipleNumberValues(formatting);
    }
    return this.applyNumberFormatting(formatting);
  }

  visitCheckboxField(_field: CheckboxFieldCore): string {
    // Checkbox fields are stored as boolean, convert to string
    return this.convertToText();
  }

  visitDateField(_field: DateFieldCore): string {
    // Date fields are stored as ISO strings, return as-is
    return this.fieldExpression;
  }

  visitRatingField(_field: RatingFieldCore): string {
    // Rating fields should display without trailing .0
    // If value is an integer, render as integer text; otherwise, fall back to generic number->text
    return this.dialect.formatRating(this.fieldExpression);
  }

  visitAutoNumberField(_field: AutoNumberFieldCore): string {
    // Auto number fields are numbers, convert to string
    return this.convertToText();
  }

  visitSingleSelectField(_field: SingleSelectFieldCore): string {
    // Select fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitMultipleSelectField(_field: MultipleSelectFieldCore): string {
    // Multiple select fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitAttachmentField(_field: AttachmentFieldCore): string {
    // Attachment fields are complex, for now return as-is
    return this.fieldExpression;
  }

  visitLinkField(_field: LinkFieldCore): string {
    // Link fields should not be formatted directly, return as-is
    return this.fieldExpression;
  }

  visitRollupField(_field: RollupFieldCore): string {
    // Rollup fields depend on their result type, for now return as-is
    return this.fieldExpression;
  }

  visitConditionalRollupField(_field: ConditionalRollupFieldCore): string {
    return this.fieldExpression;
  }

  visitFormulaField(field: FormulaFieldCore): string {
    // Formula fields need formatting based on their result type and formatting options
    const { cellValueType, options, isMultipleCellValue } = field;
    const formatting = options.formatting;

    // Apply formatting based on the formula's result type using match pattern
    return match({ cellValueType, formatting, isMultipleCellValue })
      .with(
        {
          cellValueType: CellValueType.Number,
          formatting: P.not(P.nullish),
          isMultipleCellValue: true,
        },
        ({ formatting }) => this.formatMultipleNumberValues(formatting as INumberFormatting)
      )
      .with(
        { cellValueType: CellValueType.Number, formatting: P.not(P.nullish) },
        ({ formatting }) => this.applyNumberFormatting(formatting as INumberFormatting)
      )
      .with({ cellValueType: CellValueType.DateTime, formatting: P.not(P.nullish) }, () => {
        // For datetime formatting, we would need to implement date formatting logic
        // For now, return as-is since datetime fields are typically stored as ISO strings
        return this.fieldExpression;
      })
      .with({ cellValueType: CellValueType.String, isMultipleCellValue: true }, () => {
        // For multiple-value string fields (like multiple select), convert array to comma-separated string
        return this.formatMultipleStringValues();
      })
      .otherwise(() => {
        // For other cell value types (single String, Boolean), return as-is
        return this.fieldExpression;
      });
  }

  visitCreatedTimeField(_field: CreatedTimeFieldCore): string {
    // Created time fields are stored as ISO strings, return as-is
    return this.fieldExpression;
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): string {
    // Last modified time fields are stored as ISO strings, return as-is
    return this.fieldExpression;
  }

  visitUserField(_field: UserFieldCore): string {
    // User fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitCreatedByField(_field: CreatedByFieldCore): string {
    // Created by fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitLastModifiedByField(_field: LastModifiedByFieldCore): string {
    // Last modified by fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitButtonField(_field: ButtonFieldCore): string {
    // Button fields don't have values, return as-is
    return this.fieldExpression;
  }
}
