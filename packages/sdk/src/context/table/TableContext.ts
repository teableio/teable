import React from 'react';

export const TableContext = React.createContext<{
  tableId: string;
}>(null!);
