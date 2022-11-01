import type { I18nActiveNamespaces } from '@/lib/i18n';

export type HomeConfig = {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'home'>;
};
export const homeConfig: HomeConfig = {
  /** Namespaces that should be loaded for this page */
  i18nNamespaces: ['common', 'home'],
};
