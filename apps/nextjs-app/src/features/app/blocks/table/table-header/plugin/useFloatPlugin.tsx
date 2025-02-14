import { PluginPosition } from '@teable/openapi';
import { LocalStorageKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { useCallback, useMemo } from 'react';
import { useLocalStorage } from 'react-use';

interface IRecentPlugin {
  id: string;
  position: PluginPosition;
  lastAddTimeByUser: {
    [key: string]: number;
  };
}

const MAX_ITEMS = 30;

export const useFloatPlugin = () => {
  const [recentPlugins, setRecentPlugins] = useLocalStorage<IRecentPlugin[]>(
    LocalStorageKeys.RecentPlugins,
    []
  );
  const { user } = useSession();
  const userId = user.id;

  const touchRecentPlugin = useCallback(
    (pluginId: string) => {
      if (!recentPlugins) {
        setRecentPlugins([
          {
            id: pluginId,
            position: PluginPosition.Float,
            lastAddTimeByUser: {
              [userId]: Date.now(),
            },
          },
        ]);
        return;
      }

      const existingPluginIndex = recentPlugins.findIndex((p) => p.id === pluginId);
      if (existingPluginIndex !== -1) {
        recentPlugins.splice(existingPluginIndex, 1);
      }

      const newPlugin: IRecentPlugin = {
        id: pluginId,
        position: PluginPosition.Float,
        lastAddTimeByUser: {
          ...recentPlugins[existingPluginIndex]?.lastAddTimeByUser,
          [userId]: Date.now(),
        },
      };

      recentPlugins.unshift(newPlugin);

      if (recentPlugins.length > MAX_ITEMS) {
        recentPlugins.pop();
      }

      setRecentPlugins(recentPlugins);
    },
    [recentPlugins, setRecentPlugins, userId]
  );

  const sortedRecentPlugins = useMemo(
    () => recentPlugins?.sort((a, b) => b.lastAddTimeByUser[userId] - a.lastAddTimeByUser[userId]),
    [recentPlugins, userId]
  );

  return {
    recentPlugins,
    touchRecentPlugin,
    sortedRecentPlugins,
  };
};
