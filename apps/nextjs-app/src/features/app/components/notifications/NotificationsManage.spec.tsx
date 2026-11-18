/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import enCommon from '@teable/common-i18n/src/locales/en/common.json';
import { NotificationSeverityEnum, NotificationTypeEnum } from '@teable/core';
import type { INotification, INotificationBuffer } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import type * as Sdk from '@teable/sdk';
import { Toaster, toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react/pure';
import { createInstance } from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsManage, getNotificationToastId } from './NotificationsManage';

const i18n = createInstance();
const notificationState: { current?: INotificationBuffer } = {};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const originalMatchMedia = window.matchMedia;
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }),
}));
vi.mock('@teable/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  useNotification: () => notificationState.current,
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getNotificationSummary: () =>
    Promise.resolve({ data: { unreadCount: 1, criticalAdminNotices: [], unreadInvites: [] } }),
}));

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { en: { common: enCommon } },
  });
});
beforeEach(() => {
  // Match the MediaQueryList browser stub used by SelectEditor consumer tests.
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
});
afterEach(async () => {
  try {
    act(() => toast.dismiss());
    // Sonner keeps dismissed toasts mounted until its exit-animation timer removes them.
    await waitFor(() => expect(document.querySelector('[data-sonner-toast]')).toBeNull());
  } finally {
    cleanup();
    queryClient.clear();
    notificationState.current = undefined;
    window.matchMedia = originalMatchMedia;
  }
});

const renderNotification = (outcome: 'cancelled' | 'success' | 'failed') => {
  const notification: INotification = {
    id: `notExport${outcome}`,
    notifyIcon: { iconUrl: '' },
    notifyType: NotificationTypeEnum.ExportBase,
    severity: NotificationSeverityEnum.Info,
    url: 'https://example.test/project.tea',
    message: 'Fallback notification text',
    // NotificationService removes the backend common. namespace before delivery.
    messageI18n: JSON.stringify({
      i18nKey: `email.templates.notify.exportBase.${outcome}.message`,
      context: { baseId: 'bseExport', baseName: 'Project', name: 'project.tea' },
    }),
    isRead: false,
    createdTime: '2026-11-17T00:00:00.000Z',
  };
  notificationState.current = { notification, unreadCount: 1 };
  return render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <NotificationsManage />
    </QueryClientProvider>
  );
};

describe('export notification feedback', () => {
  it('shows the cancellation reason without completion or download', async () => {
    const onComplete = vi.fn();
    window.addEventListener('export-base-complete', onComplete);
    try {
      renderNotification('cancelled');

      expect(
        await screen.findByText(enCommon.email.templates.notify.exportBase.cancelled.message)
      ).toBeVisible();
      expect(screen.queryByText(enCommon.notification.exportBase.successText)).toBeNull();
      expect(screen.queryByText(enCommon.notification.exportBase.failedText)).toBeNull();
      expect(screen.queryByRole('link', { name: enCommon.actions.download })).toBeNull();
      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('export-base-complete', onComplete);
    }
  });

  it('retains the ready message and download link for a successful export', async () => {
    renderNotification('success');

    expect(await screen.findByText(enCommon.notification.exportBase.successText)).toBeVisible();
    expect(screen.getByRole('link', { name: enCommon.actions.download })).toHaveAttribute(
      'href',
      'https://example.test/project.tea'
    );
    expect(
      screen.queryByText(enCommon.email.templates.notify.exportBase.cancelled.message)
    ).toBeNull();
  });

  it('retains failure feedback without a download link', async () => {
    renderNotification('failed');

    expect(await screen.findByText(enCommon.notification.exportBase.failedText)).toBeVisible();
    expect(screen.queryByText(enCommon.notification.exportBase.successText)).toBeNull();
    expect(screen.queryByRole('link', { name: enCommon.actions.download })).toBeNull();
  });
});

const alert = (id: string, i18nKey: string, severity = NotificationSeverityEnum.Critical) => ({
  id,
  severity,
  messageI18n: JSON.stringify({ i18nKey, context: { name: id } }),
});

describe('getNotificationToastId', () => {
  it('folds every alert about running out of credit into the one credit toast', () => {
    const ids = [
      alert('notA', 'email.templates.notify.routine.insufficientCredit.title'),
      alert('notB', 'email.templates.notify.routine.insufficientCredit.title'),
      alert('notC', 'email.templates.notify.automation.insufficientCredit.title'),
      alert(
        'notD',
        'email.templates.notify.task.ai.cancelled.creditExhausted',
        NotificationSeverityEnum.Warning
      ),
    ].map(getNotificationToastId);

    expect(new Set(ids).size).toBe(1);
  });

  it('folds Critical alerts of one kind into one toast, kept apart from other kinds', () => {
    const deactivated = [
      alert('notA', 'email.templates.notify.routine.autoDeactivated.title'),
      alert('notB', 'email.templates.notify.routine.autoDeactivated.title'),
    ].map(getNotificationToastId);
    const quota = [
      alert('notC', 'email.templates.notify.automation.runQuotaExceeded.title'),
      alert('notD', 'email.templates.notify.automation.runQuotaExceeded.title'),
    ].map(getNotificationToastId);

    expect(new Set(deactivated).size).toBe(1);
    expect(new Set(quota).size).toBe(1);
    expect(deactivated[0]).not.toBe(quota[0]);
  });

  it('keeps one toast per notification below Critical', () => {
    expect(
      getNotificationToastId(
        alert(
          'notA',
          'email.templates.notify.routine.failed.title',
          NotificationSeverityEnum.Warning
        )
      )
    ).toBe('notA');
    expect(
      getNotificationToastId({
        id: 'notB',
        severity: NotificationSeverityEnum.Critical,
        messageI18n: null,
      })
    ).toBe('notB');
  });
});
