import type { I18nActiveNamespaces } from '@/lib/i18n';

export type DemoConfig = {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'app'>;
};

export const appConfig: DemoConfig = {
  i18nNamespaces: ['common', 'app'],
};
