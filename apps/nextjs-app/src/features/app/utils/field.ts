import { FieldType } from '@teable-group/core';
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
