import { useQuery } from '@tanstack/react-query';
import { listPluginPanels } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Resizable } from 're-resizable';
import { usePluginPanelStorage } from './hooks/usePluginPanelStorage';
import { DEFAULT_PLUGIN_PANEL_WIDTH } from './hooks/usePluginPanelStore';
import { PluginLayout } from './PluginLayout';
import { PluginPanelEmpty } from './PluginPanelEmpty';
import { PluginPanelHeader } from './PluginPanelHeader';

export const PluginPanelContainer = ({ tableId }: { tableId: string }) => {
  const { width, updateWidth } = usePluginPanelStorage(tableId);
  const { data: pluginPanels } = useQuery({
    queryKey: ReactQueryKeys.getPluginPanelList(tableId),
    queryFn: ({ queryKey }) => listPluginPanels(queryKey[1]).then((res) => res.data),
  });

  return (
    <Resizable
      className="ml-1 bg-background px-1"
      size={{ width, height: '100%' }}
      defaultSize={{ width: DEFAULT_PLUGIN_PANEL_WIDTH, height: '100%' }}
      maxWidth={'60%'}
      minWidth={'300px'}
      enable={{
        left: true,
      }}
      onResizeStop={(_e, _direction, ref) => {
        updateWidth(ref.style.width);
      }}
      handleClasses={{
        left: 'group',
      }}
      handleStyles={{
        left: {
          width: '4px',
          left: '0',
        },
      }}
      handleComponent={{
        // eslint-disable-next-line tailwindcss/no-unnecessary-arbitrary-value
        left: (
          <div className="h-full w-px bg-border group-hover:px-[1.5px] group-active:px-[1.5px]"></div>
        ),
      }}
    >
      {pluginPanels?.length ? (
        <div className="flex h-full flex-col">
          <PluginPanelHeader tableId={tableId} />
          <PluginLayout tableId={tableId} />
        </div>
      ) : (
        <PluginPanelEmpty tableId={tableId} />
      )}
    </Resizable>
  );
};
