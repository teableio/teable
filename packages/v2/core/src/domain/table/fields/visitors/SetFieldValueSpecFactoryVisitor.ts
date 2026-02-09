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
import { SetLinkValueSpec, type LinkItem } from '../../records/specs/values/SetLinkValueSpec';
import { SetLongTextValueSpec } from '../../records/specs/values/SetLongTextValueSpec';
import { SetMultipleSelectValueSpec } from '../../records/specs/values/SetMultipleSelectValueSpec';
import { SetNumberValueSpec } from '../../records/specs/values/SetNumberValueSpec';
import { SetRatingValueSpec } from '../../records/specs/values/SetRatingValueSpec';
import { SetSingleLineTextValueSpec } from '../../records/specs/values/SetSingleLineTextValueSpec';
import { SetSingleSelectValueSpec } from '../../records/specs/values/SetSingleSelectValueSpec';
import { SetUserValueSpec, type UserItem } from '../../records/specs/values/SetUserValueSpec';
import { NoopCellValueSpec } from '../../records/specs/values/NoopCellValueSpec';
import { CellValue } from '../../records/values/CellValue';
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
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import { AbstractFieldVisitor } from './AbstractFieldVisitor';
import { parseDateValue } from './dateValueParser';

/**
 * Visitor that creates SetValueSpec instances for each field type.
 *
 * This visitor is used by SetFieldValueSpecFactory to create the appropriate
 * spec based on the field type. The value is validated before creating the spec.
 *
 * Usage:
 * ```typescript
 * const visitor = new SetFieldValueSpecFactoryVisitor(validatedValue);
 * const specResult = field.accept(visitor);
 * ```
 */
export class SetFieldValueSpecFactoryVisitor extends AbstractFieldVisitor<ICellValueSpec> {
  private value: unknown;

  constructor(value: unknown) {
    super();
    this.value = value;
  }

  /**
   * Create a new visitor with a different value.
   * Useful for fluent API patterns.
   */
  withValue(value: unknown): SetFieldValueSpecFactoryVisitor {
    return new SetFieldValueSpecFactoryVisitor(value);
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<string>(this.value as string | null);
    return ok(new SetSingleLineTextValueSpec(field.id(), cellValue));
  }

  visitLongTextField(field: LongTextField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<string>(this.value as string | null);
    return ok(new SetLongTextValueSpec(field.id(), cellValue));
  }

  visitNumberField(field: NumberField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<number>(this.value as number | null);
    return ok(new SetNumberValueSpec(field.id(), cellValue));
  }

  visitRatingField(field: RatingField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<number>(this.value as number | null);
    return ok(new SetRatingValueSpec(field.id(), cellValue));
  }

  visitFormulaField(_field: FormulaField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(domainError.validation({ message: 'Cannot set value for formula field' }));
  }

  visitRollupField(_field: RollupField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(domainError.validation({ message: 'Cannot set value for rollup field' }));
  }

  visitSingleSelectField(field: SingleSelectField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<string>(this.value as string | null);
    return ok(new SetSingleSelectValueSpec(field.id(), cellValue));
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<string[]>(this.value as string[] | null);
    return ok(new SetMultipleSelectValueSpec(field.id(), cellValue));
  }

  visitCheckboxField(field: CheckboxField): Result<ICellValueSpec, DomainError> {
    if (this.value == null) {
      return ok(new SetCheckboxValueSpec(field.id(), CellValue.null()));
    }

    if (typeof this.value === 'boolean') {
      return ok(new SetCheckboxValueSpec(field.id(), CellValue.fromValidated(this.value)));
    }

    const cellValue = CellValue.fromValidated<boolean>(this.value as boolean | null);
    return ok(new SetCheckboxValueSpec(field.id(), cellValue));
  }

  visitAttachmentField(field: AttachmentField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<AttachmentItem[]>(
      this.value as AttachmentItem[] | null
    );
    return ok(new SetAttachmentValueSpec(field.id(), cellValue));
  }

  visitDateField(field: DateField): Result<ICellValueSpec, DomainError> {
    const parsed = parseDateValue(field, this.value);
    const normalized = parsed === undefined ? (this.value as string | null) : parsed;
    const cellValue = CellValue.fromValidated<string>(normalized as string | null);
    return ok(new SetDateValueSpec(field.id(), cellValue));
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(domainError.validation({ message: 'Cannot set value for created time field' }));
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(
      domainError.validation({ message: 'Cannot set value for last modified time field' })
    );
  }

  visitUserField(field: UserField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<UserItem[]>(this.value as UserItem[] | null);
    return ok(new SetUserValueSpec(field.id(), cellValue));
  }

  visitCreatedByField(_field: CreatedByField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(domainError.validation({ message: 'Cannot set value for created by field' }));
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(domainError.validation({ message: 'Cannot set value for last modified by field' }));
  }

  visitAutoNumberField(_field: AutoNumberField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(domainError.validation({ message: 'Cannot set value for auto number field' }));
  }

  visitButtonField(_field: ButtonField): Result<ICellValueSpec, DomainError> {
    // Button field doesn't store values - ignore any provided input
    return ok(NoopCellValueSpec.create());
  }

  visitLinkField(field: LinkField): Result<ICellValueSpec, DomainError> {
    const cellValue = CellValue.fromValidated<LinkItem[]>(this.value as LinkItem[] | null);
    return ok(new SetLinkValueSpec(field.id(), cellValue));
  }

  visitConditionalRollupField(_field: ConditionalRollupField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(
      domainError.validation({ message: 'Cannot set value for conditional rollup field' })
    );
  }

  visitConditionalLookupField(_field: ConditionalLookupField): Result<ICellValueSpec, DomainError> {
    // Computed field - cannot set value
    return err(
      domainError.validation({ message: 'Cannot set value for conditional lookup field' })
    );
  }
}
