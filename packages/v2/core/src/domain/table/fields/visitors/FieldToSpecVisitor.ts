import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { ICellValueSpec } from '../../records/specs/values/ICellValueSpecVisitor';
import {
  SetAttachmentValueSpec,
  type AttachmentItem,
} from '../../records/specs/values/SetAttachmentValueSpec';
import { SetCheckboxValueSpec } from '../../records/specs/values/SetCheckboxValueSpec';
import { SetDateValueSpec } from '../../records/specs/values/SetDateValueSpec';
import { SetLinkValueByTitleSpec } from '../../records/specs/values/SetLinkValueByTitleSpec';
import { SetLinkValueSpec, type LinkItem } from '../../records/specs/values/SetLinkValueSpec';
import { SetLongTextValueSpec } from '../../records/specs/values/SetLongTextValueSpec';
import { SetMultipleSelectValueSpec } from '../../records/specs/values/SetMultipleSelectValueSpec';
import { SetNumberValueSpec } from '../../records/specs/values/SetNumberValueSpec';
import { SetRatingValueSpec } from '../../records/specs/values/SetRatingValueSpec';
import { SetSingleLineTextValueSpec } from '../../records/specs/values/SetSingleLineTextValueSpec';
import { SetSingleSelectValueSpec } from '../../records/specs/values/SetSingleSelectValueSpec';
import { SetUserValueByIdentifierSpec } from '../../records/specs/values/SetUserValueByIdentifierSpec';
import { SetUserValueSpec, type UserItem } from '../../records/specs/values/SetUserValueSpec';
import { NoopCellValueSpec } from '../../records/specs/values/NoopCellValueSpec';
import { CellValue } from '../../records/values/CellValue';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import { AbstractFieldVisitor } from './AbstractFieldVisitor';
import { parseDateValue } from './dateValueParser';
import { normalizeCellDisplayValue, normalizeCellDisplayValues } from './normalizeCellDisplayValue';

/**
 * Visitor that converts raw input values to CellValueSpec instances.
 *
 * This visitor handles both strict validation (typecast=false) and
 * lenient conversion (typecast=true) modes.
 *
 * - typecast=false: Strict validation, type mismatch returns error
 * - typecast=true: Best-effort conversion, returns null if conversion fails
 *
 * Usage:
 * ```typescript
 * const visitor = FieldToSpecVisitor.create(rawValue, typecast);
 * const specResult = field.accept(visitor);
 * ```
 */
export class FieldToSpecVisitor extends AbstractFieldVisitor<ICellValueSpec> {
  private constructor(
    private readonly value: unknown,
    private readonly typecast: boolean
  ) {
    super();
  }

  static create(value: unknown, typecast: boolean): FieldToSpecVisitor {
    return new FieldToSpecVisitor(value, typecast);
  }

  // ============ Text Fields ============

  visitSingleLineTextField(field: SingleLineTextField): Result<ICellValueSpec, DomainError> {
    // Text fields always accept any value converted to string
    const finalValue = this.repairToString(this.value);
    return ok(new SetSingleLineTextValueSpec(field.id(), CellValue.fromValidated(finalValue)));
  }

  visitLongTextField(field: LongTextField): Result<ICellValueSpec, DomainError> {
    const finalValue = this.repairToString(this.value);
    return ok(new SetLongTextValueSpec(field.id(), CellValue.fromValidated(finalValue)));
  }

  // ============ Numeric Fields ============

  visitNumberField(field: NumberField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetNumberValueSpec(field.id(), CellValue.null()));
    }

    if (typeof this.value === 'number') {
      if (isNaN(this.value)) {
        return ok(new SetNumberValueSpec(field.id(), CellValue.null()));
      }
      return ok(new SetNumberValueSpec(field.id(), CellValue.fromValidated(this.value)));
    }

    if (this.typecast) {
      const parsed = parseFloat(String(this.value));
      const finalValue = isNaN(parsed) ? null : parsed;
      return ok(new SetNumberValueSpec(field.id(), CellValue.fromValidated(finalValue)));
    }

    return err(
      domainError.validation({
        code: 'validation.field.type_mismatch',
        message: `Expected number for field "${field.name().toString()}", got ${typeof this.value}`,
        details: {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          expectedType: 'number',
          actualType: typeof this.value,
        },
      })
    );
  }

  visitRatingField(field: RatingField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetRatingValueSpec(field.id(), CellValue.null()));
    }

    let numValue: number | null = null;
    const max = field.ratingMax().toNumber();

    if (typeof this.value === 'number') {
      numValue = this.value;
    } else if (this.typecast) {
      const parsed = parseInt(String(this.value), 10);
      numValue = isNaN(parsed) ? null : parsed;
    } else {
      return err(
        domainError.validation({
          code: 'validation.field.type_mismatch',
          message: `Expected number for rating field "${field.name().toString()}"`,
          details: {
            fieldId: field.id().toString(),
            fieldName: field.name().toString(),
            expectedType: 'number',
            actualType: typeof this.value,
          },
        })
      );
    }

    // Range check and clamp
    if (numValue !== null) {
      if (numValue < 1 || numValue > max) {
        if (this.typecast) {
          // Clamp to valid range
          numValue = Math.min(Math.max(1, Math.round(numValue)), max);
        } else {
          return err(
            domainError.validation({
              code: 'validation.field.out_of_range',
              message: `Rating must be between 1 and ${max}, got ${numValue}`,
              details: {
                fieldId: field.id().toString(),
                min: 1,
                max,
                actualValue: numValue,
              },
            })
          );
        }
      }
    }

    return ok(new SetRatingValueSpec(field.id(), CellValue.fromValidated(numValue)));
  }

  // ============ Checkbox ============

  visitCheckboxField(field: CheckboxField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetCheckboxValueSpec(field.id(), CellValue.null()));
    }

    if (typeof this.value === 'boolean') {
      return ok(new SetCheckboxValueSpec(field.id(), CellValue.fromValidated(this.value)));
    }

    if (this.typecast) {
      // String "true"/"false" conversion
      if (typeof this.value === 'string') {
        const lower = this.value.toLowerCase();
        if (lower === 'true' || lower === '1') {
          return ok(new SetCheckboxValueSpec(field.id(), CellValue.fromValidated(true)));
        }
        if (lower === 'false' || lower === '0' || lower === '') {
          return ok(new SetCheckboxValueSpec(field.id(), CellValue.fromValidated(false)));
        }
      }
      // truthy → true, falsy → false
      const finalValue = this.value ? true : false;
      return ok(new SetCheckboxValueSpec(field.id(), CellValue.fromValidated(finalValue)));
    }

    return err(
      domainError.validation({
        code: 'validation.field.type_mismatch',
        message: `Expected boolean for checkbox field "${field.name().toString()}"`,
        details: {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          expectedType: 'boolean',
          actualType: typeof this.value,
        },
      })
    );
  }

  // ============ Date ============

  visitDateField(field: DateField): Result<ICellValueSpec, DomainError> {
    const parsed = parseDateValue(field, this.value);
    if (parsed === null) {
      return ok(new SetDateValueSpec(field.id(), CellValue.null()));
    }
    if (parsed !== undefined) {
      return ok(new SetDateValueSpec(field.id(), CellValue.fromValidated(parsed)));
    }

    if (this.typecast) {
      return ok(new SetDateValueSpec(field.id(), CellValue.null()));
    }

    return err(
      domainError.validation({
        code: 'validation.field.invalid_date',
        message: `Invalid date format for field "${field.name().toString()}"`,
        details: {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          providedValue: this.value,
        },
      })
    );
  }

  // ============ Select Fields ============

  visitSingleSelectField(field: SingleSelectField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetSingleSelectValueSpec(field.id(), CellValue.null()));
    }

    const strValue = normalizeCellDisplayValue(this.value);
    if (!strValue) {
      return ok(new SetSingleSelectValueSpec(field.id(), CellValue.null()));
    }

    const options = field.selectOptions();

    // 1. Check if it's already an option ID
    const byId = options.find((opt) => opt.id().toString() === strValue);
    if (byId) {
      return ok(new SetSingleSelectValueSpec(field.id(), CellValue.fromValidated(strValue)));
    }

    // 2. Find by name (v1 accepts both ID and name in non-typecast mode)
    const byName = options.find((opt) => opt.name().toString() === strValue);
    if (byName) {
      // Store by name to align with v1 behavior
      return ok(new SetSingleSelectValueSpec(field.id(), CellValue.fromValidated(strValue)));
    }

    // 3. Option not found
    if (this.typecast) {
      // TODO: Auto-create option requires Table.updateField() support
      // For now, return null for non-existent options
      return ok(new SetSingleSelectValueSpec(field.id(), CellValue.null()));
    }

    return err(
      domainError.validation({
        code: 'validation.field.invalid_option',
        message: `Invalid option "${strValue}" for field "${field.name().toString()}"`,
        details: {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          providedValue: strValue,
          validOptions: options.map((opt) => ({
            id: opt.id().toString(),
            name: opt.name().toString(),
          })),
        },
      })
    );
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetMultipleSelectValueSpec(field.id(), CellValue.null()));
    }

    const values = this.valueToStringArray(this.value);
    if (!values || values.length === 0) {
      return ok(new SetMultipleSelectValueSpec(field.id(), CellValue.null()));
    }

    const options = field.selectOptions();
    const result: string[] = [];
    const invalidOptions: string[] = [];

    for (const val of values) {
      // Find by ID
      const byId = options.find((opt) => opt.id().toString() === val);
      if (byId) {
        result.push(val);
        continue;
      }

      // Find by name (v1 accepts both ID and name in non-typecast mode)
      const byName = options.find((opt) => opt.name().toString() === val);
      if (byName) {
        // Store by name to align with v1 behavior
        result.push(val);
        continue;
      }

      // Option not found
      if (this.typecast) {
        // typecast mode: ignore non-existent options
        continue;
      } else {
        invalidOptions.push(val);
      }
    }

    if (!this.typecast && invalidOptions.length > 0) {
      return err(
        domainError.validation({
          code: 'validation.field.invalid_options',
          message: `Invalid options for field "${field.name().toString()}": ${invalidOptions.join(', ')}`,
          details: {
            fieldId: field.id().toString(),
            fieldName: field.name().toString(),
            invalidOptions,
            validOptions: options.map((opt) => ({
              id: opt.id().toString(),
              name: opt.name().toString(),
            })),
          },
        })
      );
    }

    return ok(
      new SetMultipleSelectValueSpec(
        field.id(),
        CellValue.fromValidated(result.length > 0 ? result : null)
      )
    );
  }

  // ============ Link Field ============

  visitLinkField(field: LinkField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetLinkValueSpec(field.id(), CellValue.null()));
    }

    const parsed = this.parseLinkValue(this.value);

    if (parsed.type === 'ids') {
      // Standard format: [{ id: 'recXxx', title?: string }]
      return ok(
        new SetLinkValueSpec(field.id(), CellValue.fromValidated(parsed.value as LinkItem[]))
      );
    }

    if (parsed.type === 'titles' && this.typecast) {
      // Title format: ['Title1', 'Title2'] → need Repository to do SQL lookup
      return ok(
        SetLinkValueByTitleSpec.create(field.id(), field.foreignTableId(), parsed.value as string[])
      );
    }

    if (!this.typecast) {
      return err(
        domainError.validation({
          code: 'validation.field.invalid_link_format',
          message: `Invalid link format for field "${field.name().toString()}". Expected array of { id, title? } objects.`,
          details: {
            fieldId: field.id().toString(),
            fieldName: field.name().toString(),
            providedValue: this.value,
          },
        })
      );
    }

    // typecast but cannot parse, return null
    return ok(new SetLinkValueSpec(field.id(), CellValue.null()));
  }

  // ============ User Field ============

  visitUserField(field: UserField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetUserValueSpec(field.id(), CellValue.null()));
    }

    const parsed = this.parseUserItems(this.value);
    if (parsed.valid) {
      const normalizedValue = field.multiplicity().toBoolean()
        ? parsed.items
        : parsed.items[0] ?? null;
      return ok(
        new SetUserValueSpec(
          field.id(),
          CellValue.fromValidated(normalizedValue as UserItem[] | null)
        )
      );
    }

    if (this.typecast) {
      const identifiers = this.parseUserIdentifiers(this.value);
      if (identifiers.valid) {
        return ok(
          SetUserValueByIdentifierSpec.create(
            field.id(),
            identifiers.value,
            field.multiplicity().toBoolean()
          )
        );
      }
      return ok(new SetUserValueSpec(field.id(), CellValue.null()));
    }

    return err(
      domainError.validation({
        code: 'validation.field.invalid_user_format',
        message: `Invalid user format for field "${field.name().toString()}"`,
        details: {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          providedValue: this.value,
        },
      })
    );
  }

  // ============ Attachment ============

  visitAttachmentField(field: AttachmentField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetAttachmentValueSpec(field.id(), CellValue.null()));
    }

    const parsed = this.parseAttachmentValue(this.value);
    if (parsed.valid) {
      return ok(new SetAttachmentValueSpec(field.id(), CellValue.fromValidated(parsed.value)));
    }

    if (this.typecast) {
      return ok(new SetAttachmentValueSpec(field.id(), CellValue.null()));
    }

    return err(
      domainError.validation({
        code: 'validation.field.invalid_attachment_format',
        message: `Invalid attachment format for field "${field.name().toString()}"`,
        details: {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          providedValue: this.value,
        },
      })
    );
  }

  // ============ Computed Fields (Read-only) ============

  visitFormulaField(field: FormulaField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.computed_readonly',
        message: `Cannot set value for computed field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'formula' },
      })
    );
  }

  visitRollupField(field: RollupField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.computed_readonly',
        message: `Cannot set value for computed field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'rollup' },
      })
    );
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.system_readonly',
        message: `Cannot set value for system field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'createdTime' },
      })
    );
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.system_readonly',
        message: `Cannot set value for system field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'lastModifiedTime' },
      })
    );
  }

  visitCreatedByField(field: CreatedByField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.system_readonly',
        message: `Cannot set value for system field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'createdBy' },
      })
    );
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.system_readonly',
        message: `Cannot set value for system field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'lastModifiedBy' },
      })
    );
  }

  visitAutoNumberField(field: AutoNumberField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.system_readonly',
        message: `Cannot set value for auto-number field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'autoNumber' },
      })
    );
  }

  visitButtonField(field: ButtonField): Result<ICellValueSpec, DomainError> {
    // Button fields don't store values - ignore any provided input
    return ok(NoopCellValueSpec.create());
  }

  visitConditionalRollupField(field: ConditionalRollupField): Result<ICellValueSpec, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.computed_readonly',
        message: `Cannot set value for computed field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType: 'conditionalRollup' },
      })
    );
  }

  // ============ Helper Methods ============

  private repairToString(value: unknown): string | null {
    if (value == null) return null;
    return String(value);
  }

  private valueToStringArray(value: unknown): string[] | null {
    if (value == null) return null;
    const normalized = normalizeCellDisplayValues(value);
    return normalized.length > 0 ? normalized : null;
  }

  private parseLinkValue(value: unknown): {
    type: 'ids' | 'titles';
    value: LinkItem[] | string[];
  } {
    let arr: unknown[];
    if (!Array.isArray(value)) {
      if (typeof value === 'string') {
        arr = this.valueToStringArray(value) ?? [];
      } else {
        arr = [value];
      }
    } else {
      arr = value;
    }

    if (arr.length === 0) {
      return { type: 'ids', value: [] };
    }

    const first = arr[0];

    // Check if it's { id: string } format
    if (typeof first === 'object' && first !== null && 'id' in first) {
      return { type: 'ids', value: arr as LinkItem[] };
    }

    // Check if it's record ID string format (recXxx)
    if (typeof first === 'string' && first.startsWith('rec')) {
      return {
        type: 'ids',
        value: arr.map((v) => ({ id: String(v) })),
      };
    }

    // Otherwise treat as titles
    return {
      type: 'titles',
      value: arr.map((v) => String(v)),
    };
  }

  private parseUserItems(value: unknown): { valid: boolean; items: UserItem[] } {
    // Standard format: [{ id: string, email?: string, title?: string }] or { id: string, ... }
    if (Array.isArray(value)) {
      const valid = value.every((v) => typeof v === 'object' && v !== null && 'id' in v);
      return { valid, items: valid ? (value as UserItem[]) : [] };
    }
    if (value && typeof value === 'object' && 'id' in value) {
      return { valid: true, items: [value as UserItem] };
    }
    return { valid: false, items: [] };
  }

  private parseUserIdentifiers(value: unknown): { valid: boolean; value: string[] } {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        // Empty string should be treated as no user, not as an identifier
        return { valid: false, value: [] };
      }
      return { valid: true, value: [trimmed] };
    }
    if (Array.isArray(value)) {
      const valid = value.every((v) => typeof v === 'string');
      if (!valid) {
        return { valid: false, value: [] };
      }
      // Filter out empty strings
      const filtered = (value as string[]).map((v) => v.trim()).filter(Boolean);
      if (filtered.length === 0) {
        return { valid: false, value: [] };
      }
      return { valid: true, value: filtered };
    }
    return { valid: false, value: [] };
  }

  private parseAttachmentValue(value: unknown): { valid: boolean; value: AttachmentItem[] | null } {
    const attachmentIdPrefix = 'act';
    // Standard format: [{ id?, name?, token?, size?, mimetype?, ... }]
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return { valid: true, value: [] };
      }

      if (this.typecast && value.every((v) => typeof v === 'string')) {
        const ids = (value as string[])
          .flatMap((v) => v.split(','))
          .map((v) => v.trim())
          .filter(Boolean)
          .filter((id) => id.startsWith(attachmentIdPrefix));
        if (ids.length > 0) {
          return {
            valid: true,
            value: ids.map((id) => ({ id }) as AttachmentItem),
          };
        }
        return { valid: false, value: null };
      }

      if (value.every((v) => typeof v === 'object' && v !== null)) {
        const valid = (value as Record<string, unknown>[]).every((v) => {
          const hasToken = 'token' in v;
          const hasId = 'id' in v;
          if (!hasToken && !hasId) {
            return false;
          }
          if (!('name' in v)) {
            return false;
          }
          return true;
        });
        return { valid, value: valid ? (value as AttachmentItem[]) : null };
      }
    }

    if (typeof value === 'string' && this.typecast) {
      const ids = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .filter((id) => id.startsWith(attachmentIdPrefix));
      if (ids.length > 0) {
        return {
          valid: true,
          value: ids.map((id) => ({ id }) as AttachmentItem),
        };
      }
    }

    return { valid: false, value: null };
  }
}
