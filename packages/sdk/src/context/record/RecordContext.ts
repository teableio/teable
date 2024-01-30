import type { IRecord } from '@teable/core';
import React from 'react';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const RecordContext = React.createContext<{
  serverRecords?: IRecord[];
  serverRecord?: IRecord;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
}>(null!);
