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

export class FieldFormVisibilityVisitor implements IFieldVisitor<boolean> {
  visitSingleLineTextField(_: SingleLineTextField): Result<boolean, string> {
    return ok(true);
  }

  visitLongTextField(_: LongTextField): Result<boolean, string> {
    return ok(true);
  }

  visitNumberField(_: NumberField): Result<boolean, string> {
    return ok(true);
  }

  visitRatingField(_: RatingField): Result<boolean, string> {
    return ok(true);
  }

  visitFormulaField(_: FormulaField): Result<boolean, string> {
    return ok(false);
  }

  visitSingleSelectField(_: SingleSelectField): Result<boolean, string> {
    return ok(true);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<boolean, string> {
    return ok(true);
  }

  visitCheckboxField(_: CheckboxField): Result<boolean, string> {
    return ok(true);
  }

  visitAttachmentField(_: AttachmentField): Result<boolean, string> {
    return ok(true);
  }

  visitDateField(_: DateField): Result<boolean, string> {
    return ok(true);
  }

  visitUserField(_: UserField): Result<boolean, string> {
    return ok(true);
  }

  visitButtonField(_: ButtonField): Result<boolean, string> {
    return ok(false);
  }

  visitLinkField(_: LinkField): Result<boolean, string> {
    return ok(true);
  }
}
