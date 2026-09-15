import { HttpErrorCode } from '@teable/core';
import { Connection } from 'sharedb/lib/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILocaleFunction } from './i18n';
import { handleShareDbError, handleShareDbReceive } from './shareDbErrorHandler';

vi.mock('@teable/ui-lib', () => ({
  sonner: { toast: { error: vi.fn(), warning: vi.fn() } },
}));

const t: ILocaleFunction = ((key: string) => key) as ILocaleFunction;

describe('handleShareDbError', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toastError: any;
  const reload = vi.fn();

  beforeEach(async () => {
    const { sonner } = await import('@teable/ui-lib');
    toastError = sonner.toast.error;
    toastError.mockClear();
    reload.mockClear();
    vi.stubGlobal('location', {
      href: 'https://app.teable.ai/base/bseTest/table/tblTest',
      reload,
    });
  });

  it('shows the shared sonner toast with an i18n error-type title', () => {
    handleShareDbError(
      { code: HttpErrorCode.RESTRICTED_RESOURCE, message: 'Table ID does not exist' },
      t
    );

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      'httpErrors.restrictedResource',
      expect.objectContaining({
        description: 'Table ID does not exist',
      })
    );
  });

  it('translates the server localization when ShareDB preserves it', () => {
    handleShareDbError(
      {
        code: HttpErrorCode.RESTRICTED_RESOURCE,
        message: 'Table ID does not exist',
        data: { localization: { i18nKey: 'httpErrors.table.notFound' } },
      },
      t
    );

    expect(toastError).toHaveBeenCalledWith(
      'httpErrors.restrictedResource',
      expect.objectContaining({
        description: 'httpErrors.table.notFound',
      })
    );
  });

  it('does not toast view_not_found socket noise', () => {
    handleShareDbError({ code: HttpErrorCode.VIEW_NOT_FOUND, message: 'View not found' }, t);

    expect(toastError).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not toast private computed activity aggregate denials', () => {
    handleShareDbError(
      {
        code: HttpErrorCode.RESTRICTED_RESOURCE,
        message: 'Computed activity aggregate is private',
      },
      t
    );

    expect(toastError).not.toHaveBeenCalled();
  });

  it('reloads on unauthorized share instead of redirecting to signup', () => {
    handleShareDbError(
      { code: HttpErrorCode.UNAUTHORIZED_SHARE, message: 'Unauthorized share' },
      t
    );

    expect(reload).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reuses the API handler redirect for unauthorized', () => {
    handleShareDbError({ code: HttpErrorCode.UNAUTHORIZED, message: 'Unauthorized' }, t);

    expect(window.location.href).toContain('/auth/signup?redirect=');
    expect(toastError).not.toHaveBeenCalled();
  });
});

class FakeShareDbSocket {
  readyState = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onclose: ((reason?: string) => void) | null = null;
  send() {}
  close() {}
}

const inject = (socket: FakeShareDbSocket, data: unknown) => {
  socket.onmessage?.({ data: JSON.stringify(data) });
};

const handshake = (socket: FakeShareDbSocket) => {
  socket.readyState = 1;
  socket.onopen?.();
  inject(socket, {
    a: 'hs',
    protocol: 1,
    protocolMinor: 2,
    type: 'http://sharejs.org/types/JSONv0',
    id: 'test-agent',
  });
};

describe('handleShareDbReceive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toastError: any;

  beforeEach(async () => {
    const { sonner } = await import('@teable/ui-lib');
    toastError = sonner.toast.error;
    toastError.mockClear();
    vi.stubGlobal('location', {
      href: 'https://app.teable.ai/base/bseTest/table/tblTest',
      reload: vi.fn(),
    });
  });

  it('still toasts ordinary record-channel ShareDB errors', () => {
    const socket = new FakeShareDbSocket();
    const connection = new Connection(socket as never);
    connection.on('receive', (request) => handleShareDbReceive(request, t));
    handshake(socket);

    inject(socket, {
      a: 's',
      c: 'tblTest',
      d: 'recOne',
      error: { code: HttpErrorCode.RESTRICTED_RESOURCE, message: 'record denied' },
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      'httpErrors.restrictedResource',
      expect.objectContaining({ description: 'record denied' })
    );
  });
});
