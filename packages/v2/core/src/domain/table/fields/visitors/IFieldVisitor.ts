import type { Result } from 'neverthrow';

import type { AttachmentField } from '../types/AttachmentField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LongTextField } from '../types/LongTextField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';

export interface IFieldVisitor<T = void> {
  visitSingleLineTextField(field: SingleLineTextField): Result<T, string>;
  visitLongTextField(field: LongTextField): Result<T, string>;
  visitNumberField(field: NumberField): Result<T, string>;
  visitRatingField(field: RatingField): Result<T, string>;
  visitFormulaField(field: FormulaField): Result<T, string>;
  visitSingleSelectField(field: SingleSelectField): Result<T, string>;
  visitMultipleSelectField(field: MultipleSelectField): Result<T, string>;
  visitCheckboxField(field: CheckboxField): Result<T, string>;
  visitAttachmentField(field: AttachmentField): Result<T, string>;
  visitDateField(field: DateField): Result<T, string>;
  visitUserField(field: UserField): Result<T, string>;
  visitButtonField(field: ButtonField): Result<T, string>;
}
