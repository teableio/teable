import React from 'react';

export const RecordContext = React.createContext<{
  rowCount: number;
}>(null!);
