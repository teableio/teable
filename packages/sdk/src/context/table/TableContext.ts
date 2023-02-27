import React from 'react';

export const TableContext = React.createContext<{
  tableId: string;
  activeViewId?: string;
}>(null!);
