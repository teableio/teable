import { Hydrate, QueryClientProvider } from '@tanstack/react-query';
import { isObject } from 'lodash';
import { useEffect, useMemo } from 'react';
import { getDriver } from '../../utils/driver';
import { AppContext } from '../app/AppContext';
import type { ILocale, ILocalePartial } from './i18n';
import { defaultLocale } from './i18n';
import { createQueryClient } from './queryClient';
import { useConnection } from './useConnection';
import { useTheme } from './useTheme';

const queryClient = createQueryClient();

interface IAppProviderProps {
  children: React.ReactNode;
  wsPath?: string;
  locale?: ILocalePartial;
  dehydratedState?: unknown;
}

export const AppProvider = (props: IAppProviderProps) => {
  const { children, wsPath, locale, dehydratedState } = props;

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
      driver: getDriver(),
      locale: isObject(locale) ? ({ ...defaultLocale, ...locale } as ILocale) : defaultLocale,
      ...themeProps,
    };
  }, [connection, connected, locale, themeProps]);

  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <Hydrate state={dehydratedState}>{children}</Hydrate>
      </QueryClientProvider>
    </AppContext.Provider>
  );
};
