import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPluginPanelUpdateLayoutRo } from '@teable/openapi';
import { getPluginPanel, updatePluginPanelLayout } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTablePermission } from '@teable/sdk/hooks';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { tableConfig } from '@/features/i18n/table.config';
import { useIsExpandPlugin } from '../../dashboard/hooks/useIsExpandPlugin';
import { CreatePluginDialog } from './components/CreatePluginDialog';
import { PluginItem } from './components/PluginItem';
import { useActivePluginPanelId } from './hooks/useActivePluginPanelId';

const ResponsiveGridLayout = WidthProvider(Responsive);

export const PluginLayout = ({ tableId }: { tableId: string }) => {
  const activePluginPanelId = useActivePluginPanelId(tableId)!;
  const isExpandPlugin = useIsExpandPlugin();
  const [isDragging, setIsDragging] = useState(false);
  const tablePermissions = useTablePermission();
  const canMange = tablePermissions?.['table|update'];
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const queryClient = useQueryClient();

  const { mutate: updateLayoutMutate } = useMutation({
    mutationFn: (layout: IPluginPanelUpdateLayoutRo) =>
      updatePluginPanelLayout(tableId, activePluginPanelId, layout),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanel(tableId, activePluginPanelId));
    },
  });

  const onLayoutChange = (layout: ReactGridLayout.Layout[]) => {
    updateLayoutMutate({
      layout: layout.map(({ i, x, y, w, h }) => ({
        pluginInstallId: i,
        x,
        y,
        w,
        h,
      })),
    });
  };

  const { data: pluginPanel } = useQuery({
    queryKey: ReactQueryKeys.getPluginPanel(tableId, activePluginPanelId!),
    queryFn: () => getPluginPanel(tableId, activePluginPanelId).then((res) => res.data),
  });

  if (!pluginPanel?.layout?.length) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <CreatePluginDialog tableId={tableId}>
          <Button size={'sm'}>{t('table:addPlugin')}</Button>
        </CreatePluginDialog>
      </div>
    );
  }

  const { layout, pluginMap } = pluginPanel;

  return (
    <ResponsiveGridLayout
      className="w-full"
      layouts={{
        md: layout.map(({ pluginInstallId, x, y, w, h }) => ({
          i: pluginInstallId,
          x,
          y,
          w,
          h,
        })),
      }}
      rowHeight={80}
      containerPadding={[8, 8]}
      cols={{ lg: 1, md: 1, sm: 1, xs: 1, xxs: 1 }}
      draggableHandle=".plugin-panel-draggable-handle"
      onResize={() => setIsDragging(true)}
      onResizeStop={(layout) => {
        setIsDragging(false);
        onLayoutChange(layout);
      }}
      onDrag={() => setIsDragging(true)}
      onDragStop={(layout) => {
        setIsDragging(false);
        onLayoutChange(layout);
      }}
      isResizable={canMange}
      isDraggable={canMange}
    >
      {layout.map(({ pluginInstallId, x, y, w, h }) => {
        const plugin = pluginMap?.[pluginInstallId];
        return (
          <div
            key={pluginInstallId}
            data-grid={{ x, y, w, h }}
            className={cn({
              '!transform-none !transition-none': isExpandPlugin(pluginInstallId),
            })}
          >
            {plugin ? (
              <PluginItem
                tableId={tableId}
                pluginPanelId={activePluginPanelId}
                pluginId={plugin.id}
                pluginInstallId={pluginInstallId}
                pluginName={plugin.name}
                pluginUrl={plugin.url}
                isDragging={isDragging}
              />
            ) : (
              <div>{t('common:pluginCenter.pluginNotFound')}</div>
            )}
          </div>
        );
      })}
    </ResponsiveGridLayout>
  );
};
