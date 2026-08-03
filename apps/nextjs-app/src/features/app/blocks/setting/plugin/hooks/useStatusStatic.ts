import { PluginStatus } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';

export const useStatusStatic = (): Record<PluginStatus, string> => {
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);

  return useMemo(
    () => ({
      [PluginStatus.Developing]: t('plugin:status.developing'),
      [PluginStatus.Reviewing]: t('plugin:status.reviewing'),
      [PluginStatus.Published]: t('plugin:status.published'),
    }),
    [t]
  );
};
