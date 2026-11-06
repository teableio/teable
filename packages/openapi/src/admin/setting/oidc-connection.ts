import type { IAppAuthConfig } from './update';

export const DEFAULT_OIDC_SCOPE = 'openid email profile';

export interface IOidcConnection {
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

/** The instance OIDC provider for app sign-in, or undefined until every endpoint field is filled in. */
export function resolveOidcConnection(
  appAuth: IAppAuthConfig | null | undefined
): IOidcConnection | undefined {
  const oidc = appAuth?.oidc;
  if (!oidc) return undefined;
  const authorizationUrl = oidc.authorizationUrl?.trim();
  const tokenUrl = oidc.tokenUrl?.trim();
  const userInfoUrl = oidc.userInfoUrl?.trim();
  const clientId = oidc.clientId?.trim();
  const clientSecret = oidc.clientSecret;
  if (!authorizationUrl || !tokenUrl || !userInfoUrl || !clientId || !clientSecret) {
    return undefined;
  }
  return {
    authorizationUrl,
    tokenUrl,
    userInfoUrl,
    clientId,
    clientSecret,
    scope: oidc.scope?.trim() || DEFAULT_OIDC_SCOPE,
  };
}
