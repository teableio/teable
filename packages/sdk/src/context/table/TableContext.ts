import React from 'react';
import type { Table } from '../../model';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TableContext = React.createContext<{
  tables: Table[];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
}>(null!);
