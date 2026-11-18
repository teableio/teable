import type { INotification } from '@teable/core';
import { NotificationTypeEnum } from '@teable/core';

/**
 * Where a notification comes from, as the reader thinks of it. The stored
 * type is too coarse for that — `system` alone covers imports, automations,
 * routines, billing and AI tasks — so system notifications are told apart by
 * the i18n key they were written with.
 */
export type INotificationCategory =
  | 'mention'
  | 'comment'
  | 'invite'
  | 'import'
  | 'export'
  | 'automation'
  | 'routine'
  | 'aiTask'
  | 'aiChat'
  | 'credit'
  | 'billing'
  | 'reward'
  | 'template'
  | 'dataExport'
  | 'announcement'
  | 'app'
  | 'system';

// The backend writes these keys with their namespace (`common.email…`); older
// ones were written without it.
const I18N_PREFIX = /^(?:common\.)?email\.templates\.notify\./;

// Segment right after the prefix → category. Longer prefixes come first.
// Anything about AI credits reads as credits, whichever feature ran out.
const SYSTEM_CATEGORY_BY_KEY: [string, INotificationCategory][] = [
  ['billing.credit', 'credit'],
  ['task.ai.cancelled.creditExhausted', 'credit'],
  ['task.ai', 'aiTask'],
  ['chatUnread', 'aiChat'],
  ['import', 'import'],
  ['exportBase', 'export'],
  ['userDataExport', 'dataExport'],
  ['automation', 'automation'],
  ['connectorEvent', 'automation'],
  ['routine', 'routine'],
  ['billing', 'billing'],
  ['reward', 'reward'],
  ['template', 'template'],
];

export const getNotificationI18nKey = (messageI18n: string | null | undefined) => {
  if (!messageI18n) return '';
  try {
    const parsed = JSON.parse(messageI18n) as { i18nKey?: unknown };
    return typeof parsed.i18nKey === 'string' ? parsed.i18nKey : '';
  } catch {
    return '';
  }
};

const getSystemCategory = (i18nKey: string): INotificationCategory => {
  const prefix = I18N_PREFIX.exec(i18nKey)?.[0];
  const rest = prefix ? i18nKey.slice(prefix.length) : '';
  const match = SYSTEM_CATEGORY_BY_KEY.find(([segment]) => rest.startsWith(segment));
  return match?.[1] ?? 'system';
};

export const getNotificationCategory = (
  notification: Pick<INotification, 'notifyType' | 'messageI18n'>
): INotificationCategory => {
  switch (notification.notifyType) {
    case NotificationTypeEnum.CollaboratorCellTag:
    case NotificationTypeEnum.CollaboratorMultiRowTag:
      return 'mention';
    case NotificationTypeEnum.Comment:
      return 'comment';
    case NotificationTypeEnum.CollaboratorInvite:
      return 'invite';
    case NotificationTypeEnum.ExportBase:
      return 'export';
    case NotificationTypeEnum.AdminNotice:
      return 'announcement';
    case NotificationTypeEnum.OAuthApp:
      return 'app';
    default:
      return getSystemCategory(getNotificationI18nKey(notification.messageI18n));
  }
};

/** People-sent notifications show the sender; the rest show their category. */
export const isPersonNotification = (category: INotificationCategory) =>
  category === 'mention' || category === 'comment' || category === 'invite';
