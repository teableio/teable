import type { IUserMeVo } from '@teable/openapi';
import type { OAuth2Server } from 'oauth2orize';

export interface IClientBase {
  clientId: string;
}

export interface IAuthorizeClient extends IClientBase {
  isTrusted?: boolean;
  scopes: string[];
  redirectUri: string;
}

export interface IExchangeClient extends IClientBase {
  name: string;
  secretId: string;
  clientSecret: string;
}

export type IOAuth2Server<Client = IClientBase, User = IUserMeVo> = OAuth2Server<Client, User>;

export interface IOAuthStoreOption {
  transactionField?: string;
}
