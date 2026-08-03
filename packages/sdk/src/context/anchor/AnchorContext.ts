import React from 'react';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AnchorContext = React.createContext<{
  baseId?: string;
  tableId?: string;
  viewId?: string;
}>({});
