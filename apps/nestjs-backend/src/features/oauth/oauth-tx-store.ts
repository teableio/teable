import { Injectable } from '@nestjs/common';
import { getRandomString, HttpErrorCode } from '@teable/core';
import type { IUserMeVo } from '@teable/openapi';
import type { Request } from 'express';
import type { OAuth2, OAuth2Req } from 'oauth2orize';
import { CacheService } from '../../cache/cache.service';
import { IOAuthConfig, OAuthConfig } from '../../configs/oauth.config';
import { CustomHttpException } from '../../custom.exception';
import type { IAuthorizeClient } from './types';

/** A malformed OAuth request: the message names the offending parameter, so it is the detail. */
const invalidOAuthRequest = (message: string) =>
  new CustomHttpException(message, HttpErrorCode.VALIDATION_ERROR, {
    localization: { i18nKey: 'httpErrors.oauth.invalidRequest', context: { detail: message } },
  });

@Injectable()
export class OAuthTxStore {
  constructor(
    private readonly cacheService: CacheService,
    @OAuthConfig() private readonly oauth2Config: IOAuthConfig
  ) {}

  async load(req: Request, cb: (err: unknown, txn?: OAuth2<IAuthorizeClient, IUserMeVo>) => void) {
    const transactionID = req.body?.['transaction_id'];
    if (!transactionID) {
      return cb(
        new CustomHttpException('transaction_id is required', HttpErrorCode.VALIDATION_ERROR)
      );
    }

    const txnStore = await this.cacheService.get(`oauth:txn:${transactionID}`);
    if (!txnStore) {
      return cb(invalidOAuthRequest('Invalid transaction ID'));
    }
    const user = req.user as IUserMeVo;
    if (txnStore.userId !== user.id) {
      return cb(invalidOAuthRequest('Invalid user'));
    }
    cb(null, {
      transactionID,
      redirectURI: txnStore.redirectURI,
      client: {
        clientId: txnStore.clientId,
        redirectUri: txnStore.redirectURI,
        scopes: txnStore.scopes,
        codeChallenge: txnStore.codeChallenge,
        codeChallengeMethod: txnStore.codeChallengeMethod as 'S256',
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
        scopes: client.scopes,
        state: txn.req.state,
        userId: (req.user as IUserMeVo).id,
        codeChallenge: client.codeChallenge,
        codeChallengeMethod: client.codeChallengeMethod,
      },
      this.oauth2Config.transactionExpireIn
    );

    cb(null, transactionID);
  }

  async remove(_req: unknown, transactionID: string) {
    await this.cacheService.del(`oauth:txn:${transactionID}`);
  }
}
