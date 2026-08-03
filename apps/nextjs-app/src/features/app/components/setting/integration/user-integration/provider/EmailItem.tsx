import type { IUserIntegrationEmailMetadata, IUserIntegrationItemVo } from '@teable/openapi';
import { useTranslation } from 'next-i18next';

export const EmailItem = ({
  item,
  children,
}: {
  item: IUserIntegrationItemVo;
  children: React.ReactNode;
}) => {
  const metadata = item.metadata as IUserIntegrationEmailMetadata;
  const { t } = useTranslation('common');
  return (
    <div className="flex-1 space-y-1">
      {children}
      <div className="text-xs text-muted-foreground">
        {t('settings.integration.userIntegration.email.user')}: {metadata.userInfo.name}
      </div>
      <div className="text-xs text-muted-foreground">
        {t('settings.integration.userIntegration.email.email')}: {metadata.userInfo.email}
      </div>
    </div>
  );
};
