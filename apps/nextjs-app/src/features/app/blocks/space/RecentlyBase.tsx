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
import { BaseList } from './BaseList';

export const RecentlyBase = () => {
  const { t } = useTranslation(['space']);

  // Recently visited bases data
  const { data: recentlyBase } = useQuery({
    queryKey: ReactQueryKeys.recentlyBase(),
    queryFn: () => getUserLastVisitListBase().then((res) => res.data),
  });
  const recentlyBases = useMemo(() => {
    return recentlyBase?.list || [];
  }, [recentlyBase]);

  // Shared bases data
  const { data: sharedBases } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
  });

  // Don't render if neither recent nor shared bases exist
  if (
    (!recentlyBases?.length || recentlyBases?.length === 0) &&
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
            {!recentlyBases?.length || recentlyBases?.length === 0 ? (
              <div className="flex items-center justify-center text-muted-foreground">
                {t('space:baseList.empty')}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <BaseList baseIds={recentlyBases.map((item) => item.resourceId)} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="shared" className="mt-0">
            {!sharedBases?.length || sharedBases?.length === 0 ? (
              <div className="flex items-center justify-center text-muted-foreground">
                {t('space:sharedBase.empty')}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <BaseList baseIds={sharedBases.map((base) => base.id)} />
              </div>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
};
