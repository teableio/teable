import type { Result } from 'neverthrow';

import type { BaseId } from '../../base/BaseId';
import type { TableId } from '../TableId';
import type { Field } from './Field';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import { AttachmentField } from './types/AttachmentField';
import { AutoNumberField } from './types/AutoNumberField';
import { ButtonField } from './types/ButtonField';
import type { ButtonLabel } from './types/ButtonLabel';
import type { ButtonMaxCount } from './types/ButtonMaxCount';
import type { ButtonResetCount } from './types/ButtonResetCount';
import type { ButtonWorkflow } from './types/ButtonWorkflow';
import type { CellValueMultiplicity } from './types/CellValueMultiplicity';
import type { CellValueType } from './types/CellValueType';
import type { CheckboxDefaultValue } from './types/CheckboxDefaultValue';
import { CheckboxField } from './types/CheckboxField';
import { CreatedByField } from './types/CreatedByField';
import { CreatedTimeField } from './types/CreatedTimeField';
import type { DateDefaultValue } from './types/DateDefaultValue';
import { DateField } from './types/DateField';
import type { DateTimeFormatting } from './types/DateTimeFormatting';
import type { FieldColor } from './types/FieldColor';
import type { FormulaExpression } from './types/FormulaExpression';
import { FormulaField, type FormulaFormatting, type FormulaShowAs } from './types/FormulaField';
import type { FormulaMeta } from './types/FormulaMeta';
import { LastModifiedByField } from './types/LastModifiedByField';
import { LastModifiedTimeField } from './types/LastModifiedTimeField';
import { LinkField } from './types/LinkField';
import type { LinkFieldConfig } from './types/LinkFieldConfig';
import type { LinkFieldMeta } from './types/LinkFieldMeta';
import { LongTextField } from './types/LongTextField';
import { MultipleSelectField } from './types/MultipleSelectField';
import type { NumberDefaultValue } from './types/NumberDefaultValue';
import { NumberField } from './types/NumberField';
import type { NumberFormatting } from './types/NumberFormatting';
import type { NumberShowAs } from './types/NumberShowAs';
import type { RatingColor } from './types/RatingColor';
import { RatingField } from './types/RatingField';
import type { RatingIcon } from './types/RatingIcon';
import type { RatingMax } from './types/RatingMax';
import type { RollupExpression } from './types/RollupExpression';
import { RollupField, type RollupFormatting, type RollupShowAs } from './types/RollupField';
import type { RollupFieldConfig } from './types/RollupFieldConfig';
import type { SelectAutoNewOptions } from './types/SelectAutoNewOptions';
import type { SelectDefaultValue } from './types/SelectDefaultValue';
import type { SelectOption } from './types/SelectOption';
import { SingleLineTextField } from './types/SingleLineTextField';
import type { SingleLineTextShowAs } from './types/SingleLineTextShowAs';
import { SingleSelectField } from './types/SingleSelectField';
import type { TextDefaultValue } from './types/TextDefaultValue';
import type { TimeZone } from './types/TimeZone';
import type { UserDefaultValue } from './types/UserDefaultValue';
import { UserField } from './types/UserField';
import type { UserMultiplicity } from './types/UserMultiplicity';
import type { UserNotification } from './types/UserNotification';

export const createSingleLineTextField = (params: {
  id: FieldId;
  name: FieldName;
  showAs?: SingleLineTextShowAs;
  defaultValue?: TextDefaultValue;
}): Result<Field, string> => SingleLineTextField.create(params);

export const createTextField = createSingleLineTextField;

export const createLongTextField = (params: {
  id: FieldId;
  name: FieldName;
  defaultValue?: TextDefaultValue;
}): Result<Field, string> => LongTextField.create(params);

export const createNumberField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: NumberFormatting;
  showAs?: NumberShowAs;
  defaultValue?: NumberDefaultValue;
}): Result<Field, string> => NumberField.create(params);

export const createRatingField = (params: {
  id: FieldId;
  name: FieldName;
  max?: RatingMax;
  icon?: RatingIcon;
  color?: RatingColor;
}): Result<Field, string> => RatingField.create(params);

export const createFormulaField = (params: {
  id: FieldId;
  name: FieldName;
  expression: FormulaExpression;
  timeZone?: TimeZone;
  formatting?: FormulaFormatting;
  showAs?: FormulaShowAs;
  meta?: FormulaMeta;
  resultType?: { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity };
  dependencies?: ReadonlyArray<FieldId>;
}): Result<Field, string> => FormulaField.create(params);

export const createRollupField = (params: {
  id: FieldId;
  name: FieldName;
  config: RollupFieldConfig;
  expression: RollupExpression;
  valuesField: Field;
  timeZone?: TimeZone;
  formatting?: RollupFormatting;
  showAs?: RollupShowAs;
  dependencies?: ReadonlyArray<FieldId>;
}): Result<Field, string> => RollupField.create(params);

export const createRollupFieldPending = (params: {
  id: FieldId;
  name: FieldName;
  config: RollupFieldConfig;
  expression: RollupExpression;
  timeZone?: TimeZone;
  formatting?: RollupFormatting;
  showAs?: RollupShowAs;
  dependencies?: ReadonlyArray<FieldId>;
}): Result<Field, string> => RollupField.createPending(params);

export const createSelectField = (params: {
  id: FieldId;
  name: FieldName;
  options: ReadonlyArray<SelectOption>;
  defaultValue?: SelectDefaultValue;
  preventAutoNewOptions?: SelectAutoNewOptions;
}): Result<Field, string> => SingleSelectField.create(params);

export const createSingleSelectField = createSelectField;

export const createMultipleSelectField = (params: {
  id: FieldId;
  name: FieldName;
  options: ReadonlyArray<SelectOption>;
  defaultValue?: SelectDefaultValue;
  preventAutoNewOptions?: SelectAutoNewOptions;
}): Result<Field, string> => MultipleSelectField.create(params);

export const createCheckboxField = (params: {
  id: FieldId;
  name: FieldName;
  defaultValue?: CheckboxDefaultValue;
}): Result<Field, string> => CheckboxField.create(params);

export const createAttachmentField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => AttachmentField.create(params);

export const createDateField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: DateTimeFormatting;
  defaultValue?: DateDefaultValue;
}): Result<Field, string> => DateField.create(params);

export const createCreatedTimeField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: DateTimeFormatting;
}): Result<Field, string> => CreatedTimeField.create(params);

export const createLastModifiedTimeField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: DateTimeFormatting;
  trackedFieldIds?: ReadonlyArray<FieldId>;
}): Result<Field, string> => LastModifiedTimeField.create(params);

export const createUserField = (params: {
  id: FieldId;
  name: FieldName;
  isMultiple?: UserMultiplicity;
  shouldNotify?: UserNotification;
  defaultValue?: UserDefaultValue;
}): Result<Field, string> => UserField.create(params);

export const createCreatedByField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => CreatedByField.create(params);

export const createLastModifiedByField = (params: {
  id: FieldId;
  name: FieldName;
  trackedFieldIds?: ReadonlyArray<FieldId>;
}): Result<Field, string> => LastModifiedByField.create(params);

export const createAutoNumberField = (params: {
  id: FieldId;
  name: FieldName;
}): Result<Field, string> => AutoNumberField.create(params);

export const createButtonField = (params: {
  id: FieldId;
  name: FieldName;
  label?: ButtonLabel;
  color?: FieldColor;
  maxCount?: ButtonMaxCount;
  resetCount?: ButtonResetCount;
  workflow?: ButtonWorkflow;
}): Result<Field, string> => ButtonField.create(params);

export const createLinkField = (params: {
  id: FieldId;
  name: FieldName;
  config: LinkFieldConfig;
  meta?: LinkFieldMeta;
}): Result<Field, string> => LinkField.create(params);

export const createNewLinkField = (params: {
  id: FieldId;
  name: FieldName;
  config: LinkFieldConfig;
  baseId: BaseId;
  hostTableId: TableId;
  meta?: LinkFieldMeta;
}): Result<Field, string> => LinkField.createNew(params);
