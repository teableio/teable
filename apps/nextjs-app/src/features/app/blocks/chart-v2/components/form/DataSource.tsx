import { useMutation } from '@tanstack/react-query';
import type { ITableQuery } from '@teable/openapi';
import { DataSource, getFields } from '@teable/openapi';
import { useTables } from '@teable/sdk/hooks';
import { Separator, Tabs, TabsContent, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useStorage } from '../../hooks';
import { AxisConfig } from './AxisConfig';
import { FilterButton } from './FilterButton';
import { FormLabel } from './FormLabel';
import { ColumnConfig, SqlButton } from './sql-builder';
import { TableSelect } from './TableSelect';
import { ViewSelect } from './ViewSelect';

export const DataSourceSelect = () => {
  const { t } = useTranslation('chart');
  const { updateStorageByPath, storage } = useStorage();
  const { dataSource, query } = storage;

  const tableId = (query as ITableQuery)?.tableId;
  const viewId = (query as ITableQuery)?.viewId;

  const tableList = useTables() || [];

  const { mutateAsync: getFieldsFn } = useMutation({
    mutationFn: (tableId: string) => getFields(tableId).then((res) => res.data),
  });

  return (
    <div className="w-full flex-1">
      <Tabs className="w-full" value={dataSource}>
        <TabsList className="w-full">
          <TabsTrigger
            value={DataSource.Table as string}
            className="w-full"
            onClick={async () => {
              const defaultTableId = tableList?.at(-1)?.id;
              if (!defaultTableId) return;
              const fields = await getFieldsFn(defaultTableId);
              const defaultField = fields?.[0]?.id;
              if (!defaultField) return;
              const paths = [
                {
                  path: 'dataSource',
                  value: DataSource.Table,
                },
                {
                  path: 'config',
                  value: null,
                },
                {
                  path: 'query.tableId',
                  value: defaultTableId,
                },
                {
                  path: 'query.viewId',
                  value: null,
                },
                {
                  path: 'query.xAxis',
                  value: defaultField,
                },
                {
                  path: 'query.seriesArray',
                  value: 'COUNTA',
                },
                {
                  path: 'query.filter',
                  value: null,
                },
                {
                  path: 'query.groupBy',
                  value: null,
                },
              ];
              updateStorageByPath(paths);
            }}
          >
            {t('chartV2.form.dataSource.fromTable')}
          </TabsTrigger>
          <TabsTrigger
            value={DataSource.Sql}
            className="w-full"
            onClick={() => {
              const paths = [
                {
                  path: 'dataSource',
                  value: DataSource.Sql,
                },
                {
                  path: 'query',
                  value: {
                    sql: null,
                  },
                },
                {
                  path: 'config',
                  value: null,
                },
              ];
              updateStorageByPath(paths);
            }}
          >
            {t('chartV2.form.dataSource.fromQuery')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={DataSource.Table} className="flex flex-col gap-2">
          <FormLabel label={t('chartV2.form.label.table')}>
            <TableSelect
              value={tableId}
              onChange={async (value) => {
                const fields = await getFieldsFn(value);
                const paths = [{ path: 'query.tableId', value }] as Array<{
                  path: string;
                  value: unknown;
                }>;
                const changePaths = [
                  {
                    path: 'query.viewId',
                    value: null,
                  },
                  {
                    path: 'query.filter',
                    value: null,
                  },
                  {
                    path: 'query.groupBy',
                    value: null,
                  },
                  {
                    path: 'query.seriesArray',
                    value: 'COUNTA',
                  },
                  {
                    path: 'query.xAxis',
                    value: fields[0].id,
                  },
                ];
                paths.push(...changePaths);
                updateStorageByPath(paths);
              }}
            />
          </FormLabel>

          {tableId && (
            <div className="flex size-full flex-col gap-2">
              <FormLabel label={t('chartV2.form.label.dataRange')}>
                <ViewSelect
                  value={viewId}
                  onChange={(value) => {
                    updateStorageByPath('query.viewId', value);
                  }}
                  tableId={tableId}
                />
              </FormLabel>
            </div>
          )}

          <FilterButton />

          <Separator className="my-2" />

          <AxisConfig />
        </TabsContent>

        <TabsContent value={DataSource.Sql} className="flex flex-col gap-2">
          <SqlButton />
          <ColumnConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
};
