import { useQuery } from '@tanstack/react-query';
import { Plus } from '@teable/icons';
import { getDashboard } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { isEmpty } from 'lodash';
import { useTranslation } from 'next-i18next';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { AddPluginDialog } from './components/AddPluginDialog';
import { DashboardGrid } from './DashboardGrid';

export const DashboardMain = (props: { dashboardId: string }) => {
  const { dashboardId } = props;
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const baseId = useBaseId()!;
  const basePermissions = useBasePermission();
  const canManage = basePermissions?.['base|update'];
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ReactQueryKeys.getDashboard(dashboardId),
    queryFn: () => getDashboard(baseId, dashboardId).then((res) => res.data),
  });
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spin />
      </div>
    );
  }
  if (isEmpty(dashboardData?.pluginMap) && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p>{t('common:pluginCenter.pluginEmpty.title')}</p>
        {canManage && (
          <AddPluginDialog dashboardId={dashboardId}>
            <Button size={'xs'}>
              <Plus />
              {t('dashboard:addPlugin')}
            </Button>
          </AddPluginDialog>
        )}
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-scroll p-4">
      <DashboardGrid dashboardId={dashboardId} />
    </div>
  );
};
