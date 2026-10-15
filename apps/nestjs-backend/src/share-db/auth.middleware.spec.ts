/* eslint-disable @typescript-eslint/naming-convention -- HTTP header names are hyphenated */
import { getCollaboratorsChannel, getUserNotificationChannel } from '@teable/core';
import ShareDBClass from 'sharedb';
import type { Connection } from 'sharedb/lib/client';
import { describe, expect, it, vi } from 'vitest';
import { authMiddleware, isAllowedWebSocketOrigin } from './auth.middleware';

const createBackend = (publicOrigin?: string) => {
  const backend = new ShareDBClass({
    presence: true,
    doNotForwardSendPresenceErrorsToClient: true,
  });
  // The session cookie names the user directly here.
  const sessions = {
    getSessionIdFromRequest: async (req: { headers: { cookie?: string } }) =>
      req.headers.cookie?.replace('session=', ''),
    getUserId: async (sessionId: string) => sessionId,
  };
  authMiddleware(backend, sessions as never, publicOrigin);
  return backend;
};

/** A browser connection, signed in as `userId` (or anonymous). */
const connectBrowser = (backend: ShareDBClass, userId?: string): Connection => {
  const connection = backend.connect(undefined, {
    headers: { cookie: userId ? `session=${userId}` : undefined },
    url: '/socket',
  }) as Connection & { agent: { stream: { isServer: boolean } } };
  // backend.connect() is the in-process transport; mark it remote like a WebSocket client.
  connection.agent.stream.isServer = false;
  return connection;
};

const subscribe = (connection: Connection, channel: string) => {
  const presence = connection.getPresence(channel);
  return new Promise<typeof presence>((resolve, reject) =>
    presence.subscribe((error) => (error ? reject(error) : resolve(presence)))
  );
};

const submit = (connection: Connection, channel: string, id: string, value: unknown) =>
  new Promise<void>((resolve, reject) =>
    connection
      .getPresence(channel)
      .create(id)
      .submit(value, (error) => (error ? reject(error) : resolve()))
  );

describe('notification presence is private to its user', () => {
  it('lets a user subscribe to their own notifications', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, 'usrMe'), getUserNotificationChannel('usrMe'))
    ).resolves.toBeDefined();
  });

  it("refuses another user's notifications", async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, 'usrMe'), getUserNotificationChannel('usrOther'))
    ).rejects.toMatchObject({ message: expect.stringContaining('own user only') });
  });

  it('refuses anonymous connections', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend), getUserNotificationChannel('usrMe'))
    ).rejects.toBeDefined();
  });

  it('refuses a browser publishing onto a notification channel, even its own', async () => {
    const backend = createBackend();
    const channel = getUserNotificationChannel('usrMe');
    await expect(
      submit(connectBrowser(backend, 'usrMe'), channel, 'notFake', { message: 'fake' })
    ).rejects.toMatchObject({ message: expect.stringContaining('server only') });
  });

  it('delivers what the server publishes to the owner', async () => {
    const backend = createBackend();
    const channel = getUserNotificationChannel('usrMe');
    const mine = await subscribe(connectBrowser(backend, 'usrMe'), channel);
    const received = new Promise((resolve) => mine.on('receive', (_id, value) => resolve(value)));

    await submit(backend.connect(), channel, 'notReal', { message: 'hello' });
    await expect(received).resolves.toEqual({ message: 'hello' });
  });

  it('leaves other presence channels alone', async () => {
    const backend = createBackend();
    const anonymous = connectBrowser(backend);
    await expect(subscribe(anonymous, getCollaboratorsChannel('tblX'))).resolves.toBeDefined();
    await expect(
      submit(anonymous, getCollaboratorsChannel('tblX'), 'me', { name: 'x' })
    ).resolves.toBeUndefined();
  });
});

describe('websocket origin guard', () => {
  const req = (headers: Record<string, string>) => ({ headers });

  it('allows non-browser clients that send no Origin', () => {
    expect(isAllowedWebSocketOrigin(req({}), 'https://app.example.com')).toBe(true);
  });

  it('allows the configured PUBLIC_ORIGIN', () => {
    expect(
      isAllowedWebSocketOrigin(
        req({ origin: 'https://app.example.com', host: 'internal:3000' }),
        'https://app.example.com'
      )
    ).toBe(true);
  });

  it('allows the origin the request was addressed to (forwarded host + proto)', () => {
    expect(
      isAllowedWebSocketOrigin(
        req({
          origin: 'https://app.example.com',
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'app.example.com',
          'x-forwarded-proto': 'https, http',
        }),
        'http://localhost:3000'
      )
    ).toBe(true);
  });

  it('rejects a foreign origin even though the cookie would authenticate it', () => {
    expect(
      isAllowedWebSocketOrigin(
        req({ origin: 'https://evil.test', host: 'app.example.com', 'x-forwarded-proto': 'https' }),
        'https://app.example.com'
      )
    ).toBe(false);
  });

  it('connects a matching-origin browser and refuses a foreign origin end to end', async () => {
    const backend = createBackend('https://app.example.com');
    const headers = {
      host: 'app.example.com',
      'x-forwarded-proto': 'https',
      cookie: 'session=usrMe',
    };

    const good = backend.connect(undefined, {
      headers: { ...headers, origin: 'https://app.example.com' },
      url: '/socket',
    }) as Connection;
    await vi.waitFor(() => expect(good.state).toBe('connected'));

    const bad = backend.connect(undefined, {
      headers: { ...headers, origin: 'https://evil.test' },
      url: '/socket',
    }) as Connection;
    // The middleware closes the agent before the handshake completes, so the
    // client can never reach 'connected' and only the allowed agent remains.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bad.state).not.toBe('connected');
    expect((backend as unknown as { agentsCount: number }).agentsCount).toBe(1);

    good.close();
    bad.close();
  });
});
