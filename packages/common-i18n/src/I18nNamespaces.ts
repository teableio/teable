import type auth from './locales/en/auth.json';
import type common from './locales/en/common.json';
import type dashboard from './locales/en/dashboard.json';
import type developer from './locales/en/developer.json';
import type oauth from './locales/en/oauth.json';
import type plugin from './locales/en/plugin.json';
import type sdk from './locales/en/sdk.json';
import type setting from './locales/en/setting.json';
import type share from './locales/en/share.json';
import type space from './locales/en/space.json';
import type system from './locales/en/system.json';
import type table from './locales/en/table.json';
import type token from './locales/en/token.json';
import type zod from './locales/en/zod.json';

export interface I18nNamespaces {
  auth: typeof auth;
  space: typeof space;
  common: typeof common;
  system: typeof system;
  sdk: typeof sdk;
  share: typeof share;
  table: typeof table;
  token: typeof token;
  setting: typeof setting;
  oauth: typeof oauth;
  zod: typeof zod;
  developer: typeof developer;
  plugin: typeof plugin;
  dashboard: typeof dashboard;
}
