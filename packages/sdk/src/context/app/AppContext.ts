import type { Connection } from '@teable/sharedb/lib/client';
import React from 'react';
import type { Space } from '../../model/space';

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

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
export const AppContext = React.createContext<IAppContext>(null!);
