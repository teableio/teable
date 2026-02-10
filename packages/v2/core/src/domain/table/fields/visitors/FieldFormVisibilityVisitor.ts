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
import type { IFieldVisitor } from './IFieldVisitor';

export class FieldFormVisibilityVisitor implements IFieldVisitor<boolean> {
  visitSingleLineTextField(_: SingleLineTextField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitLongTextField(_: LongTextField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitNumberField(_: NumberField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitRatingField(_: RatingField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitFormulaField(_: FormulaField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitRollupField(_: RollupField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitSingleSelectField(_: SingleSelectField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitCheckboxField(_: CheckboxField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitAttachmentField(_: AttachmentField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitDateField(_: DateField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitCreatedTimeField(_: CreatedTimeField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitLastModifiedTimeField(_: LastModifiedTimeField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitUserField(_: UserField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitCreatedByField(_: CreatedByField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitLastModifiedByField(_: LastModifiedByField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitAutoNumberField(_: AutoNumberField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitButtonField(_: ButtonField): Result<boolean, DomainError> {
    return ok(false);
  }

  visitLinkField(_: LinkField): Result<boolean, DomainError> {
    return ok(true);
  }

  visitLookupField(_: LookupField): Result<boolean, DomainError> {
    // Lookup fields are computed/read-only, not visible in forms
    return ok(false);
  }

  visitConditionalRollupField(_: ConditionalRollupField): Result<boolean, DomainError> {
    // Computed fields are not visible in forms
    return ok(false);
  }

  visitConditionalLookupField(_: ConditionalLookupField): Result<boolean, DomainError> {
    // Computed fields are not visible in forms
    return ok(false);
  }
}
