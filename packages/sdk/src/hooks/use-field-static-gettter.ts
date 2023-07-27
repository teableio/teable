import { FieldType } from '@teable-group/core';

import {
  Calendar as CalendarIcon,
  CheckSquare as CheckboxIcon,
  Code as CodeIcon,
  Hash as FieldNumberIcon,
  Search as SearchIcon,
  CheckCircle2 as FieldSelectIcon,
  Languages as FieldTextIcon,
  File as FieldAttachmentIcon,
  HelpCircle as UnknownIcon,
  Layers as FieldRollupIcon,
  Link as LinkIcon,
  ListChecks as MenuIcon,
} from '@teable-group/icons';

import { useCallback } from 'react';
import {
  MultipleSelectField,
  NumberField,
  SingleLineTextField,
  SingleSelectField,
  LinkField,
  DateField,
  AttachmentField,
  CheckboxField,
} from '../model';

export interface IFieldStatic {
  title: string;
  defaultOptions: unknown;
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
  Icon: any;
  defaultName: string;
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
            defaultName: 'Label',
            defaultOptions: SingleLineTextField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldTextIcon,
          };
        case FieldType.LongText:
          return {
            title: 'Long text',
            defaultName: 'Notes',
            defaultOptions: {},
            Icon: UnknownIcon,
          };
        case FieldType.SingleSelect:
          return {
            title: 'Single select',
            defaultName: 'Select',
            defaultOptions: SingleSelectField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldSelectIcon,
          };
        case FieldType.Number:
          return {
            title: 'Number',
            defaultName: 'Number',
            defaultOptions: NumberField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldNumberIcon,
          };
        case FieldType.MultipleSelect:
          return {
            title: 'Multiple select',
            defaultName: 'Tags',
            defaultOptions: MultipleSelectField.defaultOptions(),
            Icon: isLookup ? SearchIcon : MenuIcon,
          };
        case FieldType.Link:
          return {
            title: 'Link',
            defaultName: 'Link',
            defaultOptions: LinkField.defaultOptions(),
            Icon: isLookup ? SearchIcon : LinkIcon,
          };
        case FieldType.Formula:
          return {
            title: 'Formula',
            defaultName: 'Calculation',
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : CodeIcon,
          };
        case FieldType.Date:
          return {
            title: 'Date',
            defaultName: 'Date',
            defaultOptions: DateField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CalendarIcon,
          };
        case FieldType.Attachment:
          return {
            title: 'Attachment',
            defaultName: 'Attachments',
            defaultOptions: AttachmentField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldAttachmentIcon,
          };
        case FieldType.Checkbox:
          return {
            title: 'Checkbox',
            defaultName: 'Done',
            defaultOptions: CheckboxField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CheckboxIcon,
          };
        case FieldType.Rollup:
          return {
            title: 'Rollup',
            defaultName: 'Rollup',
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : FieldRollupIcon,
          };
        case FieldType.User:
          return {
            title: 'User',
            defaultName: 'Collaborator',
            defaultOptions: {},
            Icon: UnknownIcon,
          };
        case FieldType.Currency:
          return {
            title: 'Currency',
            defaultName: 'Value',
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
