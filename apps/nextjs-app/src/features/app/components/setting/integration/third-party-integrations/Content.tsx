import { useQuery } from '@tanstack/react-query';
import type { AuthorizedVo } from '@teable/openapi';
import { getAuthorizedList } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { IntegrationContainer } from '../common/Container';
import { IntegrationHeader } from '../common/Header';
import { Detail } from './Detail';
import { List } from './List';

export const ThirdPartyIntegrationsContent = () => {
  const { t } = useTranslation('common');
  const { data: authorizedList, isLoading } = useQuery({
    queryKey: ['integration'],
    queryFn: () => getAuthorizedList().then((res) => res.data),
  });
  const [detail, setDetail] = useState<AuthorizedVo>();

  return (
    <>
      <IntegrationContainer
        count={authorizedList?.length}
        isLoading={isLoading}
        description={
          <p className="pb-2 text-sm text-muted-foreground">
            {t('settings.integration.thirdPartyIntegrations.description', {
              count: authorizedList?.length,
            })}
          </p>
        }
      >
        <List list={authorizedList} onDetail={setDetail} />
      </IntegrationContainer>
      <div
        className={cn(
          'absolute left-0 top-0 w-full h-full flex-1 bg-background translate-x-full transition-transform duration-300',
          {
            'translate-x-0': detail,
          }
        )}
      >
        <IntegrationHeader
          className="border-b px-8 py-4"
          detailName={detail?.name}
          onBack={() => setDetail(undefined)}
        />
        <Detail detail={detail} onBack={() => setDetail(undefined)} />
      </div>
    </>
  );
};
