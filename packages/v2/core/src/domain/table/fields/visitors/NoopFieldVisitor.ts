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

export class NoopFieldVisitor implements IFieldVisitor {
  visitSingleLineTextField(_: SingleLineTextField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitLongTextField(_: LongTextField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitNumberField(_: NumberField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitRatingField(_: RatingField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitFormulaField(_: FormulaField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitRollupField(_: RollupField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSingleSelectField(_: SingleSelectField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitCheckboxField(_: CheckboxField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitAttachmentField(_: AttachmentField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitDateField(_: DateField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitCreatedTimeField(_: CreatedTimeField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitLastModifiedTimeField(_: LastModifiedTimeField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUserField(_: UserField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitCreatedByField(_: CreatedByField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitLastModifiedByField(_: LastModifiedByField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitAutoNumberField(_: AutoNumberField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitButtonField(_: ButtonField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitLinkField(_: LinkField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitLookupField(_: LookupField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitConditionalRollupField(_: ConditionalRollupField): Result<void, DomainError> {
    return ok(undefined);
  }

  visitConditionalLookupField(_: ConditionalLookupField): Result<void, DomainError> {
    return ok(undefined);
  }
}
