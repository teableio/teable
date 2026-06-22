import type { ILocalization } from '@teable/core';
import type { INotificationVo } from '@teable/openapi';
import { getLocalizationMessage } from '@teable/sdk/context';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';

export const getShowMessage = (
  data: INotificationVo['notifications'][number],
  t: ILocaleFunction
) => {
  const { message, messageI18n } = data;
  try {
    if (!messageI18n) {
      return message;
    }
    const parsedMessage = JSON.parse(messageI18n);
    const { i18nKey = '', context = {} } = parsedMessage as ILocalization;
    if (!i18nKey) {
      return message;
    }
    return getLocalizationMessage({ i18nKey, context: { spaceName: '', ...context } }, t, 'common');
  } catch (error) {
    return message;
  }
};
