/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DeserializeUserFunction } from 'passport';
import { Strategy } from 'passport';
import { splitAccessToken } from '../../access-token/access-token.encryptor';
import { ACCESS_TOKEN_STRATEGY_NAME } from './constant';
import type { IFromExtractor } from './types';

interface IAccessTokenStrategyOptions {
  accessTokenFromRequest?: IFromExtractor;
}

export class PassportAccessTokenStrategy extends Strategy {
  public name: string;
  private accessTokenFromRequest?: IFromExtractor;
  private _deserializeUser: DeserializeUserFunction;

  constructor(options?: IAccessTokenStrategyOptions, deserializeUser?: DeserializeUserFunction) {
    super();
    this.name = ACCESS_TOKEN_STRATEGY_NAME;
    this.accessTokenFromRequest = options?.accessTokenFromRequest;
    this._deserializeUser = deserializeUser!;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  authenticate(req: any): void {
    const { success, fail } = this;
    const accessToken = this?.accessTokenFromRequest?.(req);
    if (!accessToken) {
      fail('No access token');
      return;
    }
    const accessTokenObj = splitAccessToken(accessToken);
    if (!accessTokenObj) {
      fail('Invalid access token');
      return;
    }
    this._deserializeUser(accessTokenObj, req, function (err, user) {
      if (err) {
        return fail(err);
      }
      if (!user) {
        fail('No user found');
      } else {
        success(user);
      }
    });
  }
}
