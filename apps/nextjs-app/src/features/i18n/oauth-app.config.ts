import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IOAuthAppConfig {
  i18nNamespaces: I18nActiveNamespaces<'common' | 'setting' | 'sdk' | 'oauth' | 'zod'>;
}

export const oauthAppConfig: IOAuthAppConfig = {
  i18nNamespaces: ['common', 'sdk', 'setting', 'oauth', 'zod'],
};
