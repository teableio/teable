import { DateFormatting, FieldType } from '@teable-group/core';
import {
  MultipleSelectField,
  NumberField,
  SingleLineTextField,
  SingleSelectField,
  LinkField,
  FormulaField,
  DateField,
} from '@teable-group/sdk/model';
import FieldNumberIcon from '@teable-group/ui-lib/icons/app/field-number.svg';
import FieldSelectIcon from '@teable-group/ui-lib/icons/app/field-select.svg';
import FieldTextIcon from '@teable-group/ui-lib/icons/app/field-text.svg';
import FieldAttachmentIcon from '@teable-group/ui-lib/icons/app/file.svg';

export const FIELD_CONSTANT = [
  {
    text: 'Single line text',
    type: FieldType.SingleLineText,
    IconComponent: FieldTextIcon,
  },
  {
    text: 'Number',
    type: FieldType.Number,
    IconComponent: FieldNumberIcon,
  },
  {
    text: 'Single select',
    type: FieldType.SingleSelect,
    IconComponent: FieldSelectIcon,
  },
  {
    text: 'Multiple select',
    type: FieldType.MultipleSelect,
    IconComponent: FieldSelectIcon,
  },
  {
    text: 'Attachment',
    type: FieldType.Attachment,
    IconComponent: FieldAttachmentIcon,
  },
  {
    text: 'Link',
    type: FieldType.Link,
    IconComponent: FieldSelectIcon,
  },
  {
    text: 'Formula',
    type: FieldType.Formula,
    IconComponent: FieldTextIcon,
  },
  {
    text: 'Date',
    type: FieldType.Date,
    IconComponent: FieldTextIcon,
  },
];

export const NUMBER_FIELD_PRECISION = [
  {
    text: '1',
    value: 0,
  },
  {
    text: '1.0',
    value: 1,
  },
  {
    text: '1.00',
    value: 2,
  },
  {
    text: '1.000',
    value: 3,
  },
  {
    text: '1.0000',
    value: 4,
  },
];

export const DATE_FIELD_FORMATTING = [
  {
    text: DateFormatting.YMDForIncline,
    value: DateFormatting.YMDForIncline,
  },
  {
    text: DateFormatting.YMDForHorizontal,
    value: DateFormatting.YMDForHorizontal,
  },
  {
    text: DateFormatting.DMY,
    value: DateFormatting.DMY,
  },
  {
    text: DateFormatting.YM,
    value: DateFormatting.YM,
  },
  {
    text: DateFormatting.MD,
    value: DateFormatting.MD,
  },
  {
    text: DateFormatting.Y,
    value: DateFormatting.Y,
  },
  {
    text: DateFormatting.M,
    value: DateFormatting.M,
  },
  {
    text: DateFormatting.D,
    value: DateFormatting.D,
  },
];

export const fieldDefaultOptionMap: Record<string, unknown> = {
  [FieldType.SingleLineText]: SingleLineTextField.defaultOptions(),
  [FieldType.SingleSelect]: SingleSelectField.defaultOptions(),
  [FieldType.Number]: NumberField.defaultOptions(),
  [FieldType.MultipleSelect]: MultipleSelectField.defaultOptions(),
  [FieldType.Link]: LinkField.defaultOptions(),
  [FieldType.Formula]: FormulaField.defaultOptions(),
  [FieldType.Date]: DateField.defaultOptions(),
  [FieldType.Attachment]: null,
};
