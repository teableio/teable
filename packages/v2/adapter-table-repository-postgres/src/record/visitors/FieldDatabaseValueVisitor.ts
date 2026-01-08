import {
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DomainError,
  type FormulaField,
  type IFieldVisitor,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
  ok,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';

/**
 * Visitor that transforms cell values to their database storage format.
 *
 * This handles the conversion of JavaScript values to PostgreSQL-compatible formats:
 * - Primitive values (string, number, boolean) are returned as-is
 * - Complex values (arrays, objects) are JSON stringified for JSONB columns
 *
 * Usage:
 * ```typescript
 * const visitor = FieldDatabaseValueVisitor.create(cellValue.toValue());
 * const dbValue = field.accept(visitor);
 * ```
 */
export class FieldDatabaseValueVisitor implements IFieldVisitor<unknown> {
  private constructor(private readonly rawValue: unknown) {}

  static create(rawValue: unknown): FieldDatabaseValueVisitor {
    return new FieldDatabaseValueVisitor(rawValue);
  }

  visitSingleLineTextField(_field: SingleLineTextField): Result<unknown, DomainError> {
    return ok(this.rawValue);
  }

  visitLongTextField(_field: LongTextField): Result<unknown, DomainError> {
    return ok(this.rawValue);
  }

  visitNumberField(_field: NumberField): Result<unknown, DomainError> {
    return ok(this.rawValue);
  }

  visitRatingField(_field: RatingField): Result<unknown, DomainError> {
    return ok(this.rawValue);
  }

  visitFormulaField(_field: FormulaField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitRollupField(_field: RollupField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitLookupField(_field: LookupField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitSingleSelectField(_field: SingleSelectField): Result<unknown, DomainError> {
    return ok(this.rawValue);
  }

  visitMultipleSelectField(_field: MultipleSelectField): Result<unknown, DomainError> {
    // Multiple select is stored as JSONB - driver handles serialization
    return ok(this.rawValue ?? null);
  }

  visitCheckboxField(_field: CheckboxField): Result<unknown, DomainError> {
    return ok(this.rawValue);
  }

  visitDateField(_field: DateField): Result<unknown, DomainError> {
    return ok(this.rawValue);
  }

  visitAttachmentField(_field: AttachmentField): Result<unknown, DomainError> {
    // Attachments are stored as JSONB
    if (this.rawValue === null || this.rawValue === undefined) {
      return ok(null);
    }
    return ok(JSON.stringify(this.rawValue));
  }

  visitUserField(_field: UserField): Result<unknown, DomainError> {
    // Users are stored as JSONB
    if (this.rawValue === null || this.rawValue === undefined) {
      return ok(null);
    }
    return ok(JSON.stringify(this.rawValue));
  }

  visitLinkField(_field: LinkField): Result<unknown, DomainError> {
    // Links are stored as JSONB
    if (this.rawValue === null || this.rawValue === undefined) {
      return ok(null);
    }
    return ok(JSON.stringify(this.rawValue));
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitCreatedByField(_field: CreatedByField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitAutoNumberField(_field: AutoNumberField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitButtonField(_field: ButtonField): Result<unknown, DomainError> {
    // Button fields don't store values
    return ok(null);
  }

  visitConditionalRollupField(_field: ConditionalRollupField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }

  visitConditionalLookupField(_field: ConditionalLookupField): Result<unknown, DomainError> {
    // Computed field - should not be set directly
    return ok(null);
  }
}
