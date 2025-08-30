import {
  type IFieldVisitor,
  DriverClient,
  type INumberFormatting,
  NumberFormattingType,
  type ICurrencyFormatting,
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
  type FormulaFieldCore,
  CellValueType,
  type CreatedTimeFieldCore,
  type LastModifiedTimeFieldCore,
  type UserFieldCore,
  type CreatedByFieldCore,
  type LastModifiedByFieldCore,
  type ButtonFieldCore,
} from '@teable/core';
import { match, P } from 'ts-pattern';

/**
 * Field formatting visitor that converts field cellValue2String logic to SQL expressions
 */
export class FieldFormattingVisitor implements IFieldVisitor<string> {
  constructor(
    private readonly fieldExpression: string,
    private readonly driver: DriverClient
  ) {}

  private get isPostgreSQL(): boolean {
    return this.driver === DriverClient.Pg;
  }

  /**
   * Convert field expression to text/string format for database-specific SQL
   */
  private convertToText(): string {
    if (this.isPostgreSQL) {
      return `${this.fieldExpression}::TEXT`;
    } else {
      return `CAST(${this.fieldExpression} AS TEXT)`;
    }
  }

  /**
   * Apply number formatting to field expression
   */
  private applyNumberFormatting(formatting: INumberFormatting): string {
    const { type, precision } = formatting;

    return match({ type, precision, isPostgreSQL: this.isPostgreSQL })
      .with(
        { type: NumberFormattingType.Decimal, precision: P.number },
        ({ precision, isPostgreSQL }) =>
          isPostgreSQL
            ? `ROUND(CAST(${this.fieldExpression} AS NUMERIC), ${precision})::TEXT`
            : `PRINTF('%.${precision}f', ${this.fieldExpression})`
      )
      .with(
        { type: NumberFormattingType.Percent, precision: P.number },
        ({ precision, isPostgreSQL }) =>
          isPostgreSQL
            ? `ROUND(CAST(${this.fieldExpression} * 100 AS NUMERIC), ${precision})::TEXT || '%'`
            : `PRINTF('%.${precision}f', ${this.fieldExpression} * 100) || '%'`
      )
      .with({ type: NumberFormattingType.Currency }, ({ precision, isPostgreSQL }) => {
        const symbol = (formatting as ICurrencyFormatting).symbol || '$';
        return match({ precision, isPostgreSQL })
          .with(
            { precision: P.number, isPostgreSQL: true },
            ({ precision }) =>
              `'${symbol}' || ROUND(CAST(${this.fieldExpression} AS NUMERIC), ${precision})::TEXT`
          )
          .with(
            { precision: P.number, isPostgreSQL: false },
            ({ precision }) => `'${symbol}' || PRINTF('%.${precision}f', ${this.fieldExpression})`
          )
          .with({ isPostgreSQL: true }, () => `'${symbol}' || ${this.fieldExpression}::TEXT`)
          .with(
            { isPostgreSQL: false },
            () => `'${symbol}' || CAST(${this.fieldExpression} AS TEXT)`
          )
          .exhaustive();
      })
      .otherwise(({ isPostgreSQL }) =>
        // Default: convert to string
        isPostgreSQL ? `${this.fieldExpression}::TEXT` : `CAST(${this.fieldExpression} AS TEXT)`
      );
  }

  /**
   * Apply number formatting to a custom numeric expression
   * Useful for formatting per-element inside JSON array iteration
   */
  private applyNumberFormattingTo(expression: string, formatting: INumberFormatting): string {
    const { type, precision } = formatting;

    return match({ type, precision, isPostgreSQL: this.isPostgreSQL })
      .with(
        { type: NumberFormattingType.Decimal, precision: P.number },
        ({ precision, isPostgreSQL }) =>
          isPostgreSQL
            ? `ROUND(CAST(${expression} AS NUMERIC), ${precision})::TEXT`
            : `PRINTF('%.${precision}f', ${expression})`
      )
      .with(
        { type: NumberFormattingType.Percent, precision: P.number },
        ({ precision, isPostgreSQL }) =>
          isPostgreSQL
            ? `ROUND(CAST(${expression} * 100 AS NUMERIC), ${precision})::TEXT || '%'`
            : `PRINTF('%.${precision}f', ${expression} * 100) || '%'`
      )
      .with({ type: NumberFormattingType.Currency }, ({ precision, isPostgreSQL }) => {
        const symbol = (formatting as ICurrencyFormatting).symbol || '$';
        return match({ precision, isPostgreSQL })
          .with(
            { precision: P.number, isPostgreSQL: true },
            ({ precision }) =>
              `'${symbol}' || ROUND(CAST(${expression} AS NUMERIC), ${precision})::TEXT`
          )
          .with(
            { precision: P.number, isPostgreSQL: false },
            ({ precision }) => `'${symbol}' || PRINTF('%.${precision}f', ${expression})`
          )
          .with({ isPostgreSQL: true }, () => `'${symbol}' || (${expression})::TEXT`)
          .with({ isPostgreSQL: false }, () => `'${symbol}' || CAST(${expression} AS TEXT)`)
          .exhaustive();
      })
      .otherwise(({ isPostgreSQL }) =>
        isPostgreSQL ? `(${expression})::TEXT` : `CAST(${expression} AS TEXT)`
      );
  }

  /**
   * Format multiple numeric values contained in a JSON array to a comma-separated string
   */
  private formatMultipleNumberValues(formatting: INumberFormatting): string {
    if (this.isPostgreSQL) {
      const elemNumExpr = `(elem #>> '{}')::numeric`;
      const formatted = this.applyNumberFormattingTo(elemNumExpr, formatting);
      // Preserve original array order using WITH ORDINALITY
      return `(
        SELECT string_agg(${formatted}, ', ' ORDER BY ord)
        FROM jsonb_array_elements(COALESCE((${this.fieldExpression})::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
      )`;
    } else {
      // SQLite: json_each + per-element formatting via printf
      // Note: Currency symbol handled in applyNumberFormattingTo
      const elemNumExpr = `CAST(json_extract(value, '$') AS NUMERIC)`;
      const formatted = this.applyNumberFormattingTo(elemNumExpr, formatting);
      // Preserve original array order using json_each key
      return `(
        SELECT GROUP_CONCAT(${formatted}, ', ')
        FROM json_each(COALESCE(${this.fieldExpression}, json('[]')))
        ORDER BY key
      )`;
    }
  }

  /**
   * Format multiple string values (like multiple select) to comma-separated string
   * Also handles link field arrays with objects containing id and title
   */
  private formatMultipleStringValues(): string {
    if (this.isPostgreSQL) {
      // PostgreSQL: Handle both text arrays and object arrays (like link fields)
      // The key issue is that we need to avoid double JSON processing
      // When the expression is already a JSON array from link field references,
      // we should extract the string values directly without re-serializing
      return `(
        SELECT string_agg(
          CASE
            WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
            WHEN jsonb_typeof(elem) = 'object' THEN elem->>'title'
            ELSE elem::text
          END,
          ', '
          ORDER BY ord
        )
        FROM jsonb_array_elements(COALESCE((${this.fieldExpression})::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
      )`;
    } else {
      // SQLite: Use GROUP_CONCAT with json_each to join array elements
      return `(
        SELECT GROUP_CONCAT(
          CASE
            WHEN json_type(value) = 'text' THEN json_extract(value, '$')
            WHEN json_type(value) = 'object' THEN json_extract(value, '$.title')
            ELSE value
          END,
          ', '
        )
        FROM json_each(COALESCE(${this.fieldExpression}, json('[]')))
        ORDER BY key
      )`;
    }
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
    // Rating fields are numbers, convert to string
    return this.convertToText();
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
