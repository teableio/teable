import { useQuery } from '@tanstack/react-query';
import type { IInplaceImportOptionRo, IImportOptionRo } from '@teable/openapi';
import { getTableById as apiGetTableById, getFields as apiGetFields } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { isEqual } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { InplaceImportOptionPanel } from '../CollapsePanel';
import { InplacePreviewColumn } from './InplacePreviewColumn';

interface IInplaceFieldConfigPanel {
  tableId: string;
  workSheets: IImportOptionRo['worksheets'];
  errorMessage: string;
  insertConfig: IInplaceImportOptionRo['insertConfig'];
  onChange: (value: IInplaceImportOptionRo['insertConfig']) => void;
}

export type IInplaceOption = Pick<
  IInplaceImportOptionRo['insertConfig'],
  'excludeFirstRow' | 'sourceWorkSheetKey'
>;

const InplaceFieldConfigPanel = (props: IInplaceFieldConfigPanel) => {
  const baseId = useBaseId() as string;
  const { t } = useTranslation(['table']);
  const { tableId, workSheets, insertConfig, onChange, errorMessage } = props;

  const options: IInplaceOption = useMemo(
    () => ({
      excludeFirstRow: insertConfig.excludeFirstRow,
      sourceWorkSheetKey: insertConfig.sourceWorkSheetKey,
    }),
    [insertConfig]
  );

  const { data: table } = useQuery({
    queryKey: ReactQueryKeys.tableInfo(baseId, tableId),
    queryFn: () => apiGetTableById(baseId, tableId).then((data) => data.data),
  });

  const { data: fields } = useQuery({
    queryKey: ReactQueryKeys.field(tableId),
    queryFn: () => apiGetFields(tableId).then((data) => data.data),
  });

  const fieldWithPermission = fields?.filter(({ recordRead }) => recordRead !== false);

  const optionHandler = (value: IInplaceOption, propertyName: keyof IInplaceOption) => {
    const newInsertConfig = {
      ...insertConfig,
      ...value,
    };
    if (propertyName === 'sourceWorkSheetKey') {
      newInsertConfig.sourceColumnMap = {};
    }
    onChange(newInsertConfig);
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
          {table?.name}
        </p>
      </div>

      {fieldWithPermission && (
        <div className="my-2 h-[400px] overflow-y-auto rounded-sm border border-secondary">
          <InplacePreviewColumn
            onChange={columnHandler}
            workSheets={workSheets}
            fields={fieldWithPermission}
            insertConfig={insertConfig}
          ></InplacePreviewColumn>
        </div>
      )}

      {errorMessage && <p className="pl-2 text-sm text-red-500">{errorMessage}</p>}

      <InplaceImportOptionPanel
        options={options}
        workSheets={workSheets}
        onChange={optionHandler}
      />
    </div>
  );
};

export { InplaceFieldConfigPanel };
