import 'i18next';
import type enSDkJson from '@teable/common-i18n/src/locales/en/sdk.json';
import type enCommonJson from '../locales/chart/en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      chart: typeof enCommonJson;
      sdk: typeof enSDkJson;
    };
  }
}
