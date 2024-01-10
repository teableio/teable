import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IViewConfig {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'space' | 'sdk' | 'view'>;
}

export const viewConfig: IViewConfig = {
  i18nNamespaces: ['common', 'space', 'sdk', 'view'],
};
