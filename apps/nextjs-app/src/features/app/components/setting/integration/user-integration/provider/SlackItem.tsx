import type { IUserIntegrationSlackMetadata, IUserIntegrationItemVo } from '@teable/openapi';
import { useTranslation } from 'next-i18next';

export const SlackItem = ({
  item,
  children,
}: {
  item: IUserIntegrationItemVo;
  children: React.ReactNode;
}) => {
  const metadata = item.metadata as IUserIntegrationSlackMetadata;
  const { t } = useTranslation('common');
  return (
    <div className="flex-1 space-y-1">
      {children}
      <div className="text-xs text-muted-foreground">
        {t('settings.integration.userIntegration.slack.user')}: {metadata.userInfo.name}
      </div>
      <div className="text-xs text-muted-foreground">
        {t('settings.integration.userIntegration.slack.workspace')}: {metadata.teamInfo.name}
      </div>
    </div>
  );
};
