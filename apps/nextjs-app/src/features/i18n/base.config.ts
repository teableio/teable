import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IBaseConfig {
  i18nNamespaces: I18nActiveNamespaces<'common' | 'space' | 'sdk' | 'table'>;
}

export const baseConfig: IBaseConfig = {
  i18nNamespaces: ['common', 'space', 'sdk', 'table'],
};
