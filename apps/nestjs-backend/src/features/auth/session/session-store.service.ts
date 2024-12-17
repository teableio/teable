/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { Store } from 'express-session';
import { pick } from 'lodash';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import type { ISessionData } from '../../../types/session';
import { second } from '../../../utils/second';

const SESSION_STORE_KEYS = ['passport', 'cookie'] as const;

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
      this.logger.log(`Session ${sid} not found in userSessions`);
      await this.cacheService.del(`auth:session-store:${sid}`);
      return null;
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

  async get(
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

  async set(sid: string, session: ISessionData, callback?: ((err?: unknown) => void) | undefined) {
    try {
      // Avoid redundant keys on req.session objects
      await this.setCache(sid, pick(session, SESSION_STORE_KEYS));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async destroy(sid: string, callback?: ((err?: unknown) => void) | undefined) {
    try {
      await this.cacheService.del(`auth:session-store:${sid}`);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async touch(
    sid: string,
    session: ISessionData,
    callback?: ((err?: unknown) => void) | undefined
  ) {
    try {
      const sessionCache = await this.getCache(sid);
      if (sessionCache) {
        await this.setCache(sid, session);
        callback?.();
        return;
      }
      callback?.(new Error('Session not found'));
    } catch (error) {
      callback?.(error);
    }
  }

  async clearByUserId(userId: string) {
    const userSessions = (await this.cacheService.get(`auth:session-user:${userId}`)) ?? {};
    for (const sid of Object.keys(userSessions)) {
      // Preventing competition
      await this.cacheService.set(`auth:session-expire:${sid}`, true, 60);
      await this.cacheService.del(`auth:session-store:${sid}`);
    }
    await this.cacheService.del(`auth:session-user:${userId}`);
  }
}
