import { useQuery } from '@tanstack/react-query';
import { getUserLastVisitListBase, getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { BaseCard } from './BaseCard';

export const RecentlyBase = () => {
  const { t } = useTranslation(['space']);
  const { data: recentlyBase } = useQuery({
    queryKey: ReactQueryKeys.recentlyBase(),
    queryFn: () => getUserLastVisitListBase().then((res) => res.data),
  });

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const spaceNameMap = useMemo(() => {
    if (!spaceList) return {};
    return spaceList.reduce((acc, space) => {
      acc[space.id] = space.name;
      return acc;
    }, {} as Record<string, string>);
  }, [spaceList]);

  if (!recentlyBase?.list.length || recentlyBase?.list.length === 0) return;

  return (
    <Card className="w-full shadow-none bg-muted/30">
      <CardHeader className="pt-5">
        <CardTitle>{t('space:recentlyBase.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3">
          {recentlyBase?.list.map((item) => (
            <BaseCard
              className="h-20 max-w-[34rem] flex-1 sm:min-w-[17rem]"
              key={item.resourceId}
              base={item.resource}
              spaceName={spaceNameMap[item.resource.spaceId]}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
