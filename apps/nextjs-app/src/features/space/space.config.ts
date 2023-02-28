import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface ISpaceConfig {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'space'>;
}

export const spaceConfig: ISpaceConfig = {
  /** Namespaces that should be loaded for this page */
  i18nNamespaces: ['common', 'space'],
};
