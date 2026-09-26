import { getCollaboratorsChannel, getUserNotificationChannel } from '@teable/core';
import ShareDBClass from 'sharedb';
import type { Connection } from 'sharedb/lib/client';
import { describe, expect, it } from 'vitest';
import { authMiddleware } from './auth.middleware';

const createBackend = () => {
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
  authMiddleware(backend, sessions as never);
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
