import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IDashboardInstallPluginRo } from '@teable/openapi';
import { installPlugin, PluginPosition } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { PluginCenterDialog } from '../../components/plugin/PluginCenterDialog';

export const AddPluginDialog = (props: { children?: React.ReactNode; dashboardId: string }) => {
  const { children, dashboardId } = props;
  const baseId = useBaseId()!;
  const queryClient = useQueryClient();

  const { mutate: installPluginMutate } = useMutation({
    mutationFn: (ro: IDashboardInstallPluginRo) => installPlugin(baseId, dashboardId, ro),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(dashboardId));
    },
  });

  return (
    <PluginCenterDialog
      positionType={PluginPosition.Dashboard}
      onInstall={(id, name) =>
        installPluginMutate({
          pluginId: id,
          name,
        })
      }
    >
      {children}
    </PluginCenterDialog>
  );
};
