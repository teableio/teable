import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { AttachmentField } from '../types/AttachmentField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

export class NoopFieldVisitor implements IFieldVisitor {
  visitSingleLineTextField(_: SingleLineTextField): Result<void, string> {
    return ok(undefined);
  }

  visitLongTextField(_: LongTextField): Result<void, string> {
    return ok(undefined);
  }

  visitNumberField(_: NumberField): Result<void, string> {
    return ok(undefined);
  }

  visitRatingField(_: RatingField): Result<void, string> {
    return ok(undefined);
  }

  visitFormulaField(_: FormulaField): Result<void, string> {
    return ok(undefined);
  }

  visitSingleSelectField(_: SingleSelectField): Result<void, string> {
    return ok(undefined);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<void, string> {
    return ok(undefined);
  }

  visitCheckboxField(_: CheckboxField): Result<void, string> {
    return ok(undefined);
  }

  visitAttachmentField(_: AttachmentField): Result<void, string> {
    return ok(undefined);
  }

  visitDateField(_: DateField): Result<void, string> {
    return ok(undefined);
  }

  visitUserField(_: UserField): Result<void, string> {
    return ok(undefined);
  }

  visitButtonField(_: ButtonField): Result<void, string> {
    return ok(undefined);
  }

  visitLinkField(_: LinkField): Result<void, string> {
    return ok(undefined);
  }
}
