import { useQuery } from '@tanstack/react-query';
import { getDashboardList, LastVisitResourceType, updateUserLastVisit } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useInitializationZodI18n } from '../hooks/useInitializationZodI18n';
import { DashboardHeader } from './DashboardHeader';
import { DashboardMain } from './DashboardMain';
import { EmptyDashboard } from './EmptyDashboard';

export function DashboardPage() {
  const baseId = useBaseId()!;
  const router = useRouter();
  useInitializationZodI18n();
  const dashboardQueryId = router.query.dashboardId as string | undefined;
  const { data: dashboardList, isLoading } = useQuery({
    queryKey: ReactQueryKeys.getDashboardList(baseId),
    queryFn: ({ queryKey }) => getDashboardList(queryKey[1]).then((res) => res.data),
    enabled: !!baseId,
  });

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
      <DashboardMain dashboardId={dashboardId} />
    </div>
  );
}
