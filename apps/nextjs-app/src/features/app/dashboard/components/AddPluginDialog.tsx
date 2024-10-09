import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IDashboardInstallPluginRo } from '@teable/openapi';
import { installPlugin, PluginPosition } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { useRef } from 'react';
import type { IPluginCenterDialogRef } from '../../components/plugin/PluginCenterDialog';
import { PluginCenterDialog } from '../../components/plugin/PluginCenterDialog';

export const AddPluginDialog = (props: { children?: React.ReactNode; dashboardId: string }) => {
  const { children, dashboardId } = props;
  const baseId = useBaseId()!;
  const queryClient = useQueryClient();
  const ref = useRef<IPluginCenterDialogRef>(null);

  const { mutate: installPluginMutate } = useMutation({
    mutationFn: (ro: IDashboardInstallPluginRo) => installPlugin(baseId, dashboardId, ro),
    onSuccess: () => {
      ref.current?.close();
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(dashboardId));
    },
  });

  return (
    <PluginCenterDialog
      ref={ref}
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
