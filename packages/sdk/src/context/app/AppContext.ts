import React from 'react';
import { Connection } from 'sharedb/lib/client';

export enum ThemeKey {
  Light = 'light',
  Dark = 'dark',
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AppContext = React.createContext<{
  connection: Connection;
  theme: ThemeKey;
  isAutoTheme: boolean;
  setTheme: (theme: ThemeKey | null) => void;
}>(null!);
