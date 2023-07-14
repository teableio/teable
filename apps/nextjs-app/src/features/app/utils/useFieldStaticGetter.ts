import { FieldType } from '@teable-group/core';
import {
  MultipleSelectField,
  NumberField,
  SingleLineTextField,
  SingleSelectField,
  LinkField,
  FormulaField,
  DateField,
  AttachmentField,
  CheckboxField,
} from '@teable-group/sdk/model';
import CalendarIcon from '@teable-group/ui-lib/icons/app/calendar.svg';
import CheckboxIcon from '@teable-group/ui-lib/icons/app/check-item.svg';
import CodeIcon from '@teable-group/ui-lib/icons/app/code.svg';
import FieldNumberIcon from '@teable-group/ui-lib/icons/app/field-number.svg';
import FieldSelectIcon from '@teable-group/ui-lib/icons/app/field-select.svg';
import FieldTextIcon from '@teable-group/ui-lib/icons/app/field-text.svg';
import FieldAttachmentIcon from '@teable-group/ui-lib/icons/app/file.svg';
import UnknownIcon from '@teable-group/ui-lib/icons/app/help.svg';
import LinkIcon from '@teable-group/ui-lib/icons/app/link.svg';
import MenuIcon from '@teable-group/ui-lib/icons/app/menu.svg';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { useCallback } from 'react';

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
            defaultOptions: FormulaField.defaultOptions(),
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
