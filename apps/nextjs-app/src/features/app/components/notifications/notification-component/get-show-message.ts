import type { ILocalization } from '@teable/core';
import type { INotificationVo } from '@teable/openapi';
import { getLocalizationMessage } from '@teable/sdk/context';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import { sanitizeNotificationMessage } from './sanitize-notification-message';

/**
 * Resolve a notification's display message. The result is rendered via
 * dangerouslySetInnerHTML by the notification components, and part of the
 * message (the actor display name) is attacker-controlled, so the assembled
 * HTML is sanitized here — the single chokepoint both consumers share.
 */
export const getShowMessage = (
  data: INotificationVo['notifications'][number],
  t: ILocaleFunction
) => {
  const { message, messageI18n } = data;
  try {
    if (!messageI18n) {
      return sanitizeNotificationMessage(message);
    }
    const parsedMessage = JSON.parse(messageI18n);
    const { i18nKey = '', context = {} } = parsedMessage as ILocalization;
    if (!i18nKey) {
      return sanitizeNotificationMessage(message);
    }
    return sanitizeNotificationMessage(
      getLocalizationMessage({ i18nKey, context: { spaceName: '', ...context } }, t, 'common')
    );
  } catch (error) {
    return sanitizeNotificationMessage(message);
  }
};
