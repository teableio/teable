import { ThemeProvider } from '@teable/next-themes';
import { usePluginBridge, type IUIConfig } from '@teable/sdk';
import React, { useRef } from 'react';
import type { IChartStorage } from './types';

export interface IChartContext {
  tab: 'chart' | 'query';
  storage?: IChartStorage;
  uiConfig?: IUIConfig;
  queryError?: string;
  onQueryError?: (error?: string) => void;
  onTabChange: (tab: 'chart' | 'query') => void;
  onStorageChange: (storage: IChartStorage) => Promise<unknown>;
}

export const ChartContext = React.createContext<IChartContext>({
  tab: 'chart',
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onTabChange: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onStorageChange: (storage: IChartStorage) => Promise.resolve(storage),
});

export const ChartProvider = (props: {
  children: React.ReactNode;
  storage?: IChartStorage;
  uiConfig?: IUIConfig;
}) => {
  const { children, storage, uiConfig } = props;
  const [tab, setTab] = React.useState<'chart' | 'query'>(storage?.query ? 'chart' : 'query');
  const [storageState, setStorageState] = React.useState<IChartStorage | undefined>(storage);
  const [queryError, setQueryError] = React.useState<string | undefined>();
  const preStorage = useRef<IChartStorage | undefined>();
  const pluginBridge = usePluginBridge();

  const updateStorage = async (storage: IChartStorage) => {
    try {
      preStorage.current = storage;
      setStorageState(storage);
      await pluginBridge?.updateStorage(storage as unknown as Record<string, unknown>);
    } catch (error) {
      console.error('Failed to update storage', error);
      setStorageState(preStorage.current);
    }
  };

  return (
    <ThemeProvider attribute="class" forcedTheme={uiConfig?.theme}>
      <ChartContext.Provider
        value={{
          tab,
          uiConfig,
          storage: storageState,
          queryError,
          onTabChange: setTab,
          onQueryError: setQueryError,
          onStorageChange: updateStorage,
        }}
      >
        {children}
      </ChartContext.Provider>
    </ThemeProvider>
  );
};
