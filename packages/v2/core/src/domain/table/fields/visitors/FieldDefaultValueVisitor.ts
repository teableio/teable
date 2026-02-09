import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

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

/**
 * Raw default value that can be directly used when creating records.
 * `undefined` means no default value is configured for the field.
 */
export type RawDefaultValue = string | number | boolean | string[] | undefined;

/**
 * Visitor that extracts the raw default value from a field.
 *
 * This is used during record creation to populate fields that
 * weren't explicitly provided with values.
 *
 * @example
 * ```typescript
 * const visitor = FieldDefaultValueVisitor.create();
 * const defaultValue = field.accept(visitor);
 * if (defaultValue.isOk() && defaultValue.value !== undefined) {
 *   // Use the default value
 * }
 * ```
 */
export class FieldDefaultValueVisitor extends AbstractFieldVisitor<RawDefaultValue> {
  private constructor() {
    super();
  }

  static create(): FieldDefaultValueVisitor {
    return new FieldDefaultValueVisitor();
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    return ok(defaultValue?.toString());
  }

  visitLongTextField(field: LongTextField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    return ok(defaultValue?.toString());
  }

  visitNumberField(field: NumberField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    return ok(defaultValue?.toNumber());
  }

  visitRatingField(_field: RatingField): Result<RawDefaultValue, DomainError> {
    // Rating fields don't have default values
    return ok(undefined);
  }

  visitFormulaField(_field: FormulaField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitRollupField(_field: RollupField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitLookupField(_field: LookupField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitSingleSelectField(field: SingleSelectField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    if (!defaultValue) return ok(undefined);

    const defaultValueName = defaultValue.toDto();
    const optionNameToFind =
      typeof defaultValueName === 'string' ? defaultValueName : defaultValueName[0];

    // Find the option by name and return its name
    const options = field.selectOptions();
    const matchingOption = options.find((opt) => opt.name().toString() === optionNameToFind);
    if (!matchingOption) {
      // Default value references non-existent option, skip it
      return ok(undefined);
    }

    return ok(matchingOption.name().toString());
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    if (!defaultValue) return ok(undefined);

    const defaultValueNames = defaultValue.toDto();
    const namesToFind = Array.isArray(defaultValueNames) ? defaultValueNames : [defaultValueNames];

    // Find the options by name and return their names
    const options = field.selectOptions();
    const matchingNames = namesToFind
      .map((name) => options.find((opt) => opt.name().toString() === name))
      .filter((opt): opt is NonNullable<typeof opt> => opt !== undefined)
      .map((opt) => opt.name().toString());

    // If no valid options found, return undefined
    if (matchingNames.length === 0) {
      return ok(undefined);
    }

    return ok(matchingNames);
  }

  visitCheckboxField(field: CheckboxField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    return ok(defaultValue?.toBoolean());
  }

  visitDateField(field: DateField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    if (!defaultValue) return ok(undefined);
    // DateDefaultValue is 'now' - convert to current ISO string
    if (defaultValue.toString() === 'now') {
      return ok(new Date().toISOString());
    }
    return ok(undefined);
  }

  visitAttachmentField(_field: AttachmentField): Result<RawDefaultValue, DomainError> {
    // Attachment fields don't have simple default values
    return ok(undefined);
  }

  visitUserField(field: UserField): Result<RawDefaultValue, DomainError> {
    const defaultValue = field.defaultValue();
    return ok(defaultValue?.toDto());
  }

  visitLinkField(_field: LinkField): Result<RawDefaultValue, DomainError> {
    // Link fields don't have default values
    return ok(undefined);
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitCreatedByField(_field: CreatedByField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitAutoNumberField(_field: AutoNumberField): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitButtonField(_field: ButtonField): Result<RawDefaultValue, DomainError> {
    // Button fields don't have values
    return ok(undefined);
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<RawDefaultValue, DomainError> {
    // Computed field - no default value
    return ok(undefined);
  }
}
