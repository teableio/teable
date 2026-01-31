import type { I18nActiveNamespaces } from '@/lib/i18n';

export interface IBaseAllConfig {
  i18nNamespaces: I18nActiveNamespaces<
    | 'common'
    | 'space'
    | 'sdk'
    | 'table'
    | 'chart'
    | 'dashboard'
    | 'zod'
    | 'developer'
    | 'token'
    | 'setting'
    | 'oauth'
  >;
}

export const baseAllConfig: IBaseAllConfig = {
  i18nNamespaces: [
    'common',
    'space',
    'sdk',
    'table',
    'chart',
    'dashboard',
    'zod',
    'developer',
    'token',
    'setting',
    'oauth',
  ],
};
