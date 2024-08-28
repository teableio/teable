import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IDashboardLayout } from '@teable/openapi';
import { getDashboard, updateLayoutDashboard } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
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
      rowHeight={80}
      onBreakpointChange={(newBreakpoint, newCols) => console.log(newBreakpoint, newCols)}
      cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
      draggableHandle=".dashboard-draggable-handle"
      onResizeStop={onLayoutChange}
      onDragStop={onLayoutChange}
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
              dashboardId={dashboardId}
              name={pluginMap[pluginInstallId].name}
              pluginId={pluginMap[pluginInstallId].id}
              pluginUrl={pluginMap[pluginInstallId].url}
              pluginInstallId={pluginMap[pluginInstallId].pluginInstallId}
            />
          ) : (
            <div>{t('dashboard:pluginNotFound')}</div>
          )}
        </div>
      ))}
    </ResponsiveGridLayout>
  );
};
