import { useQuery } from '@tanstack/react-query';
import { getUserIntegrationList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTranslation } from 'next-i18next';
import { IntegrationContainer } from '../common/Container';
import { List } from './List';

export const UserIntegrationContent = () => {
  const { t } = useTranslation('common');
  const { data: integrationData, isLoading } = useQuery({
    queryKey: ReactQueryKeys.getUserIntegrations(),
    queryFn: () => getUserIntegrationList().then((res) => res.data),
  });

  const integrationList = integrationData?.integrations;
  const integrationCount = integrationList?.length;
  return (
    <>
      <IntegrationContainer
        count={integrationCount}
        isLoading={isLoading}
        description={
          <p className="pb-2 text-sm text-muted-foreground">
            {t('settings.integration.userIntegration.description')}
          </p>
        }
      >
        <List list={integrationList} />
      </IntegrationContainer>
    </>
  );
};
