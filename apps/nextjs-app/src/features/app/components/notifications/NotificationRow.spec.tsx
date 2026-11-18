import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
} from '@teable/core';
import type { INotificationVo } from '@teable/openapi';
import type * as SdkHooks from '@teable/sdk/hooks';
import { fireEvent } from '@testing-library/react';
import { render } from '@/test-utils';
import { LinkNotification } from './notification-component';
import { NotificationIcon } from './NotificationIcon';
import { NotificationRow } from './NotificationRow';

type INotificationItem = INotificationVo['notifications'][number];

// The row shows "x minutes ago" through a dayjs the SDK sets up at app start.
vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useLanDayjs: () => () => ({ fromNow: () => 'just now', format: () => '2026-09-25 00:00' }),
}));

const push = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ push }) }));

const noop = () => undefined;

const FORUM_URL = 'https://community.teable.ai/t/linking-tables/42/3';

const buildNotification = (overrides: Partial<INotificationItem> = {}): INotificationItem =>
  ({
    id: 'notxxxxxxxxxxxxxxxxx',
    notifyIcon: { iconUrl: 'https://storage.example.com/public/logo/forum.png' },
    notifyType: NotificationTypeEnum.OAuthApp,
    url: FORUM_URL,
    message: 'From Teable Community: Ada replied in Linking &lt;tables&gt;',
    messageI18n: null,
    severity: NotificationSeverityEnum.Info,
    isRead: false,
    createdTime: '2026-09-25T00:00:00.000Z',
    ...overrides,
  }) as INotificationItem;

describe('notifications that link outside the app', () => {
  it('opens an app notification in a new tab', () => {
    const { container } = render(
      <NotificationRow notification={buildNotification()} onOpen={noop} onToggleRead={noop} />
    );
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe(FORUM_URL);
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    // the escaped title shows as text, not markup
    expect(container.textContent).toContain('Linking <tables>');
  });

  it('keeps in-app notifications in the same tab', () => {
    const { container } = render(
      <NotificationRow
        notification={buildNotification({
          notifyType: NotificationTypeEnum.Comment,
          notifyIcon: { userId: 'usrA', userName: 'Ada' },
          url: '/base/bseA/table/tblA?recordId=recA',
        })}
        onOpen={noop}
        onToggleRead={noop}
      />
    );
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/base/bseA/table/tblA?recordId=recA');
    expect(anchor?.getAttribute('target')).toBeNull();
  });

  it('opens the toast link in a new tab too', () => {
    const { container } = render(
      <LinkNotification data={buildNotification()} notifyStatus={NotificationStatesEnum.Unread} />
    );
    expect(container.querySelector('a')?.getAttribute('target')).toBe('_blank');
  });
});

describe('links inside the message', () => {
  it('reads the notification and goes to an in-app link in place', () => {
    const onOpen = vi.fn();
    const notification = buildNotification({
      notifyType: NotificationTypeEnum.System,
      notifyIcon: { iconUrl: '' },
      url: '',
      message: 'Your <a href="/space/spcA">Main space</a> reward claim has been approved.',
    });
    const { getByText } = render(
      <NotificationRow notification={notification} onOpen={onOpen} onToggleRead={noop} />
    );
    fireEvent.click(getByText('Main space'));
    expect(onOpen).toHaveBeenCalledWith(notification, { navigates: true });
    expect(push).toHaveBeenCalledWith('/space/spcA');
  });
});

describe('the unread dot', () => {
  it.each([
    [NotificationSeverityEnum.Critical, 'bg-red-500'],
    [NotificationSeverityEnum.Warning, 'bg-orange-500'],
    [NotificationSeverityEnum.Info, 'bg-blue-500'],
  ])('shows a %s notification in %s', (severity, color) => {
    const { container } = render(
      <NotificationRow
        notification={buildNotification({ severity })}
        onOpen={noop}
        onToggleRead={noop}
      />
    );
    expect(container.querySelector('[data-unread-dot]')?.className).toContain(color);
  });

  it('is gone once the notification is read', () => {
    const { container } = render(
      <NotificationRow
        notification={buildNotification({ isRead: true })}
        onOpen={noop}
        onToggleRead={noop}
      />
    );
    expect(container.querySelector('[data-unread-dot]')).toBeNull();
  });
});

describe('NotificationIcon', () => {
  it('shows the logo of the app that sent the notification', () => {
    const { container } = render(
      <NotificationIcon
        notifyType={NotificationTypeEnum.OAuthApp}
        notifyIcon={{ iconUrl: 'https://storage.example.com/public/logo/forum.png' }}
      />
    );
    // jsdom loads no image, so the avatar shows its fallback
    expect(container.textContent).toBe('A');
  });

  it('still draws something for a type this build does not know', () => {
    const { container } = render(
      <NotificationIcon
        notifyType={'somethingNew' as NotificationTypeEnum}
        notifyIcon={{ userId: 'usrA', userName: 'Ada' }}
      />
    );
    expect(container.textContent).not.toBe('');
  });
});
