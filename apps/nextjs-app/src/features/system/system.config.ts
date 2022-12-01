import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface ISystemConfig {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'system'>;
}

export const systemConfig: ISystemConfig = {
  i18nNamespaces: ['system'],
};
