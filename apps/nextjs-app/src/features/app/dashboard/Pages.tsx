import { useQuery } from '@tanstack/react-query';
import { AlertCircle, X } from '@teable/icons';
import { getDashboardList, LastVisitResourceType, updateUserLastVisit } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { useBaseResource } from '../hooks/useBaseResource';
import type { IBaseResourceDashboard } from '../hooks/useBaseResource';
import { useInitializationZodI18n } from '../hooks/useInitializationZodI18n';
import { useSetting } from '../hooks/useSetting';
import { DashboardHeader } from './DashboardHeader';
import { DashboardMain } from './DashboardMain';
import { EmptyDashboard } from './EmptyDashboard';

export function DashboardPage() {
  const baseId = useBaseId() as string;
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const [showDeprecationBanner, setShowDeprecationBanner] = useState(true);
  useInitializationZodI18n();
  const { dashboardId: dashboardQueryId } = useBaseResource() as IBaseResourceDashboard;
  const { data: dashboardList, isLoading } = useQuery({
    queryKey: ReactQueryKeys.getDashboardList(baseId),
    queryFn: ({ queryKey }) => getDashboardList(queryKey[1]).then((res) => res.data),
    enabled: !!baseId,
  });
  const { disallowDashboard } = useSetting();
  useEffect(() => {
    if (dashboardQueryId) {
      updateUserLastVisit({
        resourceId: dashboardQueryId,
        parentResourceId: baseId,
        resourceType: LastVisitResourceType.Dashboard,
      });
    }
  }, [dashboardQueryId, baseId]);

  if (isLoading) {
    return (
      <div className="ml-4 mt-4">
        <Spin />
      </div>
    );
  }
  if (!isLoading && !dashboardList?.length) {
    return <EmptyDashboard />;
  }
  const dashboardId = dashboardQueryId ?? dashboardList?.[0]?.id;

  return (
    <div className="flex h-full flex-col">
      <DashboardHeader dashboardId={dashboardId} />
      {disallowDashboard && showDeprecationBanner && (
        <div className="shrink-0 px-4 pt-4">
          <div className="flex flex-col items-start gap-1 rounded-lg border border-black/[0.08] bg-zinc-100 p-4 dark:border-white/[0.08] dark:bg-zinc-800">
            <div className="flex h-5 w-full items-center gap-3">
              <AlertCircle className="size-4 shrink-0 text-zinc-900 dark:text-zinc-100" />
              <p className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('dashboard:deprecation.title')}
              </p>
              <Button
                onClick={() => setShowDeprecationBanner(false)}
                variant="ghost"
                size="sm"
                className=" p-0"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="pl-7">
              <p className="text-xs text-zinc-900 dark:text-zinc-100">
                {t('dashboard:deprecation.description')}
              </p>
            </div>
          </div>
        </div>
      )}
      <DashboardMain dashboardId={dashboardId} />
    </div>
  );
}
