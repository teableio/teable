import { ChartType, DataSource, type IChartStorage } from '@teable/openapi';
import { produce } from 'immer';
import { set } from 'lodash';
import { useCallback } from 'react';
import { usePluginInstall } from './usePluginInstall';

interface UpdateStorageByPath {
  (path: string, value: unknown): void;
  (updates: Array<{ path: string; value: unknown }>): void;
}

export const useStorage = () => {
  const {
    pluginInstall,
    updatePluginStorage,
    isLoading: isPluginInstallLoading,
  } = usePluginInstall();
  const {
    storage = {
      chartType: ChartType.Bar,
      dataSource: DataSource.Table,
      config: {},
      appearance: {},
    } as IChartStorage,
  } = (pluginInstall || {}) as { storage: IChartStorage };

  const updateStorageByPath = useCallback<UpdateStorageByPath>(
    (pathOrUpdates: string | Array<{ path: string; value: unknown }>, value?: unknown) => {
      const next = produce(storage ?? {}, (draft: IChartStorage) => {
        if (typeof pathOrUpdates === 'string') {
          set(draft, pathOrUpdates, value);
        } else {
          pathOrUpdates.forEach(({ path, value }) => {
            set(draft, path, value);
          });
        }
      });
      updatePluginStorage(next);
    },
    [storage, updatePluginStorage]
  ) as UpdateStorageByPath;

  return {
    storage,
    updateStorageByPath,
    updatePluginStorage,
    isPluginInstallLoading,
  };
};
