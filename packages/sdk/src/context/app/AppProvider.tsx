import type { DehydratedState } from '@tanstack/react-query';
import { ThemeProvider } from '@teable/next-themes';
import type { IGetBaseVo } from '@teable/openapi';
import { isObject, merge } from 'lodash';
import { useMemo } from 'react';
import { isRtlLang, setContentDirectionEnabled } from '../../utils/text-direction';
import { AppContext } from '../app/AppContext';
import { ConnectionProvider } from './ConnectionProvider';
import type { ILocalePartial } from './i18n';
import { defaultLocale } from './i18n';
import { QueryClientProvider } from './QueryClientProvider';

interface IAppProviderProps {
  forcedTheme?: string;
  children: React.ReactNode;
  wsPath?: string;
  lang?: string;
  locale?: ILocalePartial;
  dehydratedState?: DehydratedState;
  disabledWs?: boolean;
  template?: IGetBaseVo['template'];
  shareId?: string;
  maxSearchFieldCount?: number;
}

export const AppProvider = (props: IAppProviderProps) => {
  const {
    forcedTheme,
    children,
    wsPath,
    lang,
    locale,
    disabledWs,
    dehydratedState,
    template,
    shareId,
    maxSearchFieldCount,
  } = props;
  // Canvas renderers read the gate from a module-level flag rather than from
  // context, so it has to be in place before children paint — an effect would
  // land a frame too late. Guarded to the client because the module is shared
  // across requests during SSR.
  if (typeof window !== 'undefined') {
    setContentDirectionEnabled(isRtlLang(lang));
  }

  const value = useMemo(
    () => ({
      lang,
      locale: isObject(locale) ? merge(defaultLocale, locale) : defaultLocale,
      template,
      shareId,
      maxSearchFieldCount,
    }),
    [lang, locale, template, shareId, maxSearchFieldCount]
  );

  if (disabledWs) {
    return (
      <ThemeProvider attribute="class" forcedTheme={forcedTheme}>
        <AppContext.Provider value={value}>
          <QueryClientProvider dehydratedState={dehydratedState}>{children}</QueryClientProvider>
        </AppContext.Provider>
      </ThemeProvider>
    );
  }

  // forcedTheme is not work as expected https://github.com/pacocoursey/next-themes/issues/252
  return (
    <ThemeProvider attribute="class" forcedTheme={forcedTheme}>
      <AppContext.Provider value={value}>
        <ConnectionProvider wsPath={wsPath}>
          <QueryClientProvider dehydratedState={dehydratedState}>{children}</QueryClientProvider>
        </ConnectionProvider>
      </AppContext.Provider>
    </ThemeProvider>
  );
};
