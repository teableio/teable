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
import LinkIcon from '@teable-group/ui-lib/icons/app/link.svg';
import MenuIcon from '@teable-group/ui-lib/icons/app/menu.svg';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { useCallback } from 'react';

export const useFieldStaticGetter = () => {
  return useCallback(
    (
      type: FieldType,
      isLookup: boolean | undefined
      // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any, sonarjs/cognitive-complexity
    ): { title: string; defaultOptions: unknown; Icon: any } => {
      switch (type) {
        case FieldType.SingleLineText:
          return {
            title: 'Single line text',
            defaultOptions: SingleLineTextField.defaultOptions(),
            Icon: isLookup ? SearchIcon : FieldTextIcon,
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
            defaultOptions: FormulaField.defaultOptions(),
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
        default:
          throw new Error(`field type: ${type} has not define statics`);
      }
    },
    []
  );
};
