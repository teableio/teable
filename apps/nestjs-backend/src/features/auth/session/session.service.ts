/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import type { SessionData } from 'express-session';
import { Store } from 'express-session';
import ms from 'ms';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';

@Injectable()
export class SessionStoreService extends Store {
  private readonly ttl: number;

  constructor(
    private readonly cacheService: CacheService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {
    super();
    this.ttl = Math.floor(ms(this.authConfig.session.expiresIn) / 1000);
  }

  async get(
    sid: string,
    callback: (err: unknown, session?: SessionData | null | undefined) => void
  ): Promise<void> {
    try {
      const session = await this.cacheService.get(`auth:session-store:${sid}`);
      callback(null, session);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid: string, session: SessionData, callback?: ((err?: unknown) => void) | undefined) {
    try {
      await this.cacheService.set(`auth:session-store:${sid}`, session, this.ttl);
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

  async touch(sid: string, session: SessionData, callback?: ((err?: unknown) => void) | undefined) {
    try {
      await this.set(sid, session, callback);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
}
