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
  ConditionalLookup as ConditionalLookupIcon,
  ConditionalRollup as ConditionalRollupIcon,
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
  MousePointerClick as MousePointerClickIcon,
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
  description: string;
  defaultOptions: unknown;
  Icon: React.FC<any>;
}

export const useFieldStaticGetter = () => {
  const { t } = useTranslation();

  return useCallback(
    (
      type: FieldType,
      config: {
        isLookup?: boolean;
        isConditionalLookup?: boolean;
        hasAiConfig?: boolean;
        deniedReadRecord?: boolean;
      } = {}
      // eslint-disable-next-line sonarjs/cognitive-complexity
    ): IFieldStatic => {
      const { isLookup, isConditionalLookup, hasAiConfig, deniedReadRecord } = config;

      const getIcon = (icon: React.FC<any>) => {
        if (deniedReadRecord)
          return (props: React.SVGProps<SVGSVGElement>) =>
            EyeOff({ ...props, color: 'hsl(var(--destructive))' });
        if (hasAiConfig) return MagicAi;
        if (isLookup) {
          return isConditionalLookup ? ConditionalLookupIcon : SearchIcon;
        }
        return icon;
      };

      switch (type) {
        case FieldType.SingleLineText:
          return {
            title: t('field.title.singleLineText'),
            description: t('field.description.singleLineText'),
            defaultOptions: SingleLineTextField.defaultOptions(),
            Icon: getIcon(TextIcon),
          };
        case FieldType.LongText:
          return {
            title: t('field.title.longText'),
            description: t('field.description.longText'),
            defaultOptions: LongTextField.defaultOptions(),
            Icon: getIcon(LongTextIcon),
          };
        case FieldType.SingleSelect:
          return {
            title: t('field.title.singleSelect'),
            description: t('field.description.singleSelect'),
            defaultOptions: SingleSelectField.defaultOptions(),
            Icon: getIcon(SelectIcon),
          };
        case FieldType.Number:
          return {
            title: t('field.title.number'),
            description: t('field.description.number'),
            defaultOptions: NumberField.defaultOptions(),
            Icon: getIcon(NumberIcon),
          };
        case FieldType.MultipleSelect:
          return {
            title: t('field.title.multipleSelect'),
            description: t('field.description.multipleSelect'),
            defaultOptions: MultipleSelectField.defaultOptions(),
            Icon: getIcon(MenuIcon),
          };
        case FieldType.Link:
          return {
            title: t('field.title.link'),
            description: t('field.description.link'),
            defaultOptions: LinkField.defaultOptions(),
            Icon: getIcon(LinkIcon),
          };
        case FieldType.Formula:
          return {
            title: t('field.title.formula'),
            description: t('field.description.formula'),
            defaultOptions: {},
            Icon: getIcon(FormulaIcon),
          };
        case FieldType.Date:
          return {
            title: t('field.title.date'),
            description: t('field.description.date'),
            defaultOptions: DateField.defaultOptions(),
            Icon: getIcon(CalendarIcon),
          };
        case FieldType.CreatedTime:
          return {
            title: t('field.title.createdTime'),
            description: t('field.description.createdTime'),
            defaultOptions: CreatedTimeField.defaultOptions(),
            Icon: getIcon(CreatedTimeIcon),
          };
        case FieldType.LastModifiedTime:
          return {
            title: t('field.title.lastModifiedTime'),
            description: t('field.description.lastModifiedTime'),
            defaultOptions: LastModifiedTimeField.defaultOptions(),
            Icon: getIcon(LastModifiedTimeIcon),
          };
        case FieldType.Attachment:
          return {
            title: t('field.title.attachment'),
            description: t('field.description.attachment'),
            defaultOptions: AttachmentField.defaultOptions(),
            Icon: getIcon(AttachmentIcon),
          };
        case FieldType.Checkbox:
          return {
            title: t('field.title.checkbox'),
            description: t('field.description.checkbox'),
            defaultOptions: CheckboxField.defaultOptions(),
            Icon: getIcon(CheckboxIcon),
          };
        case FieldType.Rollup:
          return {
            title: t('field.title.rollup'),
            description: t('field.description.rollup'),
            defaultOptions: {},
            Icon: getIcon(RollupIcon),
          };
        case FieldType.ConditionalRollup:
          return {
            title: t('field.title.conditionalRollup'),
            description: t('field.description.conditionalRollup'),
            defaultOptions: {},
            Icon: getIcon(ConditionalRollupIcon),
          };
        case FieldType.User: {
          return {
            title: t('field.title.user'),
            description: t('field.description.user'),
            defaultOptions: UserField.defaultOptions(),
            Icon: getIcon(UserIcon),
          };
        }
        case FieldType.Rating:
          return {
            title: t('field.title.rating'),
            description: t('field.description.rating'),
            defaultOptions: RatingField.defaultOptions(),
            Icon: getIcon(RatingIcon),
          };
        case FieldType.AutoNumber:
          return {
            title: t('field.title.autoNumber'),
            description: t('field.description.autoNumber'),
            defaultOptions: AutoNumberField.defaultOptions(),
            Icon: getIcon(AutoNumberIcon),
          };
        case FieldType.CreatedBy:
          return {
            title: t('field.title.createdBy'),
            description: t('field.description.createdBy'),
            defaultOptions: {},
            Icon: getIcon(CreatedByIcon),
          };
        case FieldType.LastModifiedBy:
          return {
            title: t('field.title.lastModifiedBy'),
            description: t('field.description.lastModifiedBy'),
            defaultOptions: {},
            Icon: getIcon(LastModifiedByIcon),
          };
        case FieldType.Button:
          return {
            title: t('field.title.button'),
            description: t('field.description.button'),
            defaultOptions: {
              label: t('common.click'),
              color: Colors.Teal,
            },
            Icon: getIcon(MousePointerClickIcon),
          };
        default:
          throw new Error(`field type: ${type} has not define statics`);
      }
    },
    [t]
  );
};
