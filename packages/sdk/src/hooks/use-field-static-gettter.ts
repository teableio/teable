import { FieldType } from '@teable-group/core';

import {
  Calendar as CalendarIcon,
  CheckCircle2 as FieldSelectIcon,
  CheckSquare as CheckboxIcon,
  Code as CodeIcon,
  File as FieldAttachmentIcon,
  Hash as FieldNumberIcon,
  HelpCircle as UnknownIcon,
  Languages as FieldTextIcon,
  Layers as FieldRollupIcon,
  Link as LinkIcon,
  ListChecks as MenuIcon,
  Search as SearchIcon,
} from '@teable-group/icons';

import { useCallback } from 'react';
import {
  AttachmentField,
  CheckboxField,
  DateField,
  LinkField,
  MultipleSelectField,
  NumberField,
  SingleLineTextField,
  SingleSelectField,
} from '../model';

export interface IFieldStatic {
  title: string;
  defaultOptions: unknown;
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
  Icon: any;
}

export const useFieldStaticGetter = () => {
  return useCallback(
    (
      type: FieldType,
      isLookup: boolean | undefined
      // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any, sonarjs/cognitive-complexity
    ): IFieldStatic => {
      switch (type) {
        case FieldType.SingleLineText:
          return {
            title: 'Single line text',
            defaultOptions: SingleLineTextField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldTextIcon,
          };
        case FieldType.LongText:
          return {
            title: 'Long text',
            defaultOptions: {},
            Icon: UnknownIcon,
          };
        case FieldType.SingleSelect:
          return {
            title: 'Single select',
            defaultOptions: SingleSelectField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldSelectIcon,
          };
        case FieldType.Number:
          return {
            title: 'Number',
            defaultOptions: NumberField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldNumberIcon,
          };
        case FieldType.MultipleSelect:
          return {
            title: 'Multiple select',
            defaultOptions: MultipleSelectField.defaultOptions(),
            Icon: isLookup ? SearchIcon : MenuIcon,
          };
        case FieldType.Link:
          return {
            title: 'Link',
            defaultOptions: LinkField.defaultOptions(),
            Icon: isLookup ? SearchIcon : LinkIcon,
          };
        case FieldType.Formula:
          return {
            title: 'Formula',
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : CodeIcon,
          };
        case FieldType.Date:
          return {
            title: 'Date',
            defaultOptions: DateField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CalendarIcon,
          };
        case FieldType.Attachment:
          return {
            title: 'Attachment',
            defaultOptions: AttachmentField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldAttachmentIcon,
          };
        case FieldType.Checkbox:
          return {
            title: 'Checkbox',
            defaultOptions: CheckboxField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CheckboxIcon,
          };
        case FieldType.Rollup:
          return {
            title: 'Rollup',
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : FieldRollupIcon,
          };
        case FieldType.User:
          return {
            title: 'User',
            defaultOptions: {},
            Icon: UnknownIcon,
          };
        case FieldType.Currency:
          return {
            title: 'Currency',
            defaultOptions: {},
            Icon: UnknownIcon,
          };
        default:
          throw new Error(`field type: ${type} has not define statics`);
      }
    },
    []
  );
};
