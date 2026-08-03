import { useQuery } from '@tanstack/react-query';
import { getPluginContextMenu } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useEffect, useRef } from 'react';
import { FloatPlugin } from './components/FloatPlugin';
import { useActiveMenuPluginStore } from './useActiveMenuPlugin';

export const PluginContextMenu = (props: { tableId: string; baseId: string }) => {
  const { tableId, baseId } = props;
  const { activePluginId, setActivePluginId } = useActiveMenuPluginStore();
  const preTableId = useRef(tableId);

  const isTableChanged = tableId !== preTableId.current;

  useEffect(() => {
    if (preTableId.current && tableId && preTableId.current !== tableId) {
      setActivePluginId(null);
      preTableId.current = tableId;
    }
  }, [setActivePluginId, tableId]);

  const { data: plugin } = useQuery({
    queryKey: ReactQueryKeys.getPluginContextMenuPlugin(tableId!, activePluginId!),
    queryFn: ({ queryKey }) =>
      getPluginContextMenu(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: !!tableId && !!activePluginId && !isTableChanged,
  });

  if (!baseId || !tableId || !activePluginId || !plugin || isTableChanged) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onMouseDown={(e) => e.stopPropagation()}>
      <FloatPlugin
        name={plugin?.name}
        tableId={tableId}
        positionId={plugin.positionId}
        pluginId={activePluginId}
        pluginInstallId={activePluginId}
        pluginUrl={plugin?.url}
        onClose={() => setActivePluginId(null)}
      />
    </div>
  );
};
