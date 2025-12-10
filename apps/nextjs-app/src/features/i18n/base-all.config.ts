import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IBaseAllConfig {
  // 合并所有 base 子页面需要的 i18n namespaces
  i18nNamespaces: I18nActiveNamespaces<
    'common' | 'space' | 'sdk' | 'table' | 'chart' | 'dashboard' | 'zod'
  >;
}

export const baseAllConfig: IBaseAllConfig = {
  i18nNamespaces: ['common', 'space', 'sdk', 'table', 'chart', 'dashboard', 'zod'],
};
