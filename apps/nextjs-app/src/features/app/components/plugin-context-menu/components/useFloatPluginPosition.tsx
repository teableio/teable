import { useQuery } from '@tanstack/react-query';
import { getPluginContextMenu, PluginPosition } from '@teable/openapi';
import { LocalStorageKeys, ReactQueryKeys } from '@teable/sdk/config';
import { useCallback, useMemo } from 'react';
import { useLocalStorage } from 'react-use';

const DEFAULT_FLOAT_PLUGIN_WIDTH = 320;
const DEFAULT_FLOAT_PLUGIN_HEIGHT = 200;

interface IFloatPluginPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IFloatPluginsPosition {
  [key: string]: IFloatPluginPosition;
}

export const useFloatPluginPosition = (tableId: string, pluginInstallId: string) => {
  const [pluginsPosition, setPluginsPosition] = useLocalStorage<IFloatPluginsPosition>(
    LocalStorageKeys.MenuPluginPosition,
    {}
  );

  const { data: plugin } = useQuery({
    queryKey: ReactQueryKeys.getPluginContextMenuPlugin(tableId, pluginInstallId),
    queryFn: ({ queryKey }) =>
      getPluginContextMenu(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const config = plugin?.config?.[PluginPosition.ContextMenu];

  const defaultPosition = useMemo(() => {
    const body = document.body;
    const width = body.clientWidth;
    const height = body.clientHeight;
    return {
      x: (config?.x ?? width / 2 - DEFAULT_FLOAT_PLUGIN_WIDTH / 2) as number,
      y: (config?.y ?? height / 2 - DEFAULT_FLOAT_PLUGIN_HEIGHT / 2) as number,
      width: (config?.width ?? DEFAULT_FLOAT_PLUGIN_WIDTH) as number,
      height: (config?.height ?? DEFAULT_FLOAT_PLUGIN_HEIGHT) as number,
    };
  }, [config]);

  const updatePosition = useCallback(
    (position: IFloatPluginPosition) => {
      setPluginsPosition({
        ...pluginsPosition,
        [pluginInstallId]: position,
      });
      return position;
    },
    [pluginInstallId, pluginsPosition, setPluginsPosition]
  );

  return {
    position: pluginsPosition?.[pluginInstallId] ?? defaultPosition,
    updatePosition,
    frozenResize: config?.frozenResize,
    frozenDrag: config?.frozenDrag,
  };
};
