import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILocaleFunction } from './i18n';
import { handleShareDbError } from './shareDbErrorHandler';

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
