import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import enCommon from '@teable/common-i18n/src/locales/en/common.json';
import enSpace from '@teable/common-i18n/src/locales/en/space.json';
import { HttpErrorCode, NotificationSeverityEnum, NotificationTypeEnum } from '@teable/core';
import type { INotificationBuffer } from '@teable/core';
import type { IGetBaseVo } from '@teable/openapi';
import type * as OpenApi from '@teable/openapi';
import type * as Sdk from '@teable/sdk';
import { Toaster, toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure';
import { createInstance } from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsManage } from '@/features/app/components/notifications/NotificationsManage';
import { BaseActionTrigger } from './BaseActionTrigger';

const i18n = createInstance();
const notificationState: { current?: INotificationBuffer } = {};
const routeChangeListeners = new Set<(url: string) => void>();
const router = {
  asPath: '/space/spcExport',
  push: vi.fn(),
  events: {
    on: (_event: string, listener: (url: string) => void) => routeChangeListeners.add(listener),
    off: (_event: string, listener: (url: string) => void) => routeChangeListeners.delete(listener),
  },
};
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }),
}));
beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { en: { common: enCommon, space: enSpace } },
  });
});
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@teable/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  useNotification: () => notificationState.current,
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getNotificationSummary: () =>
    Promise.resolve({ data: { unreadCount: 1, criticalAdminNotices: [], unreadInvites: [] } }),
}));
vi.mock('@/features/app/hooks/usePublicFileEnabled', () => ({
  usePublicFileEnabled: () => false,
}));
vi.mock('@/features/app/components/billing/UpgradeWrapper', () => ({
  useUpgradeAction: () => ({}),
}));
vi.mock('@/features/app/components/collaborator/share/ShareBaseDialog', () => ({
  BaseInviteDialog: () => null,
}));
vi.mock('../../base/base-side-bar/BaseShareDialog', () => ({ BaseShareDialog: () => null }));
vi.mock('../../table/table-header/publish-base/PublishBaseDialog', () => ({
  PublishBaseDialog: () => null,
}));
vi.mock('./EditableSpaceSelect', () => ({ EditableSpaceSelect: () => null }));

const base: IGetBaseVo = {
  id: 'bseExport',
  name: 'Export project',
  spaceId: 'spcExport',
  icon: null,
  role: 'owner',
  createdBy: 'usrExport',
};
const fetchMock = vi.fn<typeof fetch>();
const encoder = new TextEncoder();
const sseResponse = (event: object) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );

const openExportDialog = async () => {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Project actions' }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('menuitem', { name: enCommon.actions.export }));
  return screen.findByRole('dialog');
};
const renderExport = (withNotifications = false) => {
  const client = new QueryClient();
  const content = () => (
    <QueryClientProvider client={client}>
      <BaseActionTrigger
        base={base}
        showRename={false}
        showDelete={false}
        showDuplicate={false}
        showExport
        showMove={false}
      >
        <button type="button">Project actions</button>
      </BaseActionTrigger>
      <Toaster />
      {withNotifications && <NotificationsManage />}
    </QueryClientProvider>
  );
  const rendered = render(content());
  return { ...rendered, rerenderExport: () => rendered.rerender(content()) };
};
const startExport = () =>
  fireEvent.click(screen.getByRole('button', { name: enSpace.tip.exportStartButton }));

beforeEach(() => {
  fetchMock.mockReset();
  routeChangeListeners.clear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  try {
    act(() => toast.dismiss());
    // Sonner keeps dismissed toasts mounted until its exit-animation timer removes them.
    await waitFor(() => expect(document.querySelector('[data-sonner-toast]')).toBeNull());
  } finally {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    notificationState.current = undefined;
  }
});

describe('BaseActionTrigger export feedback', () => {
  it.each(['json', 'sse'])(
    'shows localized busy feedback for a %s rejection',
    async (transport) => {
      const error = {
        message: 'Server wording is not used to classify this error',
        status: 429,
        code: HttpErrorCode.TOO_MANY_REQUESTS,
        data: { domainCode: 'base.export_busy' },
      };
      fetchMock.mockResolvedValue(
        transport === 'json'
          ? new Response(JSON.stringify(error), { status: 429 })
          : sseResponse({ type: 'error', ...error })
      );
      renderExport();
      await openExportDialog();
      startExport();

      expect(await screen.findByText(enSpace.tip.exportBusy)).toBeVisible();
      expect(screen.queryByText(enCommon.notification.exportBase.failedText)).toBeNull();
      expect(screen.getByRole('button', { name: enSpace.tip.exportStartButton })).toBeEnabled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['unrelated-429', 'stream-failure', 'network-failure'])(
    'keeps generic feedback for %s without retrying',
    async (failure) => {
      const message = 'An export is already in progress. Try again shortly.';
      if (failure === 'unrelated-429') {
        fetchMock.mockResolvedValue(
          new Response(
            JSON.stringify({
              message,
              code: HttpErrorCode.TOO_MANY_REQUESTS,
              data: { domainCode: 'unrelated.rate_limit' },
            }),
            { status: 429 }
          )
        );
      } else if (failure === 'stream-failure') {
        fetchMock.mockResolvedValue(sseResponse({ type: 'error', message }));
      } else {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      }
      renderExport();
      await openExportDialog();
      startExport();

      expect(await screen.findByText(enCommon.notification.exportBase.failedText)).toBeVisible();
      expect(screen.queryByText(enSpace.tip.exportBusy)).toBeNull();
      expect(screen.getByRole('button', { name: enSpace.tip.exportStartButton })).toBeEnabled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps the navigation warning visible while Escape preserves the export', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    renderExport();
    await openExportDialog();
    expect(screen.getByText(enSpace.tip.exportNavigationWarning)).toBeVisible();
    startExport();
    expect(screen.getByText(enSpace.tip.exportNavigationWarning)).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    act(() => {
      routeChangeListeners.forEach((listener) => listener(`${router.asPath}#section`));
    });
    expect(signal?.aborted).toBe(false);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(signal?.aborted).toBe(false);
    await openExportDialog();
    await act(async () => {
      streamController?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'done',
            data: {
              previewUrl: 'https://example.test/export.tea',
              fileName: 'export.tea',
              baseName: base.name,
            },
          })}\n\n`
        )
      );
      streamController?.close();
    });

    expect(await screen.findByText(enCommon.notification.exportBase.successText)).toBeVisible();
    expect(screen.getByRole('link', { name: enCommon.actions.download })).toHaveAttribute(
      'href',
      'https://example.test/export.tea'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['route', 'unmount'])('aborts the HTTP request on %s departure', async (departure) => {
    fetchMock.mockImplementation((_url, options) => {
      const { promise, reject } = (
        Promise as PromiseConstructor & {
          withResolvers<T>(): { promise: Promise<T>; reject: (reason?: unknown) => void };
        }
      ).withResolvers<Response>();
      options?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('The operation was aborted', 'AbortError')),
        { once: true }
      );
      return promise;
    });
    const errorToast = vi.spyOn(toast, 'error');
    const rendered = renderExport();
    await openExportDialog();
    startExport();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      if (departure === 'route') {
        routeChangeListeners.forEach((listener) => listener('/base/bseOther'));
      } else {
        rendered.unmount();
      }
    });

    expect(signal?.aborted).toBe(true);
    expect(errorToast).not.toHaveBeenCalled();
    expect(screen.queryByText(enCommon.notification.exportBase.failedText)).toBeNull();
    if (departure === 'unmount') expect(routeChangeListeners.size).toBe(0);
  });

  it('ignores late completion after a route departure', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    renderExport();
    await openExportDialog();
    startExport();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      routeChangeListeners.forEach((listener) => listener('/base/bseOther'));
      streamController?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'done',
            data: {
              previewUrl: 'https://example.test/stale.tea',
              fileName: 'stale.tea',
              baseName: base.name,
            },
          })}\n\n`
        )
      );
      streamController?.close();
    });

    await openExportDialog();
    expect(screen.getByRole('button', { name: enSpace.tip.exportStartButton })).toBeEnabled();
    expect(screen.queryByRole('link', { name: enCommon.actions.download })).toBeNull();
    expect(screen.queryByText(enCommon.notification.exportBase.failedText)).toBeNull();
  });

  it('shows the ready notification after Escape while the stream is still pending', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    const rendered = renderExport(true);
    await openExportDialog();
    startExport();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    notificationState.current = {
      unreadCount: 1,
      notification: {
        id: 'notExportAfterDismissal',
        notifyIcon: { iconUrl: '' },
        notifyType: NotificationTypeEnum.ExportBase,
        severity: NotificationSeverityEnum.Info,
        isRead: false,
        createdTime: '2026-11-17T00:00:00.000Z',
        url: 'https://example.test/export.tea',
        message: 'Export ready',
        messageI18n: JSON.stringify({
          i18nKey: 'email.templates.notify.exportBase.success.message',
          context: { baseId: base.id, baseName: base.name, name: 'export.tea' },
        }),
      },
    };
    rendered.rerenderExport();

    expect(await screen.findByText(enCommon.notification.exportBase.successText)).toBeVisible();
    expect(screen.getByRole('link', { name: enCommon.actions.download })).toHaveAttribute(
      'href',
      'https://example.test/export.tea'
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(signal?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      streamController?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'done',
            data: {
              previewUrl: 'https://example.test/export.tea',
              fileName: 'export.tea',
              baseName: base.name,
            },
          })}\n\n`
        )
      );
      streamController?.close();
    });
  });
});
