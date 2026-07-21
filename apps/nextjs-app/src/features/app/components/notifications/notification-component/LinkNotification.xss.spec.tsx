/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Regression guard for GHSA-3rmq-5wwc-x8w2:
 * Stored XSS in notifications via an unsanitized display name.
 *
 * LinkNotification renders the notification message through
 * `dangerouslySetInnerHTML`. The message is built from an i18n template with the
 * attacker-controlled `fromUserName` interpolated in. The fix sanitizes the
 * assembled message (in getShowMessage) so an `<img onerror=...>` payload cannot
 * execute, while the small set of legitimate tags our templates use survives.
 */
import { NotificationTypeEnum, NotificationSeverityEnum } from '@teable/core';
import type { INotificationVo } from '@teable/openapi';
import { LinkNotification } from '@/features/app/components/notifications/notification-component/LinkNotification';
import { render } from '@/test-utils';

type INotificationItem = INotificationVo['notifications'][number];

// The payload an attacker sets as their display name via PATCH /api/user/name.
const XSS_NAME = '<img src=x onerror="window.__xss_fired=true" data-xss="1">';

function buildNotification(message: string): INotificationItem {
  return {
    id: 'notxxxxxxxxxxxxxxxxx',
    notifyIcon: { userId: 'usrxxxx', userName: 'attacker' },
    notifyType: NotificationTypeEnum.CollaboratorCellTag,
    // No url → LinkNotification takes the disableLink branch, still dangerouslySetInnerHTML.
    url: '',
    message,
    messageI18n: null,
    severity: NotificationSeverityEnum.Info,
    isRead: false,
    createdTime: '2026-07-17T00:00:00.000Z',
  } as INotificationItem;
}

describe('GHSA-3rmq: notification message is sanitized before render', () => {
  it('strips an <img onerror> payload injected via the display name', () => {
    const message = `${XSS_NAME} added you to the Assignee field of a record in T1`;

    const { container } = render(
      <LinkNotification
        data={buildNotification(message)}
        notifyStatus={'unread' as never}
        disableLink
      />
    );

    // The dangerous element / handler must be gone after sanitization.
    expect(container.querySelector('img[data-xss="1"]')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
    // The benign surrounding text is preserved.
    expect(container.textContent).toContain('added you to the Assignee field of a record in T1');
  });

  it('preserves legitimate anchor markup used by our own templates', () => {
    const message =
      '<a href="https://example.com/report.csv" target="_blank" rel="noopener" download="error_report.csv">Download Error Report</a>';

    const { container } = render(
      <LinkNotification
        data={buildNotification(message)}
        notifyStatus={'unread' as never}
        disableLink
      />
    );

    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://example.com/report.csv');
    expect(anchor?.textContent).toBe('Download Error Report');
  });

  it('preserves a relative preview URL (local-storage export download link)', () => {
    // Local-storage exports produce a relative previewUrl for cookie-authed UI
    // requests. The download anchor must survive sanitization intact.
    const message =
      '<a href="/api/attachments/read/export-base/abc?token=xyz" name="base.zip">🗂️ base.zip</a>';

    const { container } = render(
      <LinkNotification
        data={buildNotification(message)}
        notifyStatus={'unread' as never}
        disableLink
      />
    );

    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('/api/attachments/read/export-base/abc?token=xyz');
  });

  it('drops javascript: URIs from anchors', () => {
    const message = '<a href="javascript:alert(1)">click</a>';

    const { container } = render(
      <LinkNotification
        data={buildNotification(message)}
        notifyStatus={'unread' as never}
        disableLink
      />
    );

    expect(container.innerHTML).not.toContain('javascript:');
  });
});
