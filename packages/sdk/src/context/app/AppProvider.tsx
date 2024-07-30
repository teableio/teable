import { Hydrate, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@teable/next-themes';
import { isObject, merge } from 'lodash';
import { useMemo } from 'react';
import { AppContext } from '../app/AppContext';
import type { ILocalePartial } from './i18n';
import { defaultLocale } from './i18n';
import { createQueryClient } from './queryClient';
import { useConnection } from './useConnection';

const queryClient = createQueryClient();

interface IAppProviderProps {
  forcedTheme?: string;
  children: React.ReactNode;
  wsPath?: string;
  lang?: string;
  locale?: ILocalePartial;
  dehydratedState?: unknown;
}

export const AppProvider = (props: IAppProviderProps) => {
  const { forcedTheme, children, wsPath, lang, locale, dehydratedState } = props;

  const { connected, connection } = useConnection(wsPath);

  const value = useMemo(() => {
    return {
      connection,
      connected,
      lang,
      locale: isObject(locale) ? merge(defaultLocale, locale) : defaultLocale,
    };
  }, [connection, connected, lang, locale]);

  // forcedTheme is not work as expected https://github.com/pacocoursey/next-themes/issues/252
  return (
    <ThemeProvider attribute="class" forcedTheme={forcedTheme}>
      <AppContext.Provider value={value}>
        <QueryClientProvider client={queryClient}>
          <Hydrate state={dehydratedState}>{children}</Hydrate>
        </QueryClientProvider>
      </AppContext.Provider>
    </ThemeProvider>
  );
};
