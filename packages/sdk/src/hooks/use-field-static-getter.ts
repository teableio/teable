/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { Colors, FieldType } from '@teable/core';

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
  EyeOff,
  MagicAi,
} from '@teable/icons';

import { MousePointerClick } from 'lucide-react';
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
  Icon: React.FC<any>;
}

export const useFieldStaticGetter = () => {
  const { t } = useTranslation();

  return useCallback(
    (
      type: FieldType,
      config: {
        isLookup: boolean | undefined;
        hasAiConfig: boolean | undefined;
        deniedReadRecord?: boolean;
      } = {
        isLookup: undefined,
        hasAiConfig: undefined,
      }
      // eslint-disable-next-line sonarjs/cognitive-complexity
    ): IFieldStatic => {
      const { isLookup, hasAiConfig, deniedReadRecord } = config;

      const getIcon = (icon: React.FC<any>) => {
        if (deniedReadRecord)
          return (props: React.SVGProps<SVGSVGElement>) =>
            EyeOff({ ...props, color: 'hsl(var(--destructive))' });
        if (hasAiConfig) return MagicAi;
        return isLookup ? SearchIcon : icon;
      };

      switch (type) {
        case FieldType.SingleLineText:
          return {
            title: t('field.title.singleLineText'),
            defaultOptions: SingleLineTextField.defaultOptions(),
            Icon: getIcon(TextIcon),
          };
        case FieldType.LongText:
          return {
            title: t('field.title.longText'),
            defaultOptions: LongTextField.defaultOptions(),
            Icon: getIcon(LongTextIcon),
          };
        case FieldType.SingleSelect:
          return {
            title: t('field.title.singleSelect'),
            defaultOptions: SingleSelectField.defaultOptions(),
            Icon: getIcon(SelectIcon),
          };
        case FieldType.Number:
          return {
            title: t('field.title.number'),
            defaultOptions: NumberField.defaultOptions(),
            Icon: getIcon(NumberIcon),
          };
        case FieldType.MultipleSelect:
          return {
            title: t('field.title.multipleSelect'),
            defaultOptions: MultipleSelectField.defaultOptions(),
            Icon: getIcon(MenuIcon),
          };
        case FieldType.Link:
          return {
            title: t('field.title.link'),
            defaultOptions: LinkField.defaultOptions(),
            Icon: getIcon(LinkIcon),
          };
        case FieldType.Formula:
          return {
            title: t('field.title.formula'),
            defaultOptions: {},
            Icon: getIcon(FormulaIcon),
          };
        case FieldType.Date:
          return {
            title: t('field.title.date'),
            defaultOptions: DateField.defaultOptions(),
            Icon: getIcon(CalendarIcon),
          };
        case FieldType.CreatedTime:
          return {
            title: t('field.title.createdTime'),
            defaultOptions: CreatedTimeField.defaultOptions(),
            Icon: getIcon(CreatedTimeIcon),
          };
        case FieldType.LastModifiedTime:
          return {
            title: t('field.title.lastModifiedTime'),
            defaultOptions: LastModifiedTimeField.defaultOptions(),
            Icon: getIcon(LastModifiedTimeIcon),
          };
        case FieldType.Attachment:
          return {
            title: t('field.title.attachment'),
            defaultOptions: AttachmentField.defaultOptions(),
            Icon: getIcon(AttachmentIcon),
          };
        case FieldType.Checkbox:
          return {
            title: t('field.title.checkbox'),
            defaultOptions: CheckboxField.defaultOptions(),
            Icon: getIcon(CheckboxIcon),
          };
        case FieldType.Rollup:
          return {
            title: t('field.title.rollup'),
            defaultOptions: {},
            Icon: getIcon(RollupIcon),
          };
        case FieldType.User: {
          return {
            title: t('field.title.user'),
            defaultOptions: UserField.defaultOptions(),
            Icon: getIcon(UserIcon),
          };
        }
        case FieldType.Rating:
          return {
            title: t('field.title.rating'),
            defaultOptions: RatingField.defaultOptions(),
            Icon: getIcon(RatingIcon),
          };
        case FieldType.AutoNumber:
          return {
            title: t('field.title.autoNumber'),
            defaultOptions: AutoNumberField.defaultOptions(),
            Icon: getIcon(AutoNumberIcon),
          };
        case FieldType.CreatedBy:
          return {
            title: t('field.title.createdBy'),
            defaultOptions: {},
            Icon: getIcon(CreatedByIcon),
          };
        case FieldType.LastModifiedBy:
          return {
            title: t('field.title.lastModifiedBy'),
            defaultOptions: {},
            Icon: getIcon(LastModifiedByIcon),
          };
        case FieldType.Button:
          return {
            title: t('field.title.button'),
            defaultOptions: {
              label: t('common.click'),
              color: Colors.Teal,
            },
            Icon: getIcon(MousePointerClick),
          };
        default:
          throw new Error(`field type: ${type} has not define statics`);
      }
    },
    [t]
  );
};
