import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IAdminConfig {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'admin' | 'navigation'>;
}

export const adminConfig: IAdminConfig = {
  /** Namespaces that should be loaded for this page */
  i18nNamespaces: ['common', 'admin', 'navigation'],
};
