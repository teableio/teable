import { useQuery } from '@tanstack/react-query';
import type { IInplaceImportOptionRo, IImportOptionRo } from '@teable/core';
import { getTableById as apiGetTableById, getFields as apiGetFields } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import { isEqual } from 'lodash';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { InplaceImportOptionPanel } from '../CollapsePanel';
import { InplacePreviewColumn } from './InplacePreviewColumn';

interface IInplaceFieldConfigPanel {
  tableId: string;
  workSheets: IImportOptionRo['worksheets'];
  insertConfig: IInplaceImportOptionRo['insertConfig'];
  onChange: (value: IInplaceImportOptionRo['insertConfig']) => void;
}

export type IInplaceOption = Pick<
  IInplaceImportOptionRo['insertConfig'],
  'excludeFirstRow' | 'sourceWorkSheetKey'
>;

const InplaceFieldConfigPanel = (props: IInplaceFieldConfigPanel) => {
  const base = useBase();
  const { t } = useTranslation(['table']);
  const { tableId, workSheets, insertConfig, onChange } = props;

  const options: IInplaceOption = useMemo(
    () => ({
      excludeFirstRow: insertConfig.excludeFirstRow,
      sourceWorkSheetKey: insertConfig.sourceWorkSheetKey,
    }),
    [insertConfig]
  );

  const { data: table } = useQuery({
    queryKey: ReactQueryKeys.tableInfo(base.id, tableId),
    queryFn: () => apiGetTableById(base.id, tableId, {}),
  });

  const { data: fields } = useQuery({
    queryKey: ReactQueryKeys.field(tableId),
    queryFn: () => apiGetFields(tableId),
  });

  const optionHandler = (value: IInplaceOption) => {
    onChange({
      ...insertConfig,
      ...value,
    });
  };

  const columnHandler = (value: IInplaceImportOptionRo['insertConfig']['sourceColumnMap']) => {
    if (
      !isEqual(insertConfig.sourceColumnMap, {
        ...insertConfig.sourceColumnMap,
        ...value,
      })
    ) {
      onChange({
        ...insertConfig,
        ['sourceColumnMap']: {
          ...insertConfig.sourceColumnMap,
          ...value,
        },
      });
    }
  };

  return (
    <div className="flex flex-col">
      <div>
        <p className="text-base font-bold">
          {t('table:import.title.incrementImportTitle')}
          {table?.data.name}
        </p>
      </div>

      {fields?.data && (
        <div className="my-2 h-[400px] overflow-y-auto rounded-sm border border-secondary">
          <InplacePreviewColumn
            onChange={columnHandler}
            workSheets={workSheets}
            fields={fields?.data}
            insertConfig={insertConfig}
          ></InplacePreviewColumn>
        </div>
      )}

      <InplaceImportOptionPanel
        options={options}
        workSheets={workSheets}
        onChange={optionHandler}
      />
    </div>
  );
};

export { InplaceFieldConfigPanel };
