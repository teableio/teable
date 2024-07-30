import React from 'react';
import type { Connection } from 'sharedb/lib/client';
import type { ILocale } from './i18n';

export interface IAppContext {
  connection?: Connection;
  connected: boolean;
  locale: ILocale;
  lang?: string;
  shareId?: string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
export const AppContext = React.createContext<IAppContext>(null!);
