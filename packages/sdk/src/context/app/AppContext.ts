import { Space } from '../../model/space';
import React from 'react';
import { Connection } from 'sharedb/lib/client';

export enum ThemeKey {
  Light = 'light',
  Dark = 'dark',
}

export interface IAppContext {
  connection?: Connection;
  connected: boolean;
  theme: ThemeKey;
  space?: Space;
  isAutoTheme: boolean;
  setTheme: (theme: ThemeKey | null) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AppContext = React.createContext<IAppContext>(null!);
