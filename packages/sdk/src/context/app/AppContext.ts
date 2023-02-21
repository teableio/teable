import React from 'react';
import { Connection } from 'sharedb/lib/client';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AppContext = React.createContext<{
  connection: Connection;
}>(null!);
