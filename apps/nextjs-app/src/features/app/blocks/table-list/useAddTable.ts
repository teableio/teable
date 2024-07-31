import type { IFieldRo } from '@teable/core';
import { Colors, FieldType, getUniqName, NumberFormattingType, ViewType } from '@teable/core';
import { useBase, useTables } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';

const useDefaultFields = (): IFieldRo[] => {
  const { t } = useTranslation('table');
  return [
    { name: t('field.default.singleLineText.title'), type: FieldType.SingleLineText },
    {
      name: t('field.default.number.title'),
      type: FieldType.Number,
      options: {
        formatting: {
          precision: 0,
          type: NumberFormattingType.Decimal,
        },
      },
    },
    {
      name: t('field.default.singleSelect.title'),
      type: FieldType.SingleSelect,
      options: {
        choices: [
          {
            name: t('field.default.singleSelect.options.todo'),
            color: Colors.OrangeDark1,
          },
          {
            name: t('field.default.singleSelect.options.inProgress'),
            color: Colors.CyanBright,
          },
          {
            name: t('field.default.singleSelect.options.done'),
            color: Colors.Teal,
          },
        ],
      },
    },
  ];
};

export function useAddTable() {
  const base = useBase();
  const tables = useTables();
  const router = useRouter();
  const { baseId } = router.query;
  const { t } = useTranslation('table');
  const fieldRos = useDefaultFields();

  return useCallback(async () => {
    const uniqueName = getUniqName(
      t('table.newTableLabel'),
      tables.map((table) => table.name)
    );
    const tableData = (
      await base.createTable({
        name: uniqueName,
        views: [{ name: t('view.category.table'), type: ViewType.Grid }],
        fields: fieldRos,
      })
    ).data;
    const tableId = tableData.id;
    const viewId = tableData.defaultViewId;
    router.push(
      {
        pathname: '/base/[baseId]/[tableId]/[viewId]',
        query: { baseId, tableId, viewId },
      },
      undefined,
      {
        shallow: Boolean(router.query.viewId),
      }
    );
  }, [t, tables, base, fieldRos, router, baseId]);
}
