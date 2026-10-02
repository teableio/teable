import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface ISettingAccountConfig {
  i18nNamespaces: I18nActiveNamespaces<'common' | 'sdk' | 'setting'>;
}

export const settingAccountConfig: ISettingAccountConfig = {
  i18nNamespaces: ['common', 'sdk', 'setting'],
};
