import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface ITableConfig {
  // Define namespaces in use in both the type and the config.
  i18nNamespaces: I18nActiveNamespaces<'common' | 'space' | 'sdk' | 'table' | 'chart'>;
}

export const tableConfig: ITableConfig = {
  i18nNamespaces: ['common', 'space', 'sdk', 'table', 'chart'],
};
