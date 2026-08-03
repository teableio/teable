import { useCallback, useMemo } from 'react';
import { DEFAULT_PLUGIN_PANEL_WIDTH, usePluginPanelStore } from './usePluginPanelStore';

export const usePluginPanelStorage = (tableId: string) => {
  const {
    tables,
    toggleVisible: _toggleVisible,
    updateWidth: _updateWidth,
    touchActivePanel: _touchActivePanel,
  } = usePluginPanelStore();

  const updateWidth = useCallback(
    (width: string) => {
      _updateWidth(tableId, width);
    },
    [tableId, _updateWidth]
  );

  const toggleVisible = useCallback(() => {
    _toggleVisible(tableId);
  }, [tableId, _toggleVisible]);

  const touchActivePanel = useCallback(
    (panelId: string) => {
      _touchActivePanel(tableId, panelId);
    },
    [tableId, _touchActivePanel]
  );

  const table = tables[tableId];
  const isVisible = table?.isVisible ?? false;
  const width = table?.width ?? DEFAULT_PLUGIN_PANEL_WIDTH;

  return useMemo(() => {
    return {
      isVisible,
      width,
      toggleVisible,
      updateWidth,
      touchActivePanel,
    };
  }, [isVisible, width, toggleVisible, updateWidth, touchActivePanel]);
};
