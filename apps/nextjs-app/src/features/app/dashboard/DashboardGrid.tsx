import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IDashboardLayout } from '@teable/openapi';
import { getDashboard, updateLayoutDashboard } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { PluginItem } from './components/PluginItem';
import { useIsExpandPlugin } from './hooks/useIsExpandPlugin';

const ResponsiveGridLayout = WidthProvider(Responsive);

export const DashboardGrid = (props: { dashboardId: string }) => {
  const { dashboardId } = props;
  const baseId = useBaseId()!;
  const queryClient = useQueryClient();
  const isExpandPlugin = useIsExpandPlugin();
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const [isDragging, setIsDragging] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(true);
  const basePermissions = useBasePermission();
  const canMange = basePermissions?.['base|update'];
  const { data: dashboardData } = useQuery({
    queryKey: ReactQueryKeys.getDashboard(dashboardId),
    queryFn: () => getDashboard(baseId, dashboardId).then((res) => res.data),
  });

  const { mutate: updateLayoutDashboardMutate } = useMutation({
    mutationFn: (layout: IDashboardLayout) => updateLayoutDashboard(baseId, dashboardId, layout),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(dashboardId));
    },
  });

  const layout = dashboardData?.layout ?? [];
  const pluginMap = dashboardData?.pluginMap ?? {};

  const onLayoutChange = (layout: ReactGridLayout.Layout[]) => {
    updateLayoutDashboardMutate(
      layout.map(({ i, x, y, w, h }) => ({ pluginInstallId: i, x, y, w, h }))
    );
  };

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
      breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
      onBreakpointChange={(newBreakpoint) => {
        if (newBreakpoint === 'xs' || newBreakpoint === 'xxs') {
          setIsSmallScreen(true);
        } else {
          setIsSmallScreen(false);
        }
      }}
      rowHeight={80}
      margin={[16, 16]}
      containerPadding={[16, 16]}
      cols={{ lg: 12, md: 12, sm: 12, xs: 1, xxs: 1 }}
      draggableHandle=".dashboard-draggable-handle"
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
      isResizable={canMange && !isSmallScreen}
      isDraggable={canMange && !isSmallScreen}
    >
      {layout.map(({ pluginInstallId, x, y, w, h }) => (
        <div
          key={pluginInstallId}
          data-grid={{ x, y, w, h }}
          className={cn({
            '!transform-none !transition-none': isExpandPlugin(pluginInstallId),
          })}
        >
          {pluginMap[pluginInstallId] ? (
            <PluginItem
              dragging={isDragging}
              dashboardId={dashboardId}
              name={pluginMap[pluginInstallId].name}
              pluginId={pluginMap[pluginInstallId].id}
              pluginUrl={pluginMap[pluginInstallId].url}
              pluginInstallId={pluginMap[pluginInstallId].pluginInstallId}
            />
          ) : (
            <div>{t('common:pluginCenter.pluginNotFound')}</div>
          )}
        </div>
      ))}
    </ResponsiveGridLayout>
  );
};
