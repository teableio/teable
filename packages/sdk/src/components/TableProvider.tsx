import type { FC, ReactNode } from 'react';
import { TableContext } from '@/context/table';

interface IProps {
  tableId: string;
  children: ReactNode;
}

export const TableProvider: FC<IProps> = (props) => {
  return <TableContext.Provider value={null}>{props.children}</TableContext.Provider>;
};
