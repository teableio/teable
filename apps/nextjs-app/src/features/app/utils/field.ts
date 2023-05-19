import { FieldType } from '@teable-group/core';
import {
  MultipleSelectField,
  NumberField,
  SingleLineTextField,
  SingleSelectField,
  LinkField,
  FormulaField,
} from '@teable-group/sdk/model';
import FieldNumberIcon from '@teable-group/ui-lib/icons/app/field-number.svg';
import FieldSelectIcon from '@teable-group/ui-lib/icons/app/field-select.svg';
import FieldTextIcon from '@teable-group/ui-lib/icons/app/field-text.svg';

export const FIELD_CONSTANT = [
  {
    text: 'Single line text',
    type: FieldType.SingleLineText,
    IconComponent: FieldTextIcon,
  },
  {
    text: 'Single select',
    type: FieldType.SingleSelect,
    IconComponent: FieldSelectIcon,
  },
  {
    text: 'Number',
    type: FieldType.Number,
    IconComponent: FieldNumberIcon,
  },
  {
    text: 'Multiple select',
    type: FieldType.MultipleSelect,
    IconComponent: FieldSelectIcon,
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

export const fieldDefaultOptionMap: Record<string, unknown> = {
  [FieldType.SingleLineText]: SingleLineTextField.defaultOptions(),
  [FieldType.SingleSelect]: SingleSelectField.defaultOptions(),
  [FieldType.Number]: NumberField.defaultOptions(),
  [FieldType.MultipleSelect]: MultipleSelectField.defaultOptions(),
  [FieldType.Link]: LinkField.defaultOptions(),
  [FieldType.Formula]: FormulaField.defaultOptions(),
};
