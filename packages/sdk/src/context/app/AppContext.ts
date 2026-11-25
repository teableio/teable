import type { IGetBaseVo } from '@teable/openapi';
import React from 'react';
import type { ILocale } from './i18n';

export interface IAppContext {
  locale: ILocale;
  lang?: string;
  shareId?: string;
  // The project share the page is opened through. `shareId` alone cannot tell: a view share
  // sets it too, and a link view replaces it with its field id.
  baseShareId?: string;
  template?: IGetBaseVo['template'];
  maxSearchFieldCount?: number;
}

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
export const AppContext = React.createContext<IAppContext>(null!);
