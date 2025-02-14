import { LocalStorageKeys } from '@teable/sdk/config';
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

export const useFloatPluginPosition = (pluginId: string) => {
  const [pluginsPosition, setPluginsPosition] = useLocalStorage<IFloatPluginsPosition>(
    LocalStorageKeys.FloatPluginPosition,
    {}
  );

  const defaultPosition = useMemo(() => {
    const body = document.body;
    const width = body.clientWidth;
    const height = body.clientHeight;
    return {
      x: width / 2 - DEFAULT_FLOAT_PLUGIN_WIDTH / 2,
      y: height / 2 - DEFAULT_FLOAT_PLUGIN_HEIGHT / 2,
      width: DEFAULT_FLOAT_PLUGIN_WIDTH,
      height: DEFAULT_FLOAT_PLUGIN_HEIGHT,
    };
  }, []);

  const updatePosition = useCallback(
    (position: IFloatPluginPosition) => {
      setPluginsPosition({
        ...pluginsPosition,
        [pluginId]: position,
      });
      return position;
    },
    [pluginId, pluginsPosition, setPluginsPosition]
  );

  return {
    position: pluginsPosition?.[pluginId] ?? defaultPosition,
    updatePosition,
  };
};
