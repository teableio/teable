import 'i18next';
import type enSDkJson from '@teable/common-i18n/src/locales/en/sdk.json';
import type enCommonJson from '../locales/en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof enCommonJson;
      sdk: typeof enSDkJson;
    };
  }
}
