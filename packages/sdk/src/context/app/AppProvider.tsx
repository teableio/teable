import { ThemeProvider } from '@teable/next-themes';
import { isObject, merge } from 'lodash';
import { useMemo } from 'react';
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
  dehydratedState?: unknown;
  disabledWs?: boolean;
}

export const AppProvider = (props: IAppProviderProps) => {
  const { forcedTheme, children, wsPath, lang, locale, disabledWs, dehydratedState } = props;
  const value = useMemo(() => {
    return {
      lang,
      locale: isObject(locale) ? merge(defaultLocale, locale) : defaultLocale,
    };
  }, [lang, locale]);

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
