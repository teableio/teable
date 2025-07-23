import type { IFieldRo, ILinkFieldOptionsRo, ILookupOptionsRo } from '@teable/core';
import { FieldType } from '@teable/core';
import { getField } from '@teable/openapi';
import { useFields, useTables } from '@teable/sdk/hooks';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';

export const useDefaultFieldName = () => {
  const { t } = useTranslation('table');
  const tables = useTables();
  const fields = useFields();

  const getLookupName = useCallback(
    async (fieldRo: IFieldRo) => {
      const { foreignTableId, lookupFieldId, linkFieldId } =
        fieldRo.lookupOptions as ILookupOptionsRo;

      const lookupField = (await getField(foreignTableId, lookupFieldId)).data;
      const linkField = fields.find((field) => field.id === linkFieldId);
      if (!lookupField || !linkField) {
        return;
      }
      return {
        lookupFieldName: lookupField.name,
        linkFieldName: linkField.name,
      };
    },
    [fields]
  );

  return useCallback(
    async (fieldRo: IFieldRo) => {
      const fieldType = fieldRo.type;
      if (fieldRo.isLookup) {
        const lookupName = await getLookupName(fieldRo);
        if (!lookupName) {
          return;
        }
        return t('field.default.lookup.title', lookupName);
      }

      switch (fieldType) {
        case FieldType.SingleLineText:
          return t('field.default.singleLineText.title');
        case FieldType.LongText:
          return t('field.default.longText.title');
        case FieldType.Number:
          return t('field.default.number.title');
        case FieldType.SingleSelect:
          return t('field.default.singleSelect.title');
        case FieldType.MultipleSelect:
          return t('field.default.multipleSelect.title');
        case FieldType.Attachment:
          return t('field.default.attachment.title');
        case FieldType.User:
          return t('field.default.user.title');
        case FieldType.Date:
          return t('field.default.date.title');
        case FieldType.AutoNumber:
          return t('field.default.autoNumber.title');
        case FieldType.CreatedTime:
          return t('field.default.createdTime.title');
        case FieldType.LastModifiedTime:
          return t('field.default.lastModifiedTime.title');
        case FieldType.CreatedBy:
          return t('field.default.createdBy.title');
        case FieldType.LastModifiedBy:
          return t('field.default.lastModifiedBy.title');
        case FieldType.Rating:
          return t('field.default.rating.title');
        case FieldType.Checkbox:
          return t('field.default.checkbox.title');
        case FieldType.Button:
          return t('field.default.button.title');
        case FieldType.Link: {
          const foreignTable = tables.find(
            (table) => table.id === (fieldRo.options as ILinkFieldOptionsRo).foreignTableId
          );
          if (!foreignTable) {
            return;
          }
          return foreignTable.name;
        }
        case FieldType.Rollup: {
          const lookupName = await getLookupName(fieldRo);
          if (!lookupName) {
            return;
          }
          return t('field.default.rollup.title', lookupName);
        }
        default:
          return;
      }
    },
    [getLookupName, t, tables]
  );
};
