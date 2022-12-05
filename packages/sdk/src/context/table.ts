import React from 'react';
import type { Table } from '@/models/table/table';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TableContext = React.createContext<Table | null>(null);
