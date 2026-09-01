import { Injectable } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import type { IOauth2State } from '../../../cache/types';
import type { IClsStore } from '../../../types/cls';
import { second } from '../../../utils/second';

@Injectable()
export class OauthStoreService {
  key: string = 'oauth2:';

  constructor(
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async store(req: Request, callback: (err: unknown, stateId: string) => void, ...args: unknown[]) {
    if (args.length === 3 && typeof args[2] === 'function') {
      callback = args[2] as (err: unknown, stateId: string) => void;
    }
    const random = getRandomString(16);
    await this.cacheService.set(
      `oauth2:${random}`,
      {
        redirectUri: req.query.redirect_uri as string,
      },
      second('12h')
    );
    callback(null, random);
  }

  async verify(
    _req: unknown,
    stateId: string,
    callback: (err: unknown, ok: boolean, state: IOauth2State | string) => void
  ) {
    const state = await this.cacheService.get(`oauth2:${stateId}`);
    if (state) {
      await this.cacheService.del(`oauth2:${stateId}`);
      // The login destination is the only signup-time trace of a link-invite
      // flow on OAuth paths; best-effort, never fails a login.
      try {
        if (state.redirectUri) {
          this.cls.set('oauthRedirectUri', state.redirectUri);
        }
      } catch {
        // outside a CLS context (non-HTTP caller) — nothing to stash.
      }
      callback(null, true, state);
    } else {
      callback(null, false, 'Invalid authorization request state');
    }
  }
}
