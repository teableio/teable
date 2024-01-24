import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IAutomationConfig {
  i18nNamespaces: I18nActiveNamespaces<'common' | 'space' | 'sdk'>;
}

export const automationConfig: IAutomationConfig = {
  i18nNamespaces: ['common', 'space', 'sdk'],
};
