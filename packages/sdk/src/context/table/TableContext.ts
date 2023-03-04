import { Table } from '../../model';
import React from 'react';

export const TableContext = React.createContext<{
  tableId?: string;
  activeViewId?: string;
  tables: Table[];
}>(null!);
