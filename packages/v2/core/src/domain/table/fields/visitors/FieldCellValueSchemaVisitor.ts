import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { DomainError } from '../../../shared/DomainError';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { LookupField } from '../types/LookupField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import { AbstractFieldVisitor } from './AbstractFieldVisitor';
import { parseDateValue } from './dateValueParser';

// Zod schema types
type ZodSchema = z.ZodTypeAny;

// Attachment item schema
const attachmentItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  token: z.string(),
  path: z.string().optional(),
  size: z.number().optional(),
  mimetype: z.string().optional(),
  presignedUrl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

// Link item schema
const linkItemSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
});

// User item schema
const userItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
});

/**
 * Visitor that generates zod schemas for field cell values.
 *
 * The generated schema validates input values based on:
 * - Field type (string, number, boolean, etc.)
 * - Field configuration (notNull, options, max values, etc.)
 *
 * This visitor is internal. Use `Table.createRecordInputSchema()` to generate
 * a complete schema for record creation.
 */
export class FieldCellValueSchemaVisitor extends AbstractFieldVisitor<ZodSchema> {
  private constructor() {
    super();
  }

  /**
   * Create a visitor instance.
   * Internal use only - external code should use Table.createRecordInputSchema().
   */
  static create(): FieldCellValueSchemaVisitor {
    return new FieldCellValueSchemaVisitor();
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<ZodSchema, DomainError> {
    const baseSchema = z.string();
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitLongTextField(field: LongTextField): Result<ZodSchema, DomainError> {
    const baseSchema = z.string();
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitNumberField(field: NumberField): Result<ZodSchema, DomainError> {
    const baseSchema = z.number();
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitRatingField(field: RatingField): Result<ZodSchema, DomainError> {
    const max = field.ratingMax().toNumber();
    const baseSchema = z.number().int().min(1).max(max);
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitFormulaField(_field: FormulaField): Result<ZodSchema, DomainError> {
    // Computed field - value is calculated, not set by user
    // Return schema that only accepts null/undefined
    return ok(z.null().optional());
  }

  visitRollupField(_field: RollupField): Result<ZodSchema, DomainError> {
    // Computed field - value is calculated, not set by user
    return ok(z.null().optional());
  }

  visitLookupField(_field: LookupField): Result<ZodSchema, DomainError> {
    // Computed field - value is calculated, not set by user
    return ok(z.null().optional());
  }

  visitSingleSelectField(field: SingleSelectField): Result<ZodSchema, DomainError> {
    const options = field.selectOptions();
    if (options.length === 0) {
      // No options defined, only accept null (matching v1 behavior)
      // v1's validateCellValue uses innerChoicesMap which will be empty,
      // so no non-null value will pass validation
      return ok(z.null());
    }

    // Accept both option IDs and names to align with v1 behavior.
    const optionValues = options.flatMap((opt) => [opt.id().toString(), opt.name().toString()]);
    // Deduplicate in case ID and name are the same
    const uniqueValues = [...new Set(optionValues)];
    const baseSchema = z.enum(uniqueValues as [string, ...string[]]);
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<ZodSchema, DomainError> {
    const options = field.selectOptions();
    if (options.length === 0) {
      // No options defined, only accept null/empty array (matching v1 behavior)
      return ok(z.array(z.never()).nullable());
    }

    // Accept both option IDs and names to align with v1 behavior.
    const optionValues = options.flatMap((opt) => [opt.id().toString(), opt.name().toString()]);
    // Deduplicate in case ID and name are the same
    const uniqueValues = [...new Set(optionValues)];
    const baseSchema = z.array(z.enum(uniqueValues as [string, ...string[]]));
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitCheckboxField(field: CheckboxField): Result<ZodSchema, DomainError> {
    // Checkbox: boolean value (true = checked, false = unchecked)
    const baseSchema = z.boolean();
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitAttachmentField(field: AttachmentField): Result<ZodSchema, DomainError> {
    const baseSchema = z.array(attachmentItemSchema);
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitDateField(field: DateField): Result<ZodSchema, DomainError> {
    // Date is stored as ISO 8601 string
    // Accept both full ISO 8601 datetime (e.g., "2024-01-15T00:00:00.000Z")
    // and date-only strings (e.g., "2024-01-15") for backwards compatibility with v1
    // Also accept JavaScript Date instances for internal call paths (e.g. duplicate record).
    const baseSchema = z.union([z.string(), z.date()]).transform((val, ctx) => {
      const parsed = parseDateValue(field, val);
      if (parsed === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid ISO datetime',
        });
        return z.NEVER;
      }
      if (parsed === null && field.notNull().toBoolean()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Date value cannot be empty',
        });
        return z.NEVER;
      }
      return parsed;
    });
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<ZodSchema, DomainError> {
    // Computed field - value is set by system
    return ok(z.null().optional());
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeField): Result<ZodSchema, DomainError> {
    // Computed field - value is set by system
    return ok(z.null().optional());
  }

  visitUserField(field: UserField): Result<ZodSchema, DomainError> {
    const isMultiple = field.multiplicity().toBoolean();
    const baseSchema = isMultiple ? z.array(userItemSchema) : userItemSchema;
    return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
  }

  visitCreatedByField(_field: CreatedByField): Result<ZodSchema, DomainError> {
    // Computed field - value is set by system
    return ok(z.null().optional());
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<ZodSchema, DomainError> {
    // Computed field - value is set by system
    return ok(z.null().optional());
  }

  visitAutoNumberField(_field: AutoNumberField): Result<ZodSchema, DomainError> {
    // Computed field - value is set by system
    return ok(z.null().optional());
  }

  visitButtonField(_field: ButtonField): Result<ZodSchema, DomainError> {
    // Button field doesn't store user values
    return ok(z.null().optional());
  }

  visitLinkField(field: LinkField): Result<ZodSchema, DomainError> {
    const isMultipleRelationship = field.relationship().isMultipleValue();

    if (isMultipleRelationship) {
      // Add refine to check for duplicate IDs in the array
      const baseSchema = z.array(linkItemSchema).refine(
        (items) => {
          const ids = items.map((item) => item.id);
          return new Set(ids).size === ids.length;
        },
        { message: 'Cannot set duplicate record IDs in the same link cell' }
      );
      return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
    } else {
      const baseSchema = linkItemSchema;
      return ok(this.applyNullable(baseSchema, field.notNull().toBoolean()));
    }
  }

  visitConditionalRollupField(_field: ConditionalRollupField): Result<ZodSchema, DomainError> {
    // Computed field - value is calculated, not set by user
    return ok(z.null().optional());
  }

  visitConditionalLookupField(_field: ConditionalLookupField): Result<ZodSchema, DomainError> {
    // Computed field - value is calculated, not set by user
    return ok(z.null().optional());
  }

  /**
   * Apply nullable modifier based on notNull setting.
   * If notNull is true, the value is required.
   * If notNull is false, the value can be null.
   */
  private applyNullable<T extends z.ZodTypeAny>(schema: T, notNull: boolean): ZodSchema {
    if (notNull) {
      return schema;
    }
    return schema.nullable();
  }
}
