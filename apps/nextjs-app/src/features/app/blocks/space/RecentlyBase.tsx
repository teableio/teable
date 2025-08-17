import { useQuery } from '@tanstack/react-query';
import { getUserLastVisitListBase, getSpaceList, getSharedBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { BaseCard } from './BaseCard';

export const RecentlyBase = () => {
  const { t } = useTranslation(['space']);

  // Recently visited bases data
  const { data: recentlyBase } = useQuery({
    queryKey: ReactQueryKeys.recentlyBase(),
    queryFn: () => getUserLastVisitListBase().then((res) => res.data),
  });

  // Shared bases data
  const { data: sharedBases } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
  });

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const spaceNameMap = useMemo(() => {
    if (!spaceList) return {};
    return spaceList.reduce(
      (acc, space) => {
        acc[space.id] = space.name;
        return acc;
      },
      {} as Record<string, string>
    );
  }, [spaceList]);

  // Don't render if neither recent nor shared bases exist
  if (
    (!recentlyBase?.list.length || recentlyBase?.list.length === 0) &&
    (!sharedBases?.length || sharedBases?.length === 0)
  ) {
    return null;
  }

  return (
    <Card className="w-full bg-muted/30 shadow-none">
      <Tabs defaultValue="recent" className="w-full">
        <CardHeader className="pb-3 pt-5">
          <div className="flex items-center justify-between">
            <CardTitle>
              <TabsList>
                <TabsTrigger value="recent">{t('space:recentlyBase.title')}</TabsTrigger>
                <TabsTrigger value="shared" className="relative">
                  {t('space:sharedBase.title')}
                  {sharedBases && sharedBases.length > 0 && (
                    <span className="absolute right-1 top-0 ml-2 text-xs font-medium text-muted-foreground">
                      {sharedBases.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <TabsContent value="recent" className="mt-0">
            {!recentlyBase?.list.length || recentlyBase?.list.length === 0 ? (
              <div className="flex items-center justify-center text-muted-foreground">
                No recently visited bases
              </div>
            ) : (
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
            )}
          </TabsContent>

          <TabsContent value="shared" className="mt-0">
            {!sharedBases?.length || sharedBases?.length === 0 ? (
              <div className="flex items-center justify-center text-muted-foreground">
                {t('space:sharedBase.empty')}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3">
                {sharedBases?.map((base) => (
                  <BaseCard
                    className="h-20 max-w-[34rem] flex-1 sm:min-w-[17rem]"
                    key={base.id}
                    base={base}
                    spaceName={base.spaceName || spaceNameMap[base.spaceId]}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
};
