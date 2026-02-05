import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../base/BaseId';
import type { DomainError } from '../../shared/DomainError';
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
import { ConditionalLookupField } from './types/ConditionalLookupField';
import type { ConditionalLookupOptions } from './types/ConditionalLookupOptions';
import type { ConditionalRollupConfig } from './types/ConditionalRollupConfig';
import {
  ConditionalRollupField,
  type ConditionalRollupFormatting,
  type ConditionalRollupShowAs,
} from './types/ConditionalRollupField';
import { CreatedByField } from './types/CreatedByField';
import { CreatedTimeField } from './types/CreatedTimeField';
import type { DateDefaultValue } from './types/DateDefaultValue';
import { DateField } from './types/DateField';
import type { DateTimeFormatting } from './types/DateTimeFormatting';
import type { FieldColor } from './types/FieldColor';
import type { FieldNotNull } from './types/FieldNotNull';
import type { FieldUnique } from './types/FieldUnique';
import type { FormulaExpression } from './types/FormulaExpression';
import { FormulaField, type FormulaFormatting, type FormulaShowAs } from './types/FormulaField';
import type { FormulaMeta } from './types/FormulaMeta';
import type { GeneratedColumnMeta } from './types/GeneratedColumnMeta';
import { LastModifiedByField } from './types/LastModifiedByField';
import { LastModifiedTimeField } from './types/LastModifiedTimeField';
import { LinkField } from './types/LinkField';
import type { LinkFieldConfig } from './types/LinkFieldConfig';
import type { LinkFieldMeta } from './types/LinkFieldMeta';
import { LongTextField } from './types/LongTextField';
import { LookupField } from './types/LookupField';
import type { LookupOptions } from './types/LookupOptions';
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

const applyFieldValidation = (
  field: Field,
  params?: { notNull?: FieldNotNull; unique?: FieldUnique }
): Result<Field, DomainError> => {
  const notNull = params?.notNull;
  const unique = params?.unique;
  return (notNull ? field.setNotNull(notNull) : ok(undefined))
    .andThen(() => (unique ? field.setUnique(unique) : ok(undefined)))
    .map(() => field);
};

export const createSingleLineTextField = (params: {
  id: FieldId;
  name: FieldName;
  showAs?: SingleLineTextShowAs;
  defaultValue?: TextDefaultValue;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  SingleLineTextField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createTextField = createSingleLineTextField;

export const createLongTextField = (params: {
  id: FieldId;
  name: FieldName;
  defaultValue?: TextDefaultValue;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  LongTextField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createNumberField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: NumberFormatting;
  showAs?: NumberShowAs;
  defaultValue?: NumberDefaultValue;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  NumberField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createRatingField = (params: {
  id: FieldId;
  name: FieldName;
  max?: RatingMax;
  icon?: RatingIcon;
  color?: RatingColor;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  RatingField.create(params).andThen((field) => applyFieldValidation(field, params));

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
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  FormulaField.create(params).andThen((field) => applyFieldValidation(field, params));

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
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  RollupField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createRollupFieldPending = (params: {
  id: FieldId;
  name: FieldName;
  config: RollupFieldConfig;
  expression: RollupExpression;
  timeZone?: TimeZone;
  formatting?: RollupFormatting;
  showAs?: RollupShowAs;
  resultType?: { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity };
  dependencies?: ReadonlyArray<FieldId>;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  RollupField.createPending(params).andThen((field) => applyFieldValidation(field, params));

export const createLookupFieldPending = (params: {
  id: FieldId;
  name: FieldName;
  lookupOptions: LookupOptions;
  dependencies?: ReadonlyArray<FieldId>;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  LookupField.createPending(params).andThen((field) => applyFieldValidation(field, params));

export const createSelectField = (params: {
  id: FieldId;
  name: FieldName;
  options: ReadonlyArray<SelectOption>;
  defaultValue?: SelectDefaultValue;
  preventAutoNewOptions?: SelectAutoNewOptions;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  SingleSelectField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createSingleSelectField = createSelectField;

export const createMultipleSelectField = (params: {
  id: FieldId;
  name: FieldName;
  options: ReadonlyArray<SelectOption>;
  defaultValue?: SelectDefaultValue;
  preventAutoNewOptions?: SelectAutoNewOptions;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  MultipleSelectField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createCheckboxField = (params: {
  id: FieldId;
  name: FieldName;
  defaultValue?: CheckboxDefaultValue;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  CheckboxField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createAttachmentField = (params: {
  id: FieldId;
  name: FieldName;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  AttachmentField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createDateField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: DateTimeFormatting;
  defaultValue?: DateDefaultValue;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  DateField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createCreatedTimeField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: DateTimeFormatting;
  meta?: GeneratedColumnMeta;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  CreatedTimeField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createLastModifiedTimeField = (params: {
  id: FieldId;
  name: FieldName;
  formatting?: DateTimeFormatting;
  trackedFieldIds?: ReadonlyArray<FieldId>;
  meta?: GeneratedColumnMeta;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  LastModifiedTimeField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createUserField = (params: {
  id: FieldId;
  name: FieldName;
  isMultiple?: UserMultiplicity;
  shouldNotify?: UserNotification;
  defaultValue?: UserDefaultValue;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  UserField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createCreatedByField = (params: {
  id: FieldId;
  name: FieldName;
  meta?: GeneratedColumnMeta;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  CreatedByField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createLastModifiedByField = (params: {
  id: FieldId;
  name: FieldName;
  trackedFieldIds?: ReadonlyArray<FieldId>;
  meta?: GeneratedColumnMeta;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  LastModifiedByField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createAutoNumberField = (params: {
  id: FieldId;
  name: FieldName;
  meta?: GeneratedColumnMeta;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  AutoNumberField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createButtonField = (params: {
  id: FieldId;
  name: FieldName;
  label?: ButtonLabel;
  color?: FieldColor;
  maxCount?: ButtonMaxCount;
  resetCount?: ButtonResetCount;
  workflow?: ButtonWorkflow;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  ButtonField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createLinkField = (params: {
  id: FieldId;
  name: FieldName;
  config: LinkFieldConfig;
  meta?: LinkFieldMeta;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  LinkField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createNewLinkField = (params: {
  id: FieldId;
  name: FieldName;
  config: LinkFieldConfig;
  baseId: BaseId;
  hostTableId: TableId;
  meta?: LinkFieldMeta;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  LinkField.createNew(params).andThen((field) => applyFieldValidation(field, params));

export const createConditionalRollupField = (params: {
  id: FieldId;
  name: FieldName;
  config: ConditionalRollupConfig;
  expression: RollupExpression;
  valuesField: Field;
  timeZone?: TimeZone;
  formatting?: ConditionalRollupFormatting;
  showAs?: ConditionalRollupShowAs;
  dependencies?: ReadonlyArray<FieldId>;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  ConditionalRollupField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createConditionalRollupFieldPending = (params: {
  id: FieldId;
  name: FieldName;
  config: ConditionalRollupConfig;
  expression: RollupExpression;
  timeZone?: TimeZone;
  formatting?: ConditionalRollupFormatting;
  showAs?: ConditionalRollupShowAs;
  resultType?: { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity };
  dependencies?: ReadonlyArray<FieldId>;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  ConditionalRollupField.createPending(params).andThen((field) =>
    applyFieldValidation(field, params)
  );

export const createConditionalLookupField = (params: {
  id: FieldId;
  name: FieldName;
  innerField: Field;
  conditionalLookupOptions: ConditionalLookupOptions;
  dependencies?: ReadonlyArray<FieldId>;
  isMultipleCellValue?: boolean;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  ConditionalLookupField.create(params).andThen((field) => applyFieldValidation(field, params));

export const createConditionalLookupFieldPending = (params: {
  id: FieldId;
  name: FieldName;
  conditionalLookupOptions: ConditionalLookupOptions;
  dependencies?: ReadonlyArray<FieldId>;
  notNull?: FieldNotNull;
  unique?: FieldUnique;
}): Result<Field, DomainError> =>
  ConditionalLookupField.createPending(params).andThen((field) =>
    applyFieldValidation(field, params)
  );
