/**
 * Types augmentation for translation keys to allow to typecheck
 * and suggesting keys to the t function. In case it's too slow
 * you can opt out by commenting the following code.
 * @link https://react.i18next.com/latest/typescript
 */
import 'react-i18next';
import type { I18nNamespaces } from '@teable-group/common-i18n';

declare module 'react-i18next' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: I18nNamespaces;
  }
}
