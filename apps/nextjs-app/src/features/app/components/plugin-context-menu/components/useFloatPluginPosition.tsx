import { useQuery } from '@tanstack/react-query';
import { getPluginContextMenu, PluginPosition } from '@teable/openapi';
import { LocalStorageKeys, ReactQueryKeys } from '@teable/sdk/config';
import { useCallback, useMemo } from 'react';
import { useLocalStorage } from 'react-use';
import { isPercentage, pixelToPercent } from './utils/position';

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
    const viewportWidth = body.clientWidth;
    const viewportHeight = body.clientHeight;

    // Helper to normalize config value to 0-1 percentage
    const normalizeValue = (
      value: number | string | undefined,
      defaultPixel: number,
      viewportSize: number
    ): number => {
      if (value === undefined) {
        return pixelToPercent(defaultPixel, viewportSize);
      }
      // Handle percentage strings like "50%"
      if (typeof value === 'string' && value.endsWith('%')) {
        return parseFloat(value) / 100;
      }
      const numValue = value as number;
      // If already 0-1, keep it; if >1, convert to percentage
      return isPercentage(numValue) ? numValue : pixelToPercent(numValue, viewportSize);
    };

    return {
      x: normalizeValue(
        config?.x,
        viewportWidth / 2 - DEFAULT_FLOAT_PLUGIN_WIDTH / 2,
        viewportWidth
      ),
      y: normalizeValue(
        config?.y,
        viewportHeight / 2 - DEFAULT_FLOAT_PLUGIN_HEIGHT / 2,
        viewportHeight
      ),
      width: normalizeValue(config?.width, DEFAULT_FLOAT_PLUGIN_WIDTH, viewportWidth),
      height: normalizeValue(config?.height, DEFAULT_FLOAT_PLUGIN_HEIGHT, viewportHeight),
    };
  }, [config]);

  const updatePosition = useCallback(
    (position: IFloatPluginPosition) => {
      const body = document.body;
      const viewportWidth = body.clientWidth;
      const viewportHeight = body.clientHeight;

      // Always save as 0-1 percentages
      const normalizedPosition: IFloatPluginPosition = {
        x: isPercentage(position.x) ? position.x : pixelToPercent(position.x, viewportWidth),
        y: isPercentage(position.y) ? position.y : pixelToPercent(position.y, viewportHeight),
        width: isPercentage(position.width)
          ? position.width
          : pixelToPercent(position.width, viewportWidth),
        height: isPercentage(position.height)
          ? position.height
          : pixelToPercent(position.height, viewportHeight),
      };

      setPluginsPosition({
        ...pluginsPosition,
        [pluginInstallId]: normalizedPosition,
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
