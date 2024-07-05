import { BadRequestException, Injectable } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import type { IUserMeVo } from '@teable/openapi';
import type { Request } from 'express';
import type { OAuth2, OAuth2Req } from 'oauth2orize';
import { CacheService } from '../../cache/cache.service';
import { IOAuthConfig, OAuthConfig } from '../../configs/oauth.config';
import type { IAuthorizeClient } from './types';

@Injectable()
export class OAuthTxStore {
  constructor(
    private readonly cacheService: CacheService,
    @OAuthConfig() private readonly oauth2Config: IOAuthConfig
  ) {}

  async load(req: Request, cb: (err: unknown, txn?: OAuth2<IAuthorizeClient, IUserMeVo>) => void) {
    const transactionID = req.body?.['transaction_id'];
    if (!transactionID) {
      return cb(new BadRequestException('transaction_id is required'));
    }

    const txnStore = await this.cacheService.get(`oauth:txn:${transactionID}`);
    if (!txnStore) {
      return cb(new BadRequestException('Invalid transaction ID'));
    }
    const user = req.user as IUserMeVo;
    if (txnStore.userId !== user.id) {
      return cb(new BadRequestException('Invalid user'));
    }
    cb(null, {
      transactionID,
      redirectURI: txnStore.redirectURI,
      client: {
        clientId: txnStore.clientId,
        redirectUri: txnStore.redirectURI,
        scopes: txnStore.scopes,
      },
      req: {
        clientID: txnStore.clientId,
        transactionID,
        type: txnStore.type,
        scope: txnStore.scopes,
        state: txnStore.state!,
        redirectURI: txnStore.redirectURI,
      },
      user,
      info: {
        scope: txnStore.scopes.join(' '),
      },
    });
  }

  async store(
    req: Request,
    txn: {
      client: IAuthorizeClient;
      redirectURI: string;
      req: OAuth2Req;
    },
    cb: (err: unknown, transactionID: string) => void
  ) {
    const transactionID = getRandomString(16);
    const { redirectURI, client } = txn;

    await this.cacheService.set(
      `oauth:txn:${transactionID}`,
      {
        clientId: client.clientId,
        redirectURI,
        type: txn.req.type,
        scopes: txn.client.scopes,
        state: txn.req.state,
        userId: (req.user as IUserMeVo).id,
      },
      this.oauth2Config.transactionExpireIn
    );

    cb(null, transactionID);
  }

  async remove(_req: unknown, transactionID: string) {
    await this.cacheService.del(`oauth:txn:${transactionID}`);
  }
}
