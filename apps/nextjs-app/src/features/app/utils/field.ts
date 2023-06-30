import { DateFormatting, FieldType, TimeFormatting } from '@teable-group/core';
import {
  MultipleSelectField,
  NumberField,
  SingleLineTextField,
  SingleSelectField,
  LinkField,
  FormulaField,
  DateField,
} from '@teable-group/sdk/model';
import CalendarIcon from '@teable-group/ui-lib/icons/app/calendar.svg';
import CodeIcon from '@teable-group/ui-lib/icons/app/code.svg';
import FieldNumberIcon from '@teable-group/ui-lib/icons/app/field-number.svg';
import FieldSelectIcon from '@teable-group/ui-lib/icons/app/field-select.svg';
import FieldTextIcon from '@teable-group/ui-lib/icons/app/field-text.svg';
import FieldAttachmentIcon from '@teable-group/ui-lib/icons/app/file.svg';
import LinkIcon from '@teable-group/ui-lib/icons/app/link.svg';
import MenuIcon from '@teable-group/ui-lib/icons/app/menu.svg';

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
    IconComponent: MenuIcon,
  },
  {
    text: 'Date',
    type: FieldType.Date,
    IconComponent: CalendarIcon,
  },
  {
    text: 'Attachment',
    type: FieldType.Attachment,
    IconComponent: FieldAttachmentIcon,
  },
  {
    text: 'Formula',
    type: FieldType.Formula,
    IconComponent: CodeIcon,
  },
  {
    text: 'Link',
    type: FieldType.Link,
    IconComponent: LinkIcon,
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

export const DATE_FORMATTING_OF_DATE_FIELD = [
  {
    text: 'Year/Month/Day',
    value: DateFormatting.YMDWithSlash,
  },
  {
    text: 'Year-Month-Day',
    value: DateFormatting.YMDWithDash,
  },
  {
    text: 'Day/Month/Year',
    value: DateFormatting.DMY,
  },
  {
    text: 'Year/Month',
    value: DateFormatting.YM,
  },
  {
    text: 'Month/Day',
    value: DateFormatting.MD,
  },
  {
    text: 'Year',
    value: DateFormatting.Y,
  },
  {
    text: 'Month',
    value: DateFormatting.M,
  },
  {
    text: 'Day',
    value: DateFormatting.D,
  },
];

export const TIME_FORMATTING_OF_DATE_FIELD = [
  {
    text: '24 hour',
    value: TimeFormatting.Hour24,
  },
  {
    text: '12 hour',
    value: TimeFormatting.Hour12,
  },
  {
    text: 'No display',
    value: TimeFormatting.None,
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
