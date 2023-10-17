import type { DriverClient } from '@teable-group/core';
import React from 'react';
import type { Connection } from 'sharedb/lib/client';

export enum ThemeKey {
  Light = 'light',
  Dark = 'dark',
}

export interface IAppContext {
  connection?: Connection;
  driver: DriverClient;
  connected: boolean;
  theme: ThemeKey;
  isAutoTheme: boolean;
  setTheme: (theme: ThemeKey | null) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
export const AppContext = React.createContext<IAppContext>(null!);
