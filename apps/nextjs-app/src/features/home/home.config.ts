import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IHomeConfig {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'home'>;
}

export const homeConfig: IHomeConfig = {
  /** Namespaces that should be loaded for this page */
  i18nNamespaces: ['common', 'home'],
};
