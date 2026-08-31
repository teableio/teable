import { HttpError } from '@teable/core';
import type { GetServerSidePropsContext } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserMe } from '@/backend/api/rest/get-user';
import ensureLogin from './ensureLogin';

vi.mock('@/backend/api/rest/get-user', () => ({
  getUserMe: vi.fn(),
}));

vi.mock('@/features/auth/components/SocialAuth', () => ({
  providersAll: [],
}));

const mockedGetUserMe = vi.mocked(getUserMe);

const createContext = (url = '/base/bse123/table/tbl123') =>
  ({
    req: { headers: { cookie: 'session=1' }, url },
    res: {},
    query: {},
  }) as unknown as GetServerSidePropsContext;

const user = { id: 'usr123', name: 'Test' };

describe('ensureLogin parallel handler mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('merges user into handler props when both succeed', async () => {
    mockedGetUserMe.mockResolvedValue(user as never);
    const handler = vi.fn().mockResolvedValue({ props: { foo: 1 } });

    const result = await ensureLogin(handler, false, { parallelHandler: true })(createContext());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ props: { foo: 1, user } });
  });

  it('redirects to signup with the original URL when user lookup fails with 4xx', async () => {
    mockedGetUserMe.mockRejectedValue(new HttpError('Unauthorized', 401));
    const handler = vi.fn().mockResolvedValue({ props: { foo: 1 } });
    const url = '/base/bse123/table/tbl123?viewId=viw123&filter=Open';

    const result = await ensureLogin(handler, false, { parallelHandler: true })(createContext(url));

    expect(result).toEqual({
      redirect: {
        destination: `/auth/signup?redirect=${encodeURIComponent(url)}`,
        permanent: false,
      },
    });
  });

  it('keeps handler result and sets err prop when user lookup fails with 5xx', async () => {
    mockedGetUserMe.mockRejectedValue(new HttpError('boom', 500));
    const handler = vi.fn().mockResolvedValue({ props: { foo: 1 } });

    const result = await ensureLogin(handler, false, { parallelHandler: true })(createContext());

    expect(result).toEqual({ props: { foo: 1, err: 'boom' } });
  });

  it('keeps handler result and sets err prop on non-http user lookup errors', async () => {
    mockedGetUserMe.mockRejectedValue(new Error('socket hang up'));
    const handler = vi.fn().mockResolvedValue({ props: { foo: 1 } });

    const result = await ensureLogin(handler, false, { parallelHandler: true })(createContext());

    expect(result).toEqual({ props: { foo: 1, err: 'socket hang up' } });
  });

  it('propagates handler rejection when the user lookup succeeds', async () => {
    mockedGetUserMe.mockResolvedValue(user as never);
    const handlerError = new Error('handler exploded');
    const handler = vi.fn().mockRejectedValue(handlerError);

    await expect(
      ensureLogin(handler, false, { parallelHandler: true })(createContext())
    ).rejects.toBe(handlerError);
  });

  it('attaches user props to handler redirects, mirroring the serial mode', async () => {
    mockedGetUserMe.mockResolvedValue(user as never);
    const handler = vi
      .fn()
      .mockResolvedValue({ redirect: { destination: '/base/bse123', permanent: false } });

    const result = await ensureLogin(handler, false, { parallelHandler: true })(createContext());

    expect(result).toEqual({
      redirect: { destination: '/base/bse123', permanent: false },
      props: { user },
    });
  });
});

describe('ensureLogin serial mode (default)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not invoke the handler when the user lookup fails with 4xx', async () => {
    mockedGetUserMe.mockRejectedValue(new HttpError('Unauthorized', 401));
    const handler = vi.fn().mockResolvedValue({ props: { foo: 1 } });
    const url = '/base/bse123/table/tbl123?viewId=viw123&filter=Open';

    const result = await ensureLogin(handler)(createContext(url));

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({
      redirect: {
        destination: `/auth/signup?redirect=${encodeURIComponent(url)}`,
        permanent: false,
      },
    });
  });

  it('merges user into handler props when both succeed', async () => {
    mockedGetUserMe.mockResolvedValue(user as never);
    const handler = vi.fn().mockResolvedValue({ props: { foo: 1 } });

    const result = await ensureLogin(handler)(createContext());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ props: { foo: 1, user } });
  });
});
