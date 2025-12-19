import type { Result } from 'neverthrow';

import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';

export interface IFieldVisitor<T = void> {
  visitSingleLineTextField(field: SingleLineTextField): Result<T, string>;
  visitNumberField(field: NumberField): Result<T, string>;
  visitRatingField(field: RatingField): Result<T, string>;
  visitSingleSelectField(field: SingleSelectField): Result<T, string>;
}
