import { useQuery } from '@tanstack/react-query';
import { getSharedBase, getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { BaseCard } from './BaseCard';

export const SharedBasePage = () => {
  const { data: bases } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
  });
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

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

  return (
    <div className="h-screen w-full overflow-y-auto px-10 py-5">
      <h2 className="mb-10 text-2xl font-bold">{t('space:sharedBase.title')}</h2>
      {bases?.length === 0 && (
        <p className="flex h-24 items-center justify-center text-xl text-muted-foreground">
          {t('space:sharedBase.empty')}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
        {bases?.map((base) => (
          <div key={base.id}>
            <BaseCard
              className="h-24 min-w-[17rem] max-w-[34rem] flex-1"
              base={base}
              spaceName={base.spaceName || spaceNameMap[base.spaceId]}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
