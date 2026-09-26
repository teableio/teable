/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { HttpError, NotificationStatesEnum, NotificationTypeEnum } from '@teable/core';
import {
  createAccessToken,
  generateOAuthSecret,
  oauthCreate,
  oauthDelete,
  urlBuilder,
  UPDATE_AUTHORIZED_NOTIFICATIONS,
} from '@teable/openapi';
import type { INotificationVo, OAuthCreateVo } from '@teable/openapi';
import type { AxiosInstance, AxiosResponse } from 'axios';
import axiosInstance from 'axios';
import { APP_NOTIFY_LIMIT_PER_USER } from '../src/features/notification/app-notification.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const APP_ORIGIN = 'https://forum.example.com';

describe('OAuth apps notifying their users (e2e)', () => {
  let app: INestApplication;
  let appUrl: string;
  // the user who authorizes the apps, and so receives their notifications
  let user: AxiosInstance;
  let anonymous: AxiosInstance;
  const created: string[] = [];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    const newUser = await createNewUserAxios({
      email: `app-notify+${Date.now()}@example.com`,
      password: '12345678',
    });
    const rejectAsHttpError = (error: { response?: AxiosResponse; message?: string }) => {
      const { data, status, headers } = error?.response || {};
      const httpError = new HttpError(data || error?.message || 'no response', status || 500);
      Object.assign(httpError, { headers });
      throw httpError;
    };
    user = axiosInstance.create({
      baseURL: `${appUrl}/api`,
      headers: { cookie: newUser.defaults.headers.Cookie },
      validateStatus: (status) => (status >= 200 && status < 209) || status === 302,
    });
    user.interceptors.response.use((res) => res, rejectAsHttpError);
    anonymous = axiosInstance.create({ baseURL: `${appUrl}/api` });
    anonymous.interceptors.response.use((res) => res, rejectAsHttpError);
  });

  afterAll(async () => {
    for (const clientId of created) {
      await oauthDelete(clientId).catch(() => undefined);
    }
    await app.close();
  });

  const createApp = async (scopes: string[], name = 'Forum') => {
    const res = await oauthCreate({
      name,
      homepage: APP_ORIGIN,
      redirectUris: [`${APP_ORIGIN}/auth/callback`],
      scopes,
      logo: 'logo/app-notify-e2e',
    });
    created.push(res.data.clientId);
    return res.data;
  };

  // The user signs in to the app; the app gets an access token for them.
  const tokenFor = async (oauth: OAuthCreateVo) => {
    const authorize = await user.get(
      `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&scope=${oauth.scopes!.join(' ')}`,
      { maxRedirects: 0 }
    );
    const transactionId = new URL(authorize.headers.location, APP_ORIGIN).searchParams.get(
      'transaction_id'
    );
    const decision = await user.post(
      '/oauth/decision',
      new URLSearchParams({ transaction_id: transactionId! }),
      { maxRedirects: 0, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const code = new URL(decision.headers.location).searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);
    const token = await anonymous.post(
      '/oauth/access_token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return token.data.access_token as string;
  };

  const notify = (token: string, body: Record<string, unknown>) =>
    anonymous.post('/notifications', body, { headers: { Authorization: `Bearer ${token}` } });

  const unread = async () =>
    (
      await user.get<INotificationVo>('/notifications', {
        params: { notifyStates: NotificationStatesEnum.Unread },
      })
    ).data.notifications;

  it('lands once in the bell, under the app name and logo, linking to the app', async () => {
    const forum = await createApp(['user|notifications_send']);
    const token = await tokenFor(forum);
    const body = {
      externalId: 'forum-notification-1',
      text: 'Ada replied in <Linking tables>',
      url: `${APP_ORIGIN}/t/linking-tables/42/3`,
    };

    const first = await notify(token, body);
    expect(first.status).toBe(201);
    expect(first.data).toEqual({ status: 'created' });
    expect((await notify(token, body)).data).toEqual({ status: 'duplicate' });

    const mine = (await unread()).filter((n) => n.url === body.url);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toMatch(/^not[0-9a-zA-Z]{16}$/);
    expect(mine[0]).toMatchObject({
      notifyType: NotificationTypeEnum.OAuthApp,
      message: 'From Forum: Ada replied in &lt;Linking tables&gt;',
    });
    expect(mine[0].notifyIcon).toEqual({ iconUrl: expect.stringContaining('logo/app-notify-e2e') });
    expect(JSON.parse(mine[0].messageI18n!)).toEqual({
      i18nKey: 'notification.oauthApp.message',
      context: { app: 'Forum', text: 'Ada replied in &lt;Linking tables&gt;' },
    });
  });

  it('keeps each app to its own ids', async () => {
    const [one, two] = [
      await createApp(['user|notifications_send'], 'One'),
      await createApp(['user|notifications_send'], 'Two'),
    ];
    const body = { externalId: 'same-id', text: 'hello' };
    expect((await notify(await tokenFor(one), body)).data).toEqual({ status: 'created' });
    expect((await notify(await tokenFor(two), body)).data).toEqual({ status: 'created' });
  });

  it('links only to the app’s own site, over https', async () => {
    const token = await tokenFor(await createApp(['user|notifications_send']));
    for (const url of [
      'https://phishing.example.net/login',
      'http://forum.example.com/t/1',
      // the host is the app's, but the address reads as someone else's
      'https://evil.example.net@forum.example.com/',
    ]) {
      const error = await getError(() => notify(token, { externalId: 'x', text: 'hi', url }));
      expect(error?.status).toBe(400);
    }
    const tooLong = await getError(() =>
      notify(token, { externalId: 'long', text: 'x'.repeat(501) })
    );
    expect(tooLong?.status).toBe(400);
  });

  it('drops what a muted app sends, and delivers again once unmuted', async () => {
    const forum = await createApp(['user|notifications_send']);
    const token = await tokenFor(forum);
    const mute = (muted: boolean) =>
      user.patch(urlBuilder(UPDATE_AUTHORIZED_NOTIFICATIONS, { clientId: forum.clientId }), {
        muted,
      });

    await mute(true);
    expect((await notify(token, { externalId: 'm1', text: 'quiet' })).data).toEqual({
      status: 'muted',
    });
    await mute(false);
    expect((await notify(token, { externalId: 'm1', text: 'quiet' })).data).toEqual({
      status: 'created',
    });
  });

  it('refuses a token without the scope, a personal access token, and a browser session', async () => {
    const withoutScope = await tokenFor(await createApp(['user|email_read']));
    expect(
      (await getError(() => notify(withoutScope, { externalId: 'a', text: 'hi' })))?.status
    ).toBe(403);

    const personal = await createAccessToken({
      name: 'personal',
      scopes: ['user|notifications_send'],
      expiredTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    expect(
      (await getError(() => notify(personal.data.token, { externalId: 'b', text: 'hi' })))?.status
    ).toBe(403);

    expect(
      (await getError(() => user.post('/notifications', { externalId: 'c', text: 'hi' })))?.status
    ).toBe(403);
  });

  it('answers 429 with Retry-After past the per-user limit', async () => {
    // a minute window about to turn over would reset the count mid-test
    const secondsLeft = 60 - (Math.floor(Date.now() / 1000) % 60);
    if (secondsLeft < 10) await new Promise((resolve) => setTimeout(resolve, secondsLeft * 1000));

    const token = await tokenFor(await createApp(['user|notifications_send']));
    let sent = 0;
    let limited: (HttpError & { headers?: Record<string, string> }) | undefined;
    for (let i = 0; i <= APP_NOTIFY_LIMIT_PER_USER && !limited; i++) {
      limited = await getError(() => notify(token, { externalId: `burst-${i}`, text: 'hi' }));
      if (!limited) sent++;
    }
    expect(sent).toBe(APP_NOTIFY_LIMIT_PER_USER);
    expect(limited?.status).toBe(429);
    const retryAfter = Number(limited?.headers?.['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
});
