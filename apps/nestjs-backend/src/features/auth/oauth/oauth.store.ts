import { Injectable } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import type { Request } from 'express';
import { CacheService } from '../../../cache/cache.service';
import type { IOauth2State } from '../../../cache/types';
import { second } from '../../../utils/second';

@Injectable()
export class OauthStoreService {
  key: string = 'oauth2:';

  constructor(private readonly cacheService: CacheService) {}

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
      callback(null, true, state);
    } else {
      callback(null, false, 'Invalid authorization request state');
    }
  }
}
