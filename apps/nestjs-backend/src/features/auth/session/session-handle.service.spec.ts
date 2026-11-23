/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import session from 'express-session';
import type { IAuthConfig } from '../../../configs/auth.config';
import { AUTH_SESSION_COOKIE_NAME } from '../../../const';
import { SessionHandleService } from './session-handle.service';
import type { SessionStoreService } from './session-store.service';

describe('SessionHandleService', () => {
  // One store for every deployment below, like the shared Redis behind a rolling rotation.
  const store = new session.MemoryStore();
  const servers: Server[] = [];

  afterAll(() => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });

  /**
   * Serves the session middleware over HTTP: `/login` signs a user in, `/logout` destroys the
   * session and clears its cookie, any other path answers with the signed-in user ('' when
   * the cookie carries no session).
   */
  const serve = async (secret: string, oldSecret?: string) => {
    const { sessionMiddleware } = new SessionHandleService(
      store as unknown as SessionStoreService,
      {
        session: { secret, oldSecret, expiresIn: '7d', cookie: { secure: false } },
      } as unknown as IAuthConfig
    );
    const server = createServer((req, res) =>
      sessionMiddleware(req as any, res as any, () => {
        const current = (req as any).session;
        if (req.url === '/logout') {
          current.destroy(() => {
            res.setHeader('Set-Cookie', `${AUTH_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`);
            res.end('');
          });
          return;
        }
        if (req.url === '/login') {
          current.passport = { user: { id: 'usr1' } };
        }
        res.end(current?.passport?.user?.id ?? '');
      })
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    return async (path: string, cookie?: string) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: cookie ? { cookie } : {},
      });
      const cookies = res.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .filter((value) => value.startsWith(`${AUTH_SESSION_COOKIE_NAME}=`));
      return { user: await res.text(), cookie: cookies[0], cookies };
    };
  };

  const signInBeforeRotation = async () => (await (await serve('old-secret'))('/login')).cookie;

  it('signs the cookie again with the new secret while the old one is accepted', async () => {
    const oldCookie = await signInBeforeRotation();
    expect(oldCookie).toBeDefined();

    const rotating = await serve('new-secret', 'old-secret');
    const visit = await rotating('/me', oldCookie);
    expect(visit.user).toBe('usr1');
    expect(visit.cookie).toBeDefined();
    expect(visit.cookie).not.toBe(oldCookie);

    const afterRotation = await serve('new-secret');
    expect((await afterRotation('/me', visit.cookie)).user).toBe('usr1');
    // A cookie that never came back during the rotation still carries the old signature.
    expect((await afterRotation('/me', oldCookie)).user).toBe('');
  });

  it('re-signs a cookie once: responses to the new signature carry no Set-Cookie', async () => {
    const rotating = await serve('new-secret', 'old-secret');
    const { cookie: resigned } = await rotating('/me', await signInBeforeRotation());

    const visit = await rotating('/me', resigned);
    expect(visit.user).toBe('usr1');
    expect(visit.cookies).toEqual([]);
  });

  it('does not write the store to re-sign a cookie', async () => {
    const oldCookie = await signInBeforeRotation();
    const rotating = await serve('new-secret', 'old-secret');
    const set = vi.spyOn(store, 'set');

    expect((await rotating('/me', oldCookie)).cookie).toBeDefined();
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it('does not send the session cookie back when signing out during a rotation', async () => {
    const rotating = await serve('new-secret', 'old-secret');
    const signOut = await rotating('/logout', await signInBeforeRotation());
    expect(signOut.cookies).toEqual([`${AUTH_SESSION_COOKIE_NAME}=`]);
  });

  it('keeps re-signed sessions when a rotation is rolled back by swapping the two values', async () => {
    const rotating = await serve('new-secret', 'old-secret');
    const { cookie: resigned } = await rotating('/me', await signInBeforeRotation());

    const rolledBack = await serve('old-secret', 'new-secret');
    const visit = await rolledBack('/me', resigned);
    expect(visit.user).toBe('usr1');
    expect(visit.cookie).toBeDefined();
  });

  it('sets the cookie only at sign-in outside a rotation', async () => {
    const current = await serve('new-secret');
    const { cookie } = await current('/login');
    expect(cookie).toBeDefined();

    const visit = await current('/me', cookie);
    expect(visit.user).toBe('usr1');
    expect(visit.cookies).toEqual([]);
  });
});
