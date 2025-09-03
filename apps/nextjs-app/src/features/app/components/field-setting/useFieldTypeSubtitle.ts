import { assertNever, FieldType } from '@teable/core';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const useFieldTypeSubtitle = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return useCallback(
    (fieldType: FieldType): string => {
      switch (fieldType) {
        case FieldType.Link:
          return t('table:field.subTitle.link');
        case FieldType.SingleLineText:
          return t('table:field.subTitle.singleLineText');
        case FieldType.LongText:
          return t('table:field.subTitle.longText');
        case FieldType.Attachment:
          return t('table:field.subTitle.attachment');
        case FieldType.Checkbox:
          return t('table:field.subTitle.checkbox');
        case FieldType.MultipleSelect:
          return t('table:field.subTitle.multipleSelect');
        case FieldType.SingleSelect:
          return t('table:field.subTitle.singleSelect');
        case FieldType.User:
          return t('table:field.subTitle.user');
        case FieldType.Date:
          return t('table:field.subTitle.date');
        case FieldType.Number:
          return t('table:field.subTitle.number');
        case FieldType.Rating:
          return t('table:field.subTitle.rating');
        case FieldType.Formula:
          return t('table:field.subTitle.formula');
        case FieldType.Rollup:
          return t('table:field.subTitle.rollup');
        case FieldType.CreatedTime:
          return t('table:field.subTitle.createdTime');
        case FieldType.LastModifiedTime:
          return t('table:field.subTitle.lastModifiedTime');
        case FieldType.CreatedBy:
          return t('table:field.subTitle.createdBy');
        case FieldType.LastModifiedBy:
          return t('table:field.subTitle.lastModifiedBy');
        case FieldType.AutoNumber:
          return t('table:field.subTitle.autoNumber');
        case FieldType.Button:
          return t('table:field.subTitle.button');
        default: {
          assertNever(fieldType);
        }
      }
    },
    [t]
  );
};
