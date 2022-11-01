import type { I18nActiveNamespaces } from '@/lib/i18n';

export type DemoConfig = {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'demo'>;
};

export const demoConfig: DemoConfig = {
  i18nNamespaces: ['common', 'demo'],
};
