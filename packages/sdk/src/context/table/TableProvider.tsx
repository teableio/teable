import type { ITableVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { FC, ReactNode } from 'react';
import { useMemo } from 'react';
import { createTableInstance } from '../../model';
import { useInstances } from '../use-instances';
import { TableContext } from './TableContext';

interface ITableProviderProps {
  tableId?: string;
  viewId?: string;
  serverData?: ITableVo[];
  children: ReactNode;
}

export const TableProvider: FC<ITableProviderProps> = ({
  tableId,
  viewId,
  children,
  serverData,
}) => {
  const tables = useInstances({
    collection: `${IdPrefix.Table}_node`,
    factory: createTableInstance,
    initData: serverData ? serverData.map((d) => ({ table: d })) : undefined,
    queryParams: {},
  });

  const value = useMemo(() => {
    return { tableId, viewId, tables };
  }, [tableId, viewId, tables]);

  return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
};
