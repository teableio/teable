import type { IFieldVo, ITableVo } from '@teable-group/core';
import type { IGetBaseVo } from '@teable-group/openapi';
import { AnchorContext, FieldProvider, useDriver, useTable } from '@teable-group/sdk';
import { useRouter } from 'next/router';
import { useTitle } from 'react-use';
import { DataTable } from './data-table/DataTable';
import { useDataColumns } from './data-table/useDataColumns';

export interface IDesignProps {
  fieldServerData: IFieldVo[];
  baseServerData: IGetBaseVo;
  tableServerData: ITableVo[];
}

export const Design: React.FC<IDesignProps> = ({ fieldServerData: fields }) => {
  const router = useRouter();
  const { tableId } = router.query as { tableId: string };
  const table = useTable() as ITableVo;
  const driver = useDriver();
  useTitle(
    table.name ? `${table.icon ? table.icon + ' ' : ''}${table.name}` : 'Teable' + ' - Designing'
  );

  const columns = useDataColumns();
  const [dbSchemaName, dbTableName] = table.dbTableName.split('.');

  return (
    <AnchorContext.Provider value={{ tableId }}>
      <FieldProvider serverSideData={fields}>
        <div className="flex h-full grow basis-[500px] flex-col">
          <div className="hidden h-full flex-1 flex-col space-y-8 p-8 md:flex">
            <div className="flex items-center justify-between space-y-2">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  Design {table.icon} {table.name} fields
                </h2>
                <p>Here&apos;s a list of all fields in table</p>
                <p>Driver: {driver}</p>
                <p>Database schema name: {dbSchemaName}</p>
                <p>Database table name: {dbTableName}</p>
                <p>Last modified time: {table.lastModifiedTime}</p>
              </div>
            </div>
            <DataTable data={fields} columns={columns} />
          </div>
        </div>
      </FieldProvider>
    </AnchorContext.Provider>
  );
};
