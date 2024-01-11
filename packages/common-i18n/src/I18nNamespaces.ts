import type auth from './locales/en/auth.json';
import type common from './locales/en/common.json';
import type sdk from './locales/en/sdk.json';
import type share from './locales/en/share.json';
import type space from './locales/en/space.json';
import type system from './locales/en/system.json';
import type view from './locales/en/view.json';

export interface I18nNamespaces {
  auth: typeof auth;
  space: typeof space;
  common: typeof common;
  system: typeof system;
  sdk: typeof sdk;
  share: typeof share;
  view: typeof view;
}
