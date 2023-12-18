import type { CustomTypeOptions } from 'i18next';

export type I18nNamespace = keyof CustomTypeOptions['resources'];

/**
 * Helper to get fully typed namespaced keys
 */
export type I18nActiveNamespaces<NamespacesUnion extends I18nNamespace> = Extract<
  I18nNamespace,
  NamespacesUnion
>[];
