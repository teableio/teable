import type { I18nActiveNamespaces } from '@/lib/i18n';

export type SystemConfig = {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'system'>;
};

export const systemConfig: SystemConfig = {
  i18nNamespaces: ['system'],
};
