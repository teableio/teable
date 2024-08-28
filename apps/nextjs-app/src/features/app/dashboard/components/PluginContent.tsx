import { useTranslation } from 'next-i18next';
import { dashboardConfig } from '@/features/i18n/dashboard.config';

export const PluginContent = (props: {
  pluginId: string;
  pluginInstallId: string;
  pluginUrl?: string;
}) => {
  const { pluginInstallId, pluginUrl } = props;
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  if (!pluginUrl) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('dashboard:pluginUrlEmpty')}
      </div>
    );
  }
  return (
    <iframe
      className="flex-1 rounded-b p-1"
      title={pluginInstallId}
      src={`${pluginUrl}?pluginInstallId=${pluginInstallId}`}
    />
  );
};
