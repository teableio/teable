import type { IUserMeVo } from '@teable/openapi';
import type { OAuth2Req, OAuth2Server } from 'oauth2orize';

export interface IClientBase {
  clientId: string;
}

export interface IAuthorizeClient extends IClientBase {
  isTrusted?: boolean;
  scopes: string[];
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
}

export interface IExchangeClient extends IClientBase {
  type: 'secret';
  name: string;
  secretId: string;
  clientSecret: string;
}

export interface IPkceExchangeClient extends IClientBase {
  type: 'pkce';
  name: string;
  secretId?: string;
  codeVerifier?: string;
}

export type ITokenClient = IExchangeClient | IPkceExchangeClient;

export type IOAuth2Server<Client = IClientBase, User = IUserMeVo> = OAuth2Server<Client, User>;

export interface IOAuthStoreOption {
  transactionField?: string;
}

export interface IClient {
  type: string;
  clientID: string;
  redirectURI: string;
  scope: string[];
  state?: string;
}

export interface IAuthorizeRequest extends OAuth2Req {
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
}
