/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import React from 'react';
import type { Connection } from 'sharedb/lib/client';

export const ConnectionContext = React.createContext<{
  connection?: Connection;
  connected: boolean;
}>(null!);
