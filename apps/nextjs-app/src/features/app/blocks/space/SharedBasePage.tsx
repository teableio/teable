import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from '@teable/icons';
import { getSharedBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { BaseList } from './BaseList';

export const SharedBasePage = () => {
  const { data: sharedBases } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
  });
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const router = useRouter();

  const onBack = () => {
    router.push({ pathname: '/space' });
  };

  return (
    <div className="flex h-screen flex-1 flex-col space-y-4 overflow-hidden p-8">
      <div className="flex flex-col items-start justify-between gap-2">
        <Button
          className="h-6 p-0 text-sm text-muted-foreground hover:no-underline hover:opacity-75"
          variant="link"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
          <span>{t('common:settings.back')}</span>
        </Button>
        <h1 className="text-2xl font-semibold">{t('space:sharedBase.title')}</h1>
        <p className="shrink-0 grow-0 text-left text-sm text-zinc-500">
          {t('space:sharedBase.description')}
        </p>
      </div>
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
