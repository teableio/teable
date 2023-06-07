import React from 'react';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AnchorContext = React.createContext<{
  tableId?: string;
  viewId?: string;
}>({});
