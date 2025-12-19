import type { Result } from 'neverthrow';

import type { Field } from './Field';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import { AttachmentField } from './types/AttachmentField';
import { ButtonField } from './types/ButtonField';
import { CheckboxField } from './types/CheckboxField';
import { DateField } from './types/DateField';
import { LongTextField } from './types/LongTextField';
import { MultipleSelectField } from './types/MultipleSelectField';
import { NumberField } from './types/NumberField';
import { RatingField } from './types/RatingField';
import type { RatingMax } from './types/RatingMax';
import type { SelectOptionName } from './types/SelectOptionName';
import { SingleLineTextField } from './types/SingleLineTextField';
import { SingleSelectField } from './types/SingleSelectField';
import { UserField } from './types/UserField';

export const createSingleLineTextField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => SingleLineTextField.create(params);

export const createTextField = createSingleLineTextField;

export const createLongTextField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => LongTextField.create(params);

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

export const createMultipleSelectField = (params: {
  id: FieldId;
  name: FieldName;
  options: ReadonlyArray<SelectOptionName>;
}): Result<Field, string> => MultipleSelectField.create(params);

export const createCheckboxField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => CheckboxField.create(params);

export const createAttachmentField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => AttachmentField.create(params);

export const createDateField = (params: { id: FieldId; name: FieldName }): Result<Field, string> =>
  DateField.create(params);

export const createUserField = (params: { id: FieldId; name: FieldName }): Result<Field, string> =>
  UserField.create(params);

export const createButtonField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => ButtonField.create(params);
