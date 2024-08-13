/* eslint-disable @typescript-eslint/naming-convention */
import { FieldType } from '@teable/core';

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
  UserPlus as CreatedByIcon,
  UserEdit as LastModifiedByIcon,
} from '@teable/icons';

import { useCallback } from 'react';
import { useTranslation } from '../context/app/i18n';
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
  const { t } = useTranslation();

  return useCallback(
    (
      type: FieldType,
      isLookup: boolean | undefined
      // eslint-disable-next-line sonarjs/cognitive-complexity
    ): IFieldStatic => {
      switch (type) {
        case FieldType.SingleLineText:
          return {
            title: t('field.title.singleLineText'),
            defaultOptions: SingleLineTextField.defaultOptions(),
            Icon: isLookup ? SearchIcon : TextIcon,
          };
        case FieldType.LongText:
          return {
            title: t('field.title.longText'),
            defaultOptions: LongTextField.defaultOptions(),
            Icon: isLookup ? SearchIcon : LongTextIcon,
          };
        case FieldType.SingleSelect:
          return {
            title: t('field.title.singleSelect'),
            defaultOptions: SingleSelectField.defaultOptions(),
            Icon: isLookup ? SearchIcon : SelectIcon,
          };
        case FieldType.Number:
          return {
            title: t('field.title.number'),
            defaultOptions: NumberField.defaultOptions(),
            Icon: isLookup ? SearchIcon : NumberIcon,
          };
        case FieldType.MultipleSelect:
          return {
            title: t('field.title.multipleSelect'),
            defaultOptions: MultipleSelectField.defaultOptions(),
            Icon: isLookup ? SearchIcon : MenuIcon,
          };
        case FieldType.Link:
          return {
            title: t('field.title.link'),
            defaultOptions: LinkField.defaultOptions(),
            Icon: isLookup ? SearchIcon : LinkIcon,
          };
        case FieldType.Formula:
          return {
            title: t('field.title.formula'),
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : FormulaIcon,
          };
        case FieldType.Date:
          return {
            title: t('field.title.date'),
            defaultOptions: DateField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CalendarIcon,
          };
        case FieldType.CreatedTime:
          return {
            title: t('field.title.createdTime'),
            defaultOptions: CreatedTimeField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CreatedTimeIcon,
          };
        case FieldType.LastModifiedTime:
          return {
            title: t('field.title.lastModifiedTime'),
            defaultOptions: LastModifiedTimeField.defaultOptions(),
            Icon: isLookup ? SearchIcon : LastModifiedTimeIcon,
          };
        case FieldType.Attachment:
          return {
            title: t('field.title.attachment'),
            defaultOptions: AttachmentField.defaultOptions(),
            Icon: isLookup ? SearchIcon : AttachmentIcon,
          };
        case FieldType.Checkbox:
          return {
            title: t('field.title.checkbox'),
            defaultOptions: CheckboxField.defaultOptions(),
            Icon: isLookup ? SearchIcon : CheckboxIcon,
          };
        case FieldType.Rollup:
          return {
            title: t('field.title.rollup'),
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : RollupIcon,
          };
        case FieldType.User: {
          return {
            title: t('field.title.user'),
            defaultOptions: UserField.defaultOptions(),
            Icon: isLookup ? SearchIcon : UserIcon,
          };
        }
        case FieldType.Rating:
          return {
            title: t('field.title.rating'),
            defaultOptions: RatingField.defaultOptions(),
            Icon: isLookup ? SearchIcon : RatingIcon,
          };
        case FieldType.AutoNumber:
          return {
            title: t('field.title.autoNumber'),
            defaultOptions: AutoNumberField.defaultOptions(),
            Icon: isLookup ? SearchIcon : AutoNumberIcon,
          };
        case FieldType.CreatedBy:
          return {
            title: t('field.title.createdBy'),
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : CreatedByIcon,
          };
        case FieldType.LastModifiedBy:
          return {
            title: t('field.title.lastModifiedBy'),
            defaultOptions: {},
            Icon: isLookup ? SearchIcon : LastModifiedByIcon,
          };
        default:
          throw new Error(`field type: ${type} has not define statics`);
      }
    },
    [t]
  );
};
