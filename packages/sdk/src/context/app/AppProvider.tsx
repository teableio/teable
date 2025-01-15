import { Hydrate, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@teable/next-themes';
import { isObject, merge } from 'lodash';
import { useMemo, useState } from 'react';
import { AppContext } from '../app/AppContext';
import { ConnectionProvider } from './ConnectionProvider';
import type { ILocalePartial } from './i18n';
import { defaultLocale } from './i18n';
import { createQueryClient } from './queryClient';

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
  const { forcedTheme, children, wsPath, lang, locale, dehydratedState, disabledWs } = props;
  const [queryClient] = useState(() => createQueryClient());
  const value = useMemo(() => {
    return {
      lang,
      locale: isObject(locale) ? merge(defaultLocale, locale) : defaultLocale,
    };
  }, [lang, locale]);

  if (disabledWs) {
    <ThemeProvider attribute="class" forcedTheme={forcedTheme}>
      <AppContext.Provider value={value}>
        <QueryClientProvider client={queryClient}>
          <Hydrate state={dehydratedState}>{children}</Hydrate>
        </QueryClientProvider>
      </AppContext.Provider>
    </ThemeProvider>;
  }

  // forcedTheme is not work as expected https://github.com/pacocoursey/next-themes/issues/252
  return (
    <ThemeProvider attribute="class" forcedTheme={forcedTheme}>
      <AppContext.Provider value={value}>
        <ConnectionProvider wsPath={wsPath}>
          <QueryClientProvider client={queryClient}>
            <Hydrate state={dehydratedState}>{children}</Hydrate>
          </QueryClientProvider>
        </ConnectionProvider>
      </AppContext.Provider>
    </ThemeProvider>
  );
};
