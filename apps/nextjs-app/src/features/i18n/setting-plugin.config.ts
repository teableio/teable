import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface ISettingPluginConfig {
  i18nNamespaces: I18nActiveNamespaces<'common' | 'sdk' | 'setting' | 'plugin' | 'zod'>;
}

export const settingPluginConfig: ISettingPluginConfig = {
  i18nNamespaces: ['common', 'sdk', 'setting', 'plugin', 'zod'],
};
