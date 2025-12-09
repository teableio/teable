import { useQuery } from '@tanstack/react-query';
import { getSharedBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { BaseList } from './BaseList';

export const SharedBasePage = () => {
  const { data: sharedBases } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
  });
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-6 px-12 py-8">
      <h2 className="shrink-0 text-2xl font-semibold">{t('space:sharedBase.title')}</h2>
      <div className="min-h-0 flex-1">
        {sharedBases && sharedBases.length > 0 ? (
          <BaseList baseIds={sharedBases.map((base) => base.id)} />
        ) : (
          <p className="flex h-24 items-center justify-center text-xl text-muted-foreground">
            {t('space:sharedBase.empty')}
          </p>
        )}
      </div>
    </div>
  );
};
