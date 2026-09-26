/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { INotificationBuffer } from '@teable/core';
import { getUserNotificationChannel } from '@teable/core';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import WebSocket from 'ws';
import { ShareDbService } from '../src/share-db/share-db.service';
import { initApp } from './utils/init-app';

const deniedMessage = 'Notification presence is readable by its own user only';

/**
 * A browser's realtime connection: SockJS framing over a real websocket, the browser's cookie
 * on the upgrade request. In-process connections (`shareDbService.connect`) are trusted by the
 * server, so they cannot stand in for a browser here.
 */
const openBrowserSocket = (port: string, cookie?: string) =>
  new Promise<{ socket: Socket; ws: WebSocket }>((resolve, reject) => {
    const sessionId = Math.random().toString(36).slice(2);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket/000/${sessionId}/websocket`, {
      headers: cookie ? { cookie } : {},
    });
    const socket: any = {
      readyState: 0,
      send: (data: string) => ws.send(JSON.stringify([data])),
      close: () => ws.close(),
    };
    ws.on('message', (raw) => {
      const frame = raw.toString();
      if (frame === 'o') {
        socket.readyState = 1;
        resolve({ socket, ws });
      } else if (frame.startsWith('a')) {
        for (const data of JSON.parse(frame.slice(1))) socket.onmessage?.({ data });
      }
    });
    ws.on('close', (code, reason) => {
      socket.readyState = 3;
      socket.onclose?.({ code, reason: reason.toString() });
    });
    ws.on('error', reject);
  });

/** Resolves the server's refusal, if any. */
const subscribe = (connection: Connection, channel: string) =>
  new Promise<string | undefined>((resolve) => {
    connection.getPresence(channel).subscribe((error) => resolve(error?.message));
  });

describe('Notification presence over a browser connection (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let port: string;
  let shareDbService: ShareDbService;
  const userId = globalThis.testConfig.userId;
  const sockets: WebSocket[] = [];

  const connect = async (withCookie?: string) => {
    const { socket, ws } = await openBrowserSocket(port, withCookie);
    sockets.push(ws);
    return new Connection(socket);
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    sockets.forEach((ws) => ws.close());
    await app.close();
  });

  it('delivers notifications to a signed-in browser', async () => {
    const connection = await connect(cookie);
    const channel = getUserNotificationChannel(userId);

    expect(await subscribe(connection, channel)).toBeUndefined();

    const received = new Promise<INotificationBuffer>((resolve) =>
      connection.getPresence(channel).on('receive', (_id, value) => resolve(value))
    );
    const notification = { notification: { id: 'ntfPresenceE2e' }, unreadCount: 1 } as any;
    shareDbService.connect().getPresence(channel).create('ntfPresenceE2e').submit(notification);

    expect(await received).toEqual(notification);
  });

  it("keeps a browser off another user's notifications", async () => {
    const signedIn = await connect(cookie);
    const anonymous = await connect();

    expect(await subscribe(signedIn, getUserNotificationChannel('usrSomeoneElse'))).toBe(
      deniedMessage
    );
    expect(await subscribe(anonymous, getUserNotificationChannel(userId))).toBe(deniedMessage);
  });
});
