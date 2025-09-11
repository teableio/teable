/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  duplicatePluginPanelInstalledPlugin,
  PluginPosition,
  removePluginPanelPlugin,
  renamePluginPanelPlugin,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useTablePermission } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PluginContent } from '@/features/app/components/plugin/PluginContent';
import { PluginHeader } from '@/features/app/components/plugin/PluginHeader';
import { useIsExpandPlugin } from '@/features/app/dashboard/hooks/useIsExpandPlugin';

export const PluginItem = (props: {
  tableId: string;
  pluginPanelId: string;
  pluginId: string;
  pluginName: string;
  pluginInstallId: string;
  pluginUrl?: string;
  isDragging: boolean;
}) => {
  const { tableId, pluginPanelId, pluginId, pluginInstallId, pluginName, pluginUrl, isDragging } =
    props;

  const baseId = useBaseId()!;
  const tablePermissions = useTablePermission();
  const canManage = tablePermissions?.['table|update'];
  const router = useRouter();
  const queryClient = useQueryClient();
  const isExpandPlugin = useIsExpandPlugin();
  const { t } = useTranslation(['common']);

  const { mutate: removePluginMutate } = useMutation({
    mutationFn: () => removePluginPanelPlugin(tableId, pluginPanelId, pluginInstallId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanel(tableId, pluginPanelId));
    },
  });

  const { mutate: renamePluginMutate } = useMutation({
    mutationFn: (name: string) =>
      renamePluginPanelPlugin(tableId, pluginPanelId, pluginInstallId, name),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanel(tableId, pluginPanelId));
    },
  });

  const { mutate: duplicatePluginMutate } = useMutation({
    mutationFn: (name: string) =>
      duplicatePluginPanelInstalledPlugin(tableId, pluginPanelId, pluginInstallId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanel(tableId, pluginPanelId));
    },
  });

  const onCopy = useCallback(async () => {
    await duplicatePluginMutate(`${pluginName} ${t('common:noun.copy')}`);
  }, [duplicatePluginMutate, pluginName, t]);

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
        'fixed top-0 left-0 right-0 bottom-0 bg-black/20 flex items-center justify-center z-10':
          isExpanded,
      })}
      onClick={onClose}
    >
      <div
        className={cn(
          'group flex h-full flex-col overflow-hidden rounded-xl border bg-background',
          {
            'md:w-[90%] h-[90%] w-full mx-4': isExpanded,
            'pointer-events-none select-none': isDragging,
          }
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <PluginHeader
          name={pluginName}
          onDelete={removePluginMutate}
          onNameChange={renamePluginMutate}
          onExpand={onExpand}
          onClose={onClose}
          isExpanded={isExpanded}
          canManage={canManage}
          draggableHandleClassName="plugin-panel-draggable-handle"
          dragging={isDragging}
          onCopy={onCopy}
        />
        <PluginContent
          baseId={baseId}
          dragging={isDragging}
          positionType={PluginPosition.Panel}
          pluginId={pluginId}
          pluginUrl={pluginUrl}
          tableId={tableId}
          pluginInstallId={pluginInstallId}
          positionId={pluginPanelId}
          onExpand={onExpand}
        />
      </div>
    </div>
  );
};
