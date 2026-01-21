import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface ISettingConfig {
  i18nNamespaces: I18nActiveNamespaces<
    'common' | 'sdk' | 'setting' | 'developer' | 'token' | 'oauth' | 'zod'
  >;
}

export const settingConfig: ISettingConfig = {
  i18nNamespaces: ['common', 'sdk', 'setting', 'developer', 'token', 'oauth', 'zod'],
};
