import React from 'react';
import { Record } from '../../model';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const RecordContext = React.createContext<{
  rowCount: number;
}>(null!);
