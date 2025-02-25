import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IPluginPanelInstallRo } from '@teable/openapi';
import { installPluginPanel, PluginPosition } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { PluginCenterDialog } from '@/features/app/components/plugin/PluginCenterDialog';
import { useActivePluginPanelId } from '../hooks/useActivePluginPanelId';

export const CreatePluginDialog = ({
  tableId,
  children,
}: {
  tableId: string;
  children: React.ReactNode;
}) => {
  const activePluginPanelId = useActivePluginPanelId(tableId)!;
  const queryClient = useQueryClient();
  const { mutate: installPlugin } = useMutation({
    mutationFn: (ro: IPluginPanelInstallRo) => installPluginPanel(tableId, activePluginPanelId, ro),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getPluginPanel(tableId, activePluginPanelId),
      });
    },
  });

  return (
    <PluginCenterDialog
      positionType={PluginPosition.Panel}
      onInstall={(pluginId, name) => {
        installPlugin({
          pluginId,
          name,
        });
      }}
    >
      {children}
    </PluginCenterDialog>
  );
};
