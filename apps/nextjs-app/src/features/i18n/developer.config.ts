import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IDeveloperConfig {
  i18nNamespaces: I18nActiveNamespaces<'common' | 'setting' | 'table' | 'sdk' | 'developer'>;
}

export const developerConfig: IDeveloperConfig = {
  i18nNamespaces: ['common', 'setting', 'table', 'sdk', 'developer'],
};
