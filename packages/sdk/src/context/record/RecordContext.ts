import { IRecord } from '@teable-group/core';
import React from 'react';

export const RecordContext = React.createContext<{
  rowCount: number;
  serverRecords?: IRecord[];
}>(null!);
