import React from 'react';
import type { Table } from '@teable-group/ts-utils';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TableContext = React.createContext<Table | null>(null);
