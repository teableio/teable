import type { Connection, UndoManager } from '@teable/sharedb/lib/client';
import React from 'react';

export enum ThemeKey {
  Light = 'light',
  Dark = 'dark',
}

export interface IAppContext {
  connection?: Connection;
  connected: boolean;
  theme: ThemeKey;
  undoManager?: UndoManager;
  isAutoTheme: boolean;
  setTheme: (theme: ThemeKey | null) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
export const AppContext = React.createContext<IAppContext>(null!);
