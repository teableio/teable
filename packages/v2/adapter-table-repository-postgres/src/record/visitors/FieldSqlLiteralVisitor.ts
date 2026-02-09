import type {
  AttachmentField,
  AutoNumberField,
  ButtonField,
  CheckboxField,
  ConditionalLookupField,
  ConditionalRollupField,
  CreatedByField,
  CreatedTimeField,
  DateField,
  DomainError,
  FormulaField,
  IFieldVisitor,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  LongTextField,
  LookupField,
  MultipleSelectField,
  NumberField,
  RatingField,
  RollupField,
  SingleLineTextField,
  SingleSelectField,
  UserField,
} from '@teable/v2-core';
import { ok } from '@teable/v2-core';
import type { Result } from 'neverthrow';

/**
 * Escape single quotes in SQL string values.
 * PostgreSQL uses '' to escape a single quote within a string.
 */
function escapeSqlQuotes(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Visitor that generates SQL literal strings for field values.
 *
 * This handles the conversion of JavaScript values to PostgreSQL literal syntax
 * with proper type casting for each field type:
 * - Text fields: 'value' (no cast needed)
 * - Number/Rating fields: value::double precision
 * - Boolean fields: value::boolean
 * - Date fields: 'value'::timestamptz
 * - JSONB fields: 'value'::jsonb
 *
 * Usage:
 * ```typescript
 * const visitor = FieldSqlLiteralVisitor.create(cellValue);
 * const sqlLiteral = field.accept(visitor);
 * // => Result<string, DomainError> containing e.g. "'hello'" or "42::double precision"
 * ```
 */
export class FieldSqlLiteralVisitor implements IFieldVisitor<string> {
  private constructor(private readonly value: unknown) {}

  static create(value: unknown): FieldSqlLiteralVisitor {
    return new FieldSqlLiteralVisitor(value);
  }

  // --- Text types (no cast needed) ---

  visitSingleLineTextField(_field: SingleLineTextField): Result<string, DomainError> {
    return ok(this.textLiteral(this.value));
  }

  visitLongTextField(_field: LongTextField): Result<string, DomainError> {
    return ok(this.textLiteral(this.value));
  }

  // --- Numeric types ---

  visitNumberField(_field: NumberField): Result<string, DomainError> {
    return ok(this.numericLiteral(this.value, 'double precision'));
  }

  visitRatingField(_field: RatingField): Result<string, DomainError> {
    return ok(this.numericLiteral(this.value, 'double precision'));
  }

  // --- Select types ---

  visitSingleSelectField(_field: SingleSelectField): Result<string, DomainError> {
    // Single select is stored as text
    return ok(this.textLiteral(this.value));
  }

  visitMultipleSelectField(_field: MultipleSelectField): Result<string, DomainError> {
    // Multiple select is stored as JSONB (value is already JSON stringified)
    return ok(this.jsonbLiteral(this.value));
  }

  // --- Boolean types ---

  visitCheckboxField(_field: CheckboxField): Result<string, DomainError> {
    return ok(this.booleanLiteral(this.value));
  }

  // --- Date types ---

  visitDateField(_field: DateField): Result<string, DomainError> {
    return ok(this.timestampLiteral(this.value));
  }

  // --- JSONB types ---

  visitAttachmentField(_field: AttachmentField): Result<string, DomainError> {
    // Attachment is stored as JSONB (value is already JSON stringified)
    return ok(this.jsonbLiteral(this.value));
  }

  visitUserField(_field: UserField): Result<string, DomainError> {
    // User is stored as JSONB (value is already JSON stringified)
    return ok(this.jsonbLiteral(this.value));
  }

  visitLinkField(_field: LinkField): Result<string, DomainError> {
    // Link is stored as JSONB (value is already JSON stringified)
    return ok(this.jsonbLiteral(this.value));
  }

  // --- Computed fields (should not be directly set) ---

  visitFormulaField(_field: FormulaField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitRollupField(_field: RollupField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitLookupField(_field: LookupField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<string, DomainError> {
    return field.isPersistedAsGeneratedColumn().map((isGenerated) => {
      if (isGenerated) {
        return 'NULL';
      }
      return this.timestampLiteral(this.value);
    });
  }

  visitCreatedByField(_field: CreatedByField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<string, DomainError> {
    return field.isPersistedAsGeneratedColumn().map((isGenerated) => {
      if (isGenerated) {
        return 'NULL';
      }
      return this.jsonbLiteral(this.value);
    });
  }

  visitAutoNumberField(_field: AutoNumberField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitButtonField(_field: ButtonField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitConditionalRollupField(_field: ConditionalRollupField): Result<string, DomainError> {
    return ok('NULL');
  }

  visitConditionalLookupField(_field: ConditionalLookupField): Result<string, DomainError> {
    return ok('NULL');
  }

  // --- Private helper methods ---

  /**
   * Generate a text literal (no type cast needed).
   */
  private textLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    return `'${escapeSqlQuotes(String(value))}'`;
  }

  /**
   * Generate a numeric literal with type cast.
   * NULL values also need explicit type cast to ensure PostgreSQL VALUES clause
   * correctly infers the column type.
   */
  private numericLiteral(value: unknown, pgType: string): string {
    if (value === null || value === undefined) {
      return `NULL::${pgType}`;
    }
    // Numbers can be directly cast without quotes
    return `${value}::${pgType}`;
  }

  /**
   * Generate a boolean literal with type cast.
   * NULL values also need explicit type cast to ensure PostgreSQL VALUES clause
   * correctly infers the column type.
   */
  private booleanLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL::boolean';
    }
    // PostgreSQL accepts true/false as boolean literals
    return `${value}::boolean`;
  }

  /**
   * Generate a timestamp literal with type cast.
   * NULL values also need explicit type cast to ensure PostgreSQL VALUES clause
   * correctly infers the column type.
   */
  private timestampLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL::timestamptz';
    }
    return `'${escapeSqlQuotes(String(value))}'::timestamptz`;
  }

  /**
   * Generate a JSONB literal with type cast.
   * Note: The value should already be JSON stringified by CellValueMutateVisitor.
   * NULL values also need explicit type cast to ensure PostgreSQL VALUES clause
   * correctly infers the column type.
   */
  private jsonbLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL::jsonb';
    }
    // Value is already a JSON string from CellValueMutateVisitor
    return `'${escapeSqlQuotes(String(value))}'::jsonb`;
  }
}
