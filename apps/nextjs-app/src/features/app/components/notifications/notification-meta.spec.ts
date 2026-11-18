import { NotificationTypeEnum } from '@teable/core';
import { getNotificationCategory } from './notification-meta';

// The key as the backend writes it, namespace included.
const i18n = (key: string) => JSON.stringify({ i18nKey: `common.email.templates.notify.${key}` });

describe('getNotificationCategory', () => {
  it.each([
    [NotificationTypeEnum.CollaboratorCellTag, null, 'mention'],
    [NotificationTypeEnum.CollaboratorMultiRowTag, null, 'mention'],
    [NotificationTypeEnum.Comment, null, 'comment'],
    [NotificationTypeEnum.CollaboratorInvite, i18n('collaboratorInvite.base'), 'invite'],
    [NotificationTypeEnum.ExportBase, i18n('exportBase.success.message'), 'export'],
    [NotificationTypeEnum.AdminNotice, null, 'announcement'],
    [NotificationTypeEnum.OAuthApp, null, 'app'],
  ])('reads %s as %s', (notifyType, messageI18n, expected) => {
    expect(getNotificationCategory({ notifyType, messageI18n })).toBe(expected);
  });

  it.each([
    ['import.table.success.message', 'import'],
    ['automation.failed.title', 'automation'],
    ['connectorEvent.disconnected.grantRevoked', 'automation'],
    ['routine.failed.title', 'routine'],
    ['task.ai.cancelled.rateLimit', 'aiTask'],
    ['chatUnread.done.title', 'aiChat'],
    ['billing.credit.warning80.message', 'credit'],
    ['task.ai.cancelled.creditExhausted', 'credit'],
    ['billing.automationRun.warning80.title', 'billing'],
    ['rewardApproved.title', 'reward'],
    ['template.approved.title', 'template'],
    ['userDataExport.accountExported.title', 'dataExport'],
  ])('tells system notifications apart by key: %s → %s', (key, expected) => {
    expect(
      getNotificationCategory({
        notifyType: NotificationTypeEnum.System,
        messageI18n: i18n(key),
      })
    ).toBe(expected);
  });

  it('also reads keys written without the namespace', () => {
    expect(
      getNotificationCategory({
        notifyType: NotificationTypeEnum.System,
        messageI18n: JSON.stringify({
          i18nKey: 'email.templates.notify.billing.automationRun.warning80.title',
        }),
      })
    ).toBe('billing');
  });

  it('falls back to system for plain or unparsable messages', () => {
    expect(
      getNotificationCategory({
        notifyType: NotificationTypeEnum.System,
        messageI18n: null,
      })
    ).toBe('system');
    expect(
      getNotificationCategory({
        notifyType: NotificationTypeEnum.System,
        messageI18n: '{oops',
      })
    ).toBe('system');
  });
});
