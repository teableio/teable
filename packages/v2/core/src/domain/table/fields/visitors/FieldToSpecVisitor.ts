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
import { SetFieldValueSpecFactory } from '../../records/specs/values/SetFieldValueSpecFactory';
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
import { NumberFormattingType } from '../types/NumberFormatting';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import { AbstractFieldVisitor } from './AbstractFieldVisitor';
import { parseDateValue } from './dateValueParser';
import { normalizeCellDisplayValue, normalizeCellDisplayValues } from './normalizeCellDisplayValue';
import { normalizeSingleLineTextCellValue } from './normalizeSingleLineTextCellValue';
import { splitSelectTypecastValues } from './splitSelectTypecastValues';

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

  private normalizeSingleDateInput(field: DateField): unknown {
    if (!this.typecast || !Array.isArray(this.value)) {
      return this.value;
    }

    for (const candidate of this.value) {
      if (parseDateValue(field, candidate) !== undefined) {
        return candidate;
      }
    }

    return null;
  }

  // ============ Text Fields ============

  visitSingleLineTextField(field: SingleLineTextField): Result<ICellValueSpec, DomainError> {
    const repaired = this.repairToString(this.value);
    const finalValue = repaired == null ? null : normalizeSingleLineTextCellValue(repaired);
    return ok(new SetSingleLineTextValueSpec(field.id(), CellValue.fromValidated(finalValue)));
  }

  visitLongTextField(field: LongTextField): Result<ICellValueSpec, DomainError> {
    const finalValue = this.repairLongText(this.value);
    return ok(new SetLongTextValueSpec(field.id(), CellValue.fromValidated(finalValue)));
  }

  // ============ Numeric Fields ============

  visitNumberField(field: NumberField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetNumberValueSpec(field.id(), CellValue.null()));
    }

    if (typeof this.value === 'number') {
      if (Number.isNaN(this.value)) {
        return ok(new SetNumberValueSpec(field.id(), CellValue.null()));
      }
      return ok(new SetNumberValueSpec(field.id(), CellValue.fromValidated(this.value)));
    }

    if (this.typecast) {
      const parsed = this.parseNumberValue(this.value, field);
      const finalValue = Number.isNaN(parsed) ? null : parsed;
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

  private parseNumberValue(value: unknown, field: NumberField): number {
    const raw = String(value);
    const isPercent =
      field.formatting().type() === NumberFormattingType.Percent || raw.includes('%');
    const numberReg = /[^\d.+-]/g;
    const symbolReg = /([+\-.])+/g;
    const parsed = Number.parseFloat(raw.replace(numberReg, '').replace(symbolReg, '$1'));

    if (Number.isNaN(parsed)) {
      return Number.NaN;
    }
    return isPercent ? parsed / 100 : parsed;
  }

  visitRatingField(field: RatingField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetRatingValueSpec(field.id(), CellValue.null()));
    }

    const max = field.ratingMax().toNumber();
    let rawNumber: number | null = null;

    if (typeof this.value === 'number') {
      rawNumber = this.value;
    } else if (this.typecast) {
      // Share the same numeric path as number inputs so "2.7" and 2.7 converge.
      const parsed = Number.parseFloat(String(this.value));
      rawNumber = Number.isFinite(parsed) ? parsed : null;
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

    // Typecast output must stay inside the strict rating domain: {null} ∪ {1..max}.
    // Always round first; only then clamp / null out-of-range values.
    let numValue: number | null = null;
    if (rawNumber !== null) {
      if (!Number.isFinite(rawNumber)) {
        if (!this.typecast) {
          return err(
            domainError.validation({
              code: 'validation.field.out_of_range',
              message: `Rating must be between 1 and ${max}, got ${rawNumber}`,
              details: {
                fieldId: field.id().toString(),
                min: 1,
                max,
                actualValue: rawNumber,
              },
            })
          );
        }
        numValue = null;
      } else if (this.typecast) {
        const rounded = Math.round(rawNumber);
        // Teable ratings are null-empty; 0/negatives are not valid stars.
        numValue = rounded < 1 ? null : Math.min(rounded, max);
      } else if (!Number.isInteger(rawNumber) || rawNumber < 1 || rawNumber > max) {
        return err(
          domainError.validation({
            code: 'validation.field.out_of_range',
            message: `Rating must be between 1 and ${max}, got ${rawNumber}`,
            details: {
              fieldId: field.id().toString(),
              min: 1,
              max,
              actualValue: rawNumber,
            },
          })
        );
      } else {
        numValue = rawNumber;
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
      // v1 contract: a checkbox is either true or null — false is stored as null
      return ok(
        new SetCheckboxValueSpec(
          field.id(),
          this.value ? CellValue.fromValidated(true) : CellValue.null()
        )
      );
    }

    if (this.typecast) {
      // v1 repair: only the strings "true"/"false" are special. Other non-empty
      // strings, including "0" and "no", are truthy and check the box. Numeric 0
      // and "" stay empty via the falsy fallback below. Do not treat "0" like
      // field-type conversion, which maps the string "0" to false.
      if (typeof this.value === 'string') {
        const lower = this.value.toLowerCase();
        if (lower === 'true' || lower === '1') {
          return ok(new SetCheckboxValueSpec(field.id(), CellValue.fromValidated(true)));
        }
        if (lower === 'false' || lower === '') {
          return ok(new SetCheckboxValueSpec(field.id(), CellValue.null()));
        }
      }
      return ok(
        new SetCheckboxValueSpec(
          field.id(),
          this.value ? CellValue.fromValidated(true) : CellValue.null()
        )
      );
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
    const parsed = parseDateValue(field, this.normalizeSingleDateInput(field));
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

    // Cell values are choice names. A string equal to a choice id is not that choice.
    const byName = options.find((opt) => opt.name().toString() === strValue);
    if (byName) {
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

    const values = splitSelectTypecastValues(this.value);
    if (!values || values.length === 0) {
      return ok(new SetMultipleSelectValueSpec(field.id(), CellValue.null()));
    }

    const options = field.selectOptions();
    const result: string[] = [];
    const invalidOptions: string[] = [];

    for (const val of values) {
      const byName = options.find((opt) => opt.name().toString() === val);
      if (byName) {
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
    const isMultiple = field.relationship().isMultipleValue();

    if (parsed.type === 'ids') {
      // Standard format: [{ id: 'recXxx', title?: string }]
      // Pass foreignTableId so the resolver can look up missing titles
      // An empty list clears the cell (stored as null, matching v1)
      const items = parsed.value as LinkItem[];
      return ok(
        new SetLinkValueSpec(
          field.id(),
          items.length === 0
            ? CellValue.null()
            : CellValue.fromValidated(isMultiple ? items : items[0]),
          field.foreignTableId()
        )
      );
    }

    if (parsed.type === 'titles' && this.typecast) {
      // Title format: ['Title1', 'Title2'] → resolved against the link display field
      return ok(
        SetLinkValueByTitleSpec.create(
          field.id(),
          field.foreignTableId(),
          parsed.value as string[],
          isMultiple,
          field.lookupFieldId()
        )
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
      // An empty list clears the cell (stored as null, matching v1)
      const normalizedValue = field.multiplicity().toBoolean()
        ? parsed.items.length === 0
          ? null
          : parsed.items
        : (parsed.items[0] ?? null);
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
        const isMultiple = field.multiplicity().toBoolean();
        // v1 parity (UserFieldCore.convertStringToCellValue -> matchUser(cellValue[0])):
        // a single-user field considers only the first token, so `"不存在的人, 李四"`
        // clears the cell instead of resolving to a later identifier.
        const tokens = isMultiple ? identifiers.value : identifiers.value.slice(0, 1);
        return ok(SetUserValueByIdentifierSpec.create(field.id(), tokens, isMultiple));
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
      // An empty list clears the cell (stored as null, matching v1)
      const items = parsed.value;
      return ok(
        new SetAttachmentValueSpec(
          field.id(),
          items == null || items.length === 0 ? CellValue.null() : CellValue.fromValidated(items)
        )
      );
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
    const result = SetFieldValueSpecFactory.create(field, this.value);
    return this.typecast && result.isErr() ? SetFieldValueSpecFactory.create(field, null) : result;
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
    // v1 stores cleared text cells as null, never as ""
    const str = String(value);
    return str === '' ? null : str;
  }

  /**
   * v1 LongTextFieldCore.convertStringToCellValue trims only the ends.
   * Internal newlines and tabs stay. Empty and whitespace-only input is null.
   */
  private repairLongText(value: unknown): string | null {
    const repaired = this.repairToString(value);
    if (repaired == null) return null;
    const trimmed = repaired.trim();
    return trimmed === '' ? null : trimmed;
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
      value: arr.map(String),
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
    // v1 parity (UserFieldCore.convertStringToCellValue): free-form text is a
    // comma-separated list of identifiers (id / name / email). Tokens are kept
    // verbatim — including empty ones — so a single-user field can mirror v1's
    // `matchUser(cellValue[0])` (a leading empty token clears the cell); tokens
    // that match nobody are dropped during resolution.
    if (typeof value === 'string') {
      const identifiers = value.split(',').map((entry) => entry.trim());
      if (identifiers.every((entry) => !entry)) {
        // Empty / whitespace-only input clears the cell instead of resolving
        return { valid: false, value: [] };
      }
      return { valid: true, value: identifiers };
    }
    if (Array.isArray(value)) {
      const valid = value.every((v) => typeof v === 'string');
      if (!valid) {
        return { valid: false, value: [] };
      }
      // v1 joins an array input then splits it, so each entry may hold a list.
      const identifiers = value.flatMap((entry) => entry.split(',')).map((entry) => entry.trim());
      if (identifiers.every((entry) => !entry)) {
        return { valid: false, value: [] };
      }
      return { valid: true, value: identifiers };
    }
    return { valid: false, value: [] };
  }

  private parseAttachmentValue(value: unknown): { valid: boolean; value: AttachmentItem[] | null } {
    const attachmentIdPrefix = 'act';
    // Standard format: [{ id?, name?, token?, size?, mimetype?, ... }]
    if (Array.isArray(value)) {
      if (value.length === 0) {
        // Align with v1: empty attachment arrays are stored as null.
        return { valid: true, value: null };
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
          if (!this.typecast && !('name' in v)) {
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
