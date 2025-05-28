import { useQuery } from '@tanstack/react-query';
import { getUserLastVisitListBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { BaseCard } from './BaseCard';

export const RecentlyBase = () => {
  const { t } = useTranslation(['space']);
  const { data: recentlyBase } = useQuery({
    queryKey: ReactQueryKeys.recentlyBase(),
    queryFn: () => getUserLastVisitListBase().then((res) => res.data),
  });

  if (!recentlyBase?.list.length || recentlyBase?.list.length === 0) return;

  return (
    <Card className="w-full shadow-none">
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
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
