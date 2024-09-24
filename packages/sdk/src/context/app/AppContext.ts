import React from 'react';
import type { ILocale } from './i18n';

export interface IAppContext {
  locale: ILocale;
  lang?: string;
  shareId?: string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
export const AppContext = React.createContext<IAppContext>(null!);
