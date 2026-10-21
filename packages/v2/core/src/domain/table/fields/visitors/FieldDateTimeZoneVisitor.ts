import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { Field } from '../Field';
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
import { TimeZone } from '../types/TimeZone';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

/**
 * Resolves the timezone that defines calendar-day boundaries for a scalar
 * DateTime Field. Callers must still validate the Field value type and
 * multiplicity before accepting the result.
 */
export class FieldDateTimeZoneVisitor implements IFieldVisitor<TimeZone> {
  visitDateField(field: DateField): Result<TimeZone, DomainError> {
    return ok(field.formatting().timeZone());
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<TimeZone, DomainError> {
    return ok(field.formatting().timeZone());
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<TimeZone, DomainError> {
    return ok(field.formatting().timeZone());
  }

  visitFormulaField(field: FormulaField): Result<TimeZone, DomainError> {
    return ok(field.timeZone() ?? TimeZone.default());
  }

  visitRollupField(field: RollupField): Result<TimeZone, DomainError> {
    return ok(field.timeZone() ?? TimeZone.default());
  }

  visitConditionalRollupField(field: ConditionalRollupField): Result<TimeZone, DomainError> {
    return ok(field.timeZone() ?? TimeZone.default());
  }

  visitLookupField(field: LookupField): Result<TimeZone, DomainError> {
    return field.innerField().andThen((inner) => inner.accept(this));
  }

  visitConditionalLookupField(field: ConditionalLookupField): Result<TimeZone, DomainError> {
    return field.innerField().andThen((inner) => inner.accept(this));
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitLongTextField(field: LongTextField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitNumberField(field: NumberField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitRatingField(field: RatingField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitCheckboxField(field: CheckboxField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitAttachmentField(field: AttachmentField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitUserField(field: UserField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitCreatedByField(field: CreatedByField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitAutoNumberField(field: AutoNumberField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitButtonField(field: ButtonField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  visitLinkField(field: LinkField): Result<TimeZone, DomainError> {
    return this.unsupported(field);
  }

  private unsupported(field: Field): Result<TimeZone, DomainError> {
    return err(
      domainError.validation({
        code: 'calendar.date_timezone_unavailable',
        message: `Calendar timezone is unavailable for Field: ${field.id().toString()}`,
        details: { fieldId: field.id().toString(), fieldType: field.type().toString() },
      })
    );
  }
}
