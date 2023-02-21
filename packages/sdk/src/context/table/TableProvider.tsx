import { FC, ReactNode } from 'react';
import { TableContext } from './TableContext';

interface ITableProviderProps {
  tableId: string;
  viewId?: string;
  fallback: ReactNode;
  children: ReactNode;
}

export const TableProvider: FC<ITableProviderProps> = ({ tableId, children, fallback }) => {
  if (fallback && !tableId) {
    return <>{fallback}</>;
  }

  return (
    <TableContext.Provider
      value={{
        tableId,
      }}
    >
      {children}
    </TableContext.Provider>
  );
};
