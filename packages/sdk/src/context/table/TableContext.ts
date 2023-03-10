import { Table } from '../../model';
import React from 'react';

export const TableContext = React.createContext<{
  tableId?: string;
  viewId?: string;
  tables: Table[];
}>(null!);
