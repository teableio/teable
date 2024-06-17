import { Hydrate, QueryClientProvider } from '@tanstack/react-query';
import { isObject, merge } from 'lodash';
import { useEffect, useMemo } from 'react';
import { AppContext } from '../app/AppContext';
import type { ILocalePartial } from './i18n';
import { defaultLocale } from './i18n';
import { createQueryClient } from './queryClient';
import { useConnection } from './useConnection';
import { useTheme } from './useTheme';

const queryClient = createQueryClient();

interface IAppProviderProps {
  children: React.ReactNode;
  wsPath?: string;
  lang?: string;
  locale?: ILocalePartial;
  dehydratedState?: unknown;
}

export const AppProvider = (props: IAppProviderProps) => {
  const { children, wsPath, lang, locale, dehydratedState } = props;

  const { connected, connection } = useConnection(wsPath);
  const themeProps = useTheme();

  useEffect(() => {
    if (!connection) {
      return;
    }
  }, [connection]);

  const value = useMemo(() => {
    return {
      connection,
      connected,
      lang,
      locale: isObject(locale) ? merge(defaultLocale, locale) : defaultLocale,
      ...themeProps,
    };
  }, [connection, connected, lang, locale, themeProps]);

  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <Hydrate state={dehydratedState}>{children}</Hydrate>
      </QueryClientProvider>
    </AppContext.Provider>
  );
};
