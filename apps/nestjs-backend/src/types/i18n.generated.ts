// Typed straight from the en locale files, so new keys need no regeneration step.
import type auth from '@teable/common-i18n/src/locales/en/auth.json';
import type chart from '@teable/common-i18n/src/locales/en/chart.json';
import type common from '@teable/common-i18n/src/locales/en/common.json';
import type dashboard from '@teable/common-i18n/src/locales/en/dashboard.json';
import type developer from '@teable/common-i18n/src/locales/en/developer.json';
import type oauth from '@teable/common-i18n/src/locales/en/oauth.json';
import type plugin from '@teable/common-i18n/src/locales/en/plugin.json';
import type sdk from '@teable/common-i18n/src/locales/en/sdk.json';
import type setting from '@teable/common-i18n/src/locales/en/setting.json';
import type share from '@teable/common-i18n/src/locales/en/share.json';
import type space from '@teable/common-i18n/src/locales/en/space.json';
import type table from '@teable/common-i18n/src/locales/en/table.json';
import type token from '@teable/common-i18n/src/locales/en/token.json';
import type zod from '@teable/common-i18n/src/locales/en/zod.json';
import type { Path } from 'nestjs-i18n';

export type I18nTranslations = {
  auth: typeof auth;
  chart: typeof chart;
  common: typeof common;
  dashboard: typeof dashboard;
  developer: typeof developer;
  oauth: typeof oauth;
  plugin: typeof plugin;
  sdk: typeof sdk;
  setting: typeof setting;
  share: typeof share;
  space: typeof space;
  table: typeof table;
  token: typeof token;
  zod: typeof zod;
};
export type I18nPath = Path<I18nTranslations>;
