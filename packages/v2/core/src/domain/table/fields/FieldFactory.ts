import type { Result } from 'neverthrow';

import type { Field } from './Field';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import { NumberField } from './types/NumberField';
import { RatingField } from './types/RatingField';
import type { RatingMax } from './types/RatingMax';
import { SingleSelectField } from './types/SingleSelectField';
import { SingleLineTextField } from './types/SingleLineTextField';
import type { SelectOptionName } from './types/SelectOptionName';

export const createSingleLineTextField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => SingleLineTextField.create(params);

export const createTextField = createSingleLineTextField;

export const createNumberField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => NumberField.create(params);

export const createRatingField = (params: {
  id: FieldId;
  name: FieldName;
  max: RatingMax;
}): Result<Field, string> => RatingField.create(params);

export const createSelectField = (params: {
  id: FieldId;
  name: FieldName;
  options: ReadonlyArray<SelectOptionName>;
}): Result<Field, string> => SingleSelectField.create(params);

export const createSingleSelectField = createSelectField;
