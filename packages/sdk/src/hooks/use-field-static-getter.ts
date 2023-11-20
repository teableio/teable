/* eslint-disable @typescript-eslint/naming-convention */
import { FieldType } from '@teable-group/core';

import {
  Calendar as CalendarIcon,
  CheckCircle2 as SelectIcon,
  CheckSquare as CheckboxIcon,
  Code as FormulaIcon,
  File as AttachmentIcon,
  Hash as NumberIcon,
  A as TextIcon,
  Layers as RollupIcon,
  Link as LinkIcon,
  ListChecks as MenuIcon,
  Search as SearchIcon,
  Star as RatingIcon,
  LongText as LongTextIcon,
  Clock4 as CreatedTimeIcon,
  History as LastModifiedTimeIcon,
  ListOrdered as AutoNumberIcon,
  User as UserIcon,
} from '@teable-group/icons';

import { useCallback } from 'react';
import {
  AttachmentField,
  AutoNumberField,
  CheckboxField,
  CreatedTimeField,
  DateField,
  LastModifiedTimeField,
  LinkField,
  LongTextField,
  MultipleSelectField,
  NumberField,
  RatingField,
  SingleLineTextField,
  SingleSelectField,
  UserField,
} from '../model';

export interface IFieldStatic {
  title: string;
  defaultOptions: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Icon: React.FC<any>;
}

export const useFieldStaticGetter = () => {
  return useCallback(
    (
      type: FieldType,
      isLookup: boolean | undefined
      // eslint-disable-next-line sonarjs/cognitive-complexity
    ): IFieldStatic => {
      switch (type) {
        case FieldType.SingleLineText:
          return {
            title: 'Single line text',
            defaultOptions: SingleLineTextField.defaultOptions(),
            Icon: isLookup ? SearchIcon : TextIcon,
          };
        case FieldType.LongText:
          return {
            title: 'Long text',
            defaultOptions: LongTextField.defaultOptions(),
            Icon: isLookup ? SearchIcon : LongTextIcon,
          };
        case FieldType.SingleSelect:
          return {
            title: 'Single select',
            defaultOptions: SingleSelectField.defaultOptions(),
            Icon: isLookup ? SearchIcon : SelectIcon,
          };
        case FieldType.Number:
          return {
            title: 'Number',
            defaultOptions: NumberField.defaultOptions(),
            Icon: isLookup ? SearchIcon : NumberIcon,
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
            Icon: isLookup ? SearchIcon : FormulaIcon,
          };
        case FieldType.Date:
          return {
            title: 'Date',
            defaultOptions: DateField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CalendarIcon,
          };
        case FieldType.CreatedTime:
          return {
            title: 'Created time',
            defaultOptions: CreatedTimeField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CreatedTimeIcon,
          };
        case FieldType.LastModifiedTime:
          return {
            title: 'Last modified time',
            defaultOptions: LastModifiedTimeField.defaultOptions(),
            Icon: isLookup ? SearchIcon : LastModifiedTimeIcon,
          };
        case FieldType.Attachment:
          return {
            title: 'Attachment',
            defaultOptions: AttachmentField.defaultOptions(),
            Icon: isLookup ? SearchIcon : AttachmentIcon,
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
            Icon: isLookup ? SearchIcon : RollupIcon,
          };
        case FieldType.User: {
          return {
            title: 'User',
            defaultOptions: UserField.defaultOptions(),
            Icon: isLookup ? SearchIcon : UserIcon,
          };
        }
        case FieldType.Rating:
          return {
            title: 'Rating',
            defaultOptions: RatingField.defaultOptions(),
            Icon: isLookup ? SearchIcon : RatingIcon,
          };
        case FieldType.AutoNumber:
          return {
            title: 'Auto number',
            defaultOptions: AutoNumberField.defaultOptions(),
            Icon: isLookup ? SearchIcon : AutoNumberIcon,
          };
        default:
          throw new Error(`field type: ${type} has not define statics`);
      }
    },
    []
  );
};
