import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IDashboardConfig {
  i18nNamespaces: I18nActiveNamespaces<
    'common' | 'space' | 'sdk' | 'table' | 'dashboard' | 'zod' | 'chart'
  >;
}

export const dashboardConfig: IDashboardConfig = {
  i18nNamespaces: ['common', 'space', 'sdk', 'table', 'dashboard', 'zod', 'chart'],
};
