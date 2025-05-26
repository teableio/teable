/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  duplicateDashboardInstalledPlugin,
  PluginPosition,
  removePlugin,
  renamePlugin,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { PluginContent } from '../../components/plugin/PluginContent';
import { PluginHeader } from '../../components/plugin/PluginHeader';
import { useIsExpandPlugin } from '../hooks/useIsExpandPlugin';

export const PluginItem = (props: {
  name: string;
  pluginId: string;
  dragging?: boolean;
  pluginUrl?: string;
  dashboardId: string;
  pluginInstallId: string;
}) => {
  const baseId = useBaseId()!;
  const { t } = useTranslation(['common']);
  const { pluginInstallId, dashboardId, dragging, pluginId, name, pluginUrl } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const isExpandPlugin = useIsExpandPlugin();
  const basePermissions = useBasePermission();
  const canManage = basePermissions?.['base|update'];

  const { mutate: removePluginMutate } = useMutation({
    mutationFn: () => removePlugin(baseId, dashboardId, pluginInstallId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(dashboardId));
    },
  });

  const { mutate: renamePluginMutate } = useMutation({
    mutationFn: (name: string) => renamePlugin(baseId, dashboardId, pluginInstallId, name),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(dashboardId));
    },
  });

  const { mutate: duplicateDashboardInstalledPluginFn } = useMutation({
    mutationFn: () =>
      duplicateDashboardInstalledPlugin(baseId, dashboardId, pluginInstallId, {
        name: `${name} ${t('common:noun.copy')}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(dashboardId));
    },
  });

  const onExpand = useCallback(() => {
    const query = { ...router.query, expandPluginId: pluginInstallId };
    router.push(
      {
        pathname: router.pathname,
        query,
      },
      undefined,
      { shallow: true }
    );
  }, [pluginInstallId, router]);

  const onCopy = useCallback(() => {
    duplicateDashboardInstalledPluginFn();
  }, [duplicateDashboardInstalledPluginFn]);

  const onClose = () => {
    const query = { ...router.query };
    delete query.expandPluginId;
    router.push(
      {
        pathname: router.pathname,
        query,
      },
      undefined,
      { shallow: true }
    );
  };

  const isExpanded = isExpandPlugin(pluginInstallId);

  return (
    <div
      className={cn('h-full', {
        'fixed top-0 left-0 right-0 bottom-0 bg-black/20 flex items-center justify-center z-50':
          isExpanded,
      })}
      onClick={onClose}
    >
      <div
        className={cn(
          'group flex h-full flex-col overflow-hidden rounded-xl border bg-background',
          {
            'md:w-[90%] h-[90%] w-full mx-4': isExpanded,
            'pointer-events-none select-none': dragging,
          }
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <PluginHeader
          dragging={dragging}
          draggableHandleClassName="dashboard-draggable-handle"
          name={name}
          onDelete={removePluginMutate}
          onNameChange={renamePluginMutate}
          onExpand={onExpand}
          onClose={onClose}
          isExpanded={isExpanded}
          canManage={canManage}
          onCopy={onCopy}
        />
        <PluginContent
          baseId={baseId}
          dragging={dragging}
          pluginId={pluginId}
          pluginInstallId={pluginInstallId}
          pluginUrl={pluginUrl}
          positionId={dashboardId}
          onExpand={onExpand}
          renderClassName="p-1"
          positionType={PluginPosition.Dashboard}
        />
      </div>
    </div>
  );
};
