import { useQuery } from '@tanstack/react-query';
import { getViewInstallPlugin } from '@teable/openapi';
import { useTableId, useView } from '@teable/sdk/hooks';
import type { PluginView as PluginViewInstance } from '@teable/sdk/model/view/plugin.view';
import { PluginContent } from '@/features/app/components/plugin/PluginContent';

export const PluginView = () => {
  const view = useView();
  const tableId = useTableId();

  const { data: plugin } = useQuery({
    queryKey: ['plugin-view', tableId!, view!.id] as const,
    enabled: Boolean(view?.id && tableId),
    queryFn: ({ queryKey }) =>
      getViewInstallPlugin(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  if (!view || !plugin) {
    return;
  }

  const { options, id } = view as PluginViewInstance;
  const { pluginId, pluginInstallId } = options;

  return (
    <PluginContent
      pluginId={pluginId}
      pluginInstallId={pluginInstallId}
      positionId={id}
      pluginUrl={plugin.url}
      tableId={tableId}
    />
  );
};
