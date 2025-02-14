import { PluginPosition, type IShareViewPlugin } from '@teable/openapi';
import { useView } from '@teable/sdk/hooks';
import type { PluginView as PluginViewInstance } from '@teable/sdk/model/view/plugin.view';
import { PluginContent } from '@/features/app/components/plugin/PluginContent';

export const PluginView = (props: { shareId: string; plugin?: IShareViewPlugin }) => {
  const { shareId, plugin } = props;
  const view = useView();

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
      shareId={shareId}
      positionType={PluginPosition.View}
    />
  );
};
