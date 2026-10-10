/* eslint-disable @typescript-eslint/naming-convention */
import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Store } from 'express-session';
import { pick } from 'lodash';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import type { ISessionData } from '../../../types/session';
import { second } from '../../../utils/second';

const SESSION_STORE_KEYS = ['passport', 'cookie', 'client', 'meta'] as const;

/**
 * The id a session is shown and revoked by. The raw sid is the cookie credential, so it never
 * leaves the server; a hash of it is stable per session and safe to put in responses and
 * audit rows.
 */
export const toSessionPublicId = (sid: string) =>
  createHash('sha256').update(sid).digest('hex').slice(0, 32);

export interface IUserSessionEntry {
  sid: string;
  session: ISessionData;
  /** WebView sessions the mobile app opened from this one; they are the same device. */
  childSids: string[];
}

@Injectable()
export class SessionStoreService extends Store {
  private readonly ttl: number;
  private readonly userSessionExpire: number;
  private readonly logger = new Logger(SessionStoreService.name);

  constructor(
    private readonly cacheService: CacheService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {
    super();
    this.ttl = second(this.authConfig.session.expiresIn);
    this.userSessionExpire = this.ttl + 60 * 2;
  }

  private async setCache(sid: string, session: ISessionData) {
    const userId = session.passport.user.id;
    const userSessions = (await this.cacheService.get(`auth:session-user:${userId}`)) ?? {};
    // The expiration time is greater than the session cache time,
    // so that the user session does not expire while the session is still alive.
    const nowSec = Math.floor(Date.now() / 1000);
    userSessions[sid] = nowSec + this.userSessionExpire;
    // Maintain userSession, remove expired keys
    for (const [key, value] of Object.entries(userSessions)) {
      if (value < nowSec) {
        delete userSessions[key];
      }
    }
    await this.cacheService.set(`auth:session-user:${userId}`, userSessions, this.ttl);
    await this.cacheService.set(`auth:session-store:${sid}`, session, this.ttl);
  }

  private async getCache(sid: string) {
    const expire = await this.cacheService.get(`auth:session-expire:${sid}`);
    if (expire) {
      this.logger.log(`Session ${sid} is expired`);
      return null;
    }
    const session = await this.cacheService.get(`auth:session-store:${sid}`);
    if (!session) {
      this.logger.log(`Session ${sid} not found`);
      return null;
    }
    const userId = session.passport.user.id;
    const userSessions = (await this.cacheService.get(`auth:session-user:${userId}`)) ?? {};
    if (!userSessions[sid]) {
      // The per-user map is updated with an unlocked read-modify-write, so two
      // concurrent signins/touches for the same user (multiple devices,
      // parallel e2e workers) can clobber each other's entry. A missing entry
      // therefore only means "revoked" when a clearByUserId actually happened
      // and this session predates it; otherwise repair the map instead of
      // destroying a session the user still holds.
      const clearedAtSec = await this.cacheService.get(`auth:session-user-cleared:${userId}`);
      if (clearedAtSec && this.sessionRenewedAtSec(session) <= clearedAtSec) {
        this.logger.log(`Session ${sid} not found in userSessions`);
        await this.cacheService.del(`auth:session-store:${sid}`);
        return null;
      }
      this.logger.log(`Session ${sid} restored into userSessions after a lost map update`);
      userSessions[sid] = Math.floor(Date.now() / 1000) + this.userSessionExpire;
      await this.cacheService.set(`auth:session-user:${userId}`, userSessions, this.ttl);
      return session;
    }
    // The expiration time is greater than the session cache time,
    // so that the user session does not expire while the session is still alive.
    const nowSec = Math.floor(Date.now() / 1000);
    if (userSessions[sid] < nowSec) {
      delete userSessions[sid];
      await this.cacheService.del(`auth:session-store:${sid}`);
      await this.cacheService.set(`auth:session-user:${userId}`, userSessions, this.ttl);
      this.logger.log(`Session ${sid} expired, remove from userSessions`);
      return null;
    }
    return session;
  }

  get(...args: Parameters<SessionStoreService['getAsync']>): void {
    this.getAsync(...args).catch((error) => this.logger.error(error));
  }

  async getAsync(
    sid: string,
    callback: (err: unknown, session?: ISessionData | null | undefined) => void
  ): Promise<void> {
    try {
      const session = await this.getCache(sid);
      callback(null, session);
    } catch (error) {
      callback(error);
    }
  }

  set(...args: Parameters<SessionStoreService['setAsync']>): void {
    this.setAsync(...args).catch((error) => this.logger.error(error));
  }

  async setAsync(
    sid: string,
    session: ISessionData,
    callback?: ((err?: unknown) => void) | undefined
  ) {
    try {
      // A request still in flight when its session was revoked must not write it back.
      if (await this.cacheService.get(`auth:session-expire:${sid}`)) {
        callback?.();
        return;
      }
      // Avoid redundant keys on req.session objects
      await this.setCache(sid, pick(session, SESSION_STORE_KEYS));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(...args: Parameters<SessionStoreService['destroyAsync']>): void {
    this.destroyAsync(...args).catch((error) => this.logger.error(error));
  }

  async destroyAsync(sid: string, callback?: ((err?: unknown) => void) | undefined) {
    try {
      await this.cacheService.del(`auth:session-store:${sid}`);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  touch(...args: Parameters<SessionStoreService['touchAsync']>): void {
    this.touchAsync(...args).catch((error) => this.logger.error(error));
  }

  async touchAsync(
    sid: string,
    session: ISessionData,
    callback?: ((err?: unknown) => void) | undefined
  ) {
    try {
      const sessionCache = await this.getCache(sid);
      if (sessionCache) {
        const next: ISessionData = pick(session, SESSION_STORE_KEYS);
        if (next.meta) {
          next.meta = { ...next.meta, lastActiveAt: new Date().toISOString() };
        }
        await this.setCache(sid, next);
        callback?.();
        return;
      }
      callback?.(new Error('Session not found'));
    } catch (error) {
      callback?.(error);
    }
  }

  /**
   * A session's last issue/renewal time: cookie.expires is stamped now+ttl on
   * save and on every rolling touch. Unknown expiry is treated as renewed
   * "now" so a fresh post-clear session is never mistaken for a revoked one.
   */
  private sessionRenewedAtSec(session: ISessionData): number {
    const expires = session.cookie?.expires;
    const expiresMs =
      expires instanceof Date
        ? expires.getTime()
        : expires
          ? new Date(expires).getTime()
          : Number.NaN;
    if (!Number.isFinite(expiresMs)) {
      return Math.floor(Date.now() / 1000);
    }
    return Math.floor(expiresMs / 1000) - this.ttl;
  }

  async clearByUserId(userId: string) {
    // Mark the clear before deleting anything so the getCache repair path
    // (lost-map-update recovery) cannot resurrect the sessions being revoked.
    await this.cacheService.set(
      `auth:session-user-cleared:${userId}`,
      Math.floor(Date.now() / 1000),
      this.userSessionExpire
    );
    const userSessions = (await this.cacheService.get(`auth:session-user:${userId}`)) ?? {};
    for (const sid of Object.keys(userSessions)) {
      // Preventing competition
      await this.cacheService.set(`auth:session-expire:${sid}`, true, 60);
      await this.cacheService.del(`auth:session-store:${sid}`);
    }
    await this.cacheService.del(`auth:session-user:${userId}`);
  }

  /**
   * The user's live sessions. WebView sessions the mobile app opened from a native session
   * are folded into that native session: they are the same device and die with it.
   */
  async listByUserId(userId: string): Promise<IUserSessionEntry[]> {
    const userSessions = (await this.cacheService.get(`auth:session-user:${userId}`)) ?? {};
    const nowSec = Math.floor(Date.now() / 1000);
    const sids = Object.entries(userSessions)
      .filter(([, expireSec]) => expireSec >= nowSec)
      .map(([sid]) => sid);
    if (!sids.length) return [];
    const [sessions, children] = await Promise.all([
      this.cacheService.getMany(sids.map((sid) => `auth:session-store:${sid}` as const)),
      this.cacheService.getMany(sids.map((sid) => `auth:mobile-children:${sid}` as const)),
    ]);
    const allChildSids = new Set(children.flatMap((list) => list ?? []));
    return sids.flatMap((sid, i) => {
      const session = sessions[i];
      if (!session || session.passport?.user?.id !== userId || allChildSids.has(sid)) return [];
      return [{ sid, session, childSids: children[i] ?? [] }];
    });
  }

  /** Signs one session (and the WebView sessions opened from it) out. */
  async revokeSession(userId: string, sid: string) {
    const children = (await this.cacheService.get(`auth:mobile-children:${sid}`)) ?? [];
    const revoked = [sid, ...children];
    for (const id of revoked) {
      // Tombstone first so a request still holding the session can neither read nor save it.
      await this.cacheService.set(`auth:session-expire:${id}`, true, 60);
      await this.cacheService.del(`auth:session-store:${id}`);
    }
    await this.cacheService.del(`auth:mobile-children:${sid}`);
    const userSessions = await this.cacheService.get(`auth:session-user:${userId}`);
    if (userSessions) {
      for (const id of revoked) delete userSessions[id];
      await this.cacheService.set(`auth:session-user:${userId}`, userSessions, this.ttl);
    }
  }
}
