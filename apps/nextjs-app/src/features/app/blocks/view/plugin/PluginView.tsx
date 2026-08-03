import { useQuery } from '@tanstack/react-query';
import { getViewInstallPlugin, PluginPosition } from '@teable/openapi';
import { useBaseId, useTableId, useView } from '@teable/sdk/hooks';
import type { PluginView as PluginViewInstance } from '@teable/sdk/model/view/plugin.view';
import { PluginContent } from '@/features/app/components/plugin/PluginContent';

export const PluginView = () => {
  const view = useView();
  const baseId = useBaseId();
  const tableId = useTableId();

  const { data: plugin } = useQuery({
    queryKey: ['plugin-view', tableId!, view!.id] as const,
    enabled: Boolean(view?.id && tableId),
    queryFn: ({ queryKey }) =>
      getViewInstallPlugin(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  if (!baseId || !tableId || !view || !plugin) {
    return;
  }

  const { options, id } = view as PluginViewInstance;
  const { pluginId, pluginInstallId } = options;

  return (
    <PluginContent
      baseId={baseId}
      pluginId={pluginId}
      pluginInstallId={pluginInstallId}
      positionId={id}
      positionType={PluginPosition.View}
      pluginUrl={plugin.url}
      tableId={tableId}
      viewId={view.id}
    />
  );
};
