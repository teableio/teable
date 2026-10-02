/* eslint-disable @typescript-eslint/no-explicit-any */
import url from 'node:url';
import { getUserNotificationChannel } from '@teable/core';
import type ShareDBClass from 'sharedb';
import type { SessionHandleService } from '../features/auth/session/session-handle.service';

const NOTIFICATION_CHANNEL_PREFIX = getUserNotificationChannel('');

// ShareDB presence messages: submit, subscribe, request (ask subscribers to re-send).
// Unsubscribing ('pu') needs no check.
const PRESENCE_SUBMIT = 'p';
const PRESENCE_SUBSCRIBE = 'ps';
const PRESENCE_REQUEST = 'pr';

/**
 * Presence on `__notification_user_<id>` is how a user's notifications reach their browser, so
 * only that user's own connections may listen to it, and only the server may publish on it —
 * otherwise anyone holding a user id could read their notifications, or plant fake ones.
 * Connections the server opens in-process (`isServer`) are trusted.
 */
export const checkNotificationPresence = (
  agent: { stream?: { isServer?: boolean }; custom?: { userId?: string } },
  message: { a?: string; ch?: unknown }
): Error | undefined => {
  if (typeof message?.ch !== 'string' || !message.ch.startsWith(NOTIFICATION_CHANNEL_PREFIX)) {
    return;
  }
  if (agent.stream?.isServer) return;
  const ownChannel = agent.custom?.userId && getUserNotificationChannel(agent.custom.userId);
  if (message.a === PRESENCE_SUBMIT) {
    return new Error('Notification presence is published by the server only');
  }
  if (
    (message.a === PRESENCE_SUBSCRIBE || message.a === PRESENCE_REQUEST) &&
    message.ch !== ownChannel
  ) {
    return new Error('Notification presence is readable by its own user only');
  }
};

export const authMiddleware = (
  shareDB: ShareDBClass,
  sessionHandleService?: SessionHandleService
) => {
  const runWithCls = async (context: ShareDBClass.middleware.QueryContext, callback: any) => {
    const cookie = context.agent.custom.cookie;
    const shareId = context.agent.custom.shareId;
    const baseShareId = context.agent.custom.baseShareId;
    const templateHeader = context.agent.custom.templateHeader;
    if (context.options) {
      context.options = { ...context.options, cookie, shareId, baseShareId, templateHeader };
    } else {
      context.options = { cookie, shareId, baseShareId, templateHeader };
    }
    callback();
  };

  shareDB.use('connect', async (context, callback) => {
    if (!context.req) {
      callback();
      return;
    }
    const cookie = context.req.headers.cookie;
    context.agent.custom.cookie = cookie;

    const newUrl = new url.URL(context.req.url, 'https://example.com');
    const shareId = newUrl.searchParams.get('shareId');
    const baseShareIdParam = newUrl.searchParams.get('baseShareId');
    // Only set baseShareId if explicitly provided, don't fallback to shareId
    // This allows view share (shareId only) and base share (baseShareId) to work independently
    const baseShareId = baseShareIdParam || null;
    const templateHeader = newUrl.searchParams.get('templateHeader');
    context.agent.custom.templateHeader = templateHeader;
    context.agent.custom.shareId = shareId;
    context.agent.custom.baseShareId = baseShareId;

    // The signed-in user, from the session cookie. Notification channels are authorized by it.
    if (sessionHandleService && cookie) {
      try {
        // Hand express-session the cookie alone: SockJS keeps its own session id (from the URL)
        // on `req.session`, which express-session takes for a session already loaded, so it
        // would never read the cookie and every browser connection would stay anonymous.
        const sessionId = await sessionHandleService.getSessionIdFromRequest({
          headers: { cookie },
          url: context.req.url,
        } as any);
        if (sessionId) {
          const userId = await sessionHandleService.getUserId(sessionId);
          context.agent.custom.userId = userId;
        }
      } catch {
        // The connection still opens, anonymous: it can listen to no notification channel
      }
    }

    callback();
  });

  shareDB.use('query', (context, callback) => runWithCls(context, callback));

  shareDB.use('receive', (context, callback) => {
    callback(
      checkNotificationPresence(context.agent, context.data as { a?: string; ch?: unknown })
    );
  });
};
