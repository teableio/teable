/* eslint-disable @typescript-eslint/naming-convention */
import crypto from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { CacheService } from '../../cache/cache.service';
import { ExternalOAuth2Config, type externalOAuth2Config } from './external-oauth2.config';

export interface IExternalOAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface IExternalOAuth2TestData {
  user_id: string;
  user_name: string;
  mail?: string;
  phone?: string;
  roles?: string[];
  organizations?: Array<Record<string, unknown>>;
  // OAuth2 test 接口已直接返回用户所属空间的去重结果（去重后为 string[]）
  // 新版 test 接口：每个空间带角色信息
  space_infos?: Array<{
    id: string;
    role: string;
  }>;
  [k: string]: unknown;
}

interface ITestResp {
  code: number;
  msg: string;
  data?: IExternalOAuth2TestData;
}

@Injectable()
export class ExternalOAuth2Service {
  constructor(
    @ExternalOAuth2Config() private readonly config: ConfigType<typeof externalOAuth2Config>,
    private readonly cache: CacheService
  ) {}

  private resolveRedirectUri(redirectUrl?: string) {
    const url = redirectUrl?.trim();
    if (url) return url;
    const fallback = this.config.redirectUri?.trim();
    if (fallback) return fallback;
    return '';
  }

  private stateKey(state: string) {
    return `query-params:ext_oauth2:state:${this.config.clientSecret}:${state}` as const;
  }

  private codeVerifierKey(state: string) {
    return `query-params:ext_oauth2:code_verifier:${this.config.clientSecret}:${state}` as const;
  }

  private tokenKey(accessToken: string) {
    return `query-params:ext_oauth2:token:${accessToken}` as const;
  }

  genCodeChallengeS256(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
      out += charset[bytes[i] % charset.length];
    }
    return out;
  }

  async initiate(state: string, redirectUrl?: string) {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.authUrl) {
      throw new Error('External OAuth2 config missing (clientId/clientSecret/authUrl)');
    }
    if (!state) {
      throw new Error('state is required');
    }
    const resolvedRedirectUrl = this.resolveRedirectUri(redirectUrl);
    if (!resolvedRedirectUrl) throw new Error('redirect_url is required');

    // Store state
    await this.cache.setDetail(this.stateKey(state), { state }, 7200);

    // Generate code verifier & store
    const codeVerifier = this.generateRandomString(32);
    await this.cache.setDetail(this.codeVerifierKey(state), { codeVerifier }, 7200);

    // Build auth url
    const authUrl = new URL(this.config.authUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', resolvedRedirectUrl);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', this.genCodeChallengeS256(codeVerifier));
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (this.config.scope) {
      authUrl.searchParams.set('scope', this.config.scope);
    }

    return {
      location: authUrl.toString(),
      state,
      expires_in: 7200,
      redirect_url: resolvedRedirectUrl,
    };
  }

  async exchangeCodeForToken(
    code: string,
    state: string,
    redirectUrl?: string
  ): Promise<IExternalOAuth2Token> {
    const resolvedRedirectUrl = this.resolveRedirectUri(redirectUrl);
    if (!resolvedRedirectUrl) throw new Error('redirect_url is required');
    if (!this.config.clientId || !this.config.clientSecret || !this.config.tokenUrl) {
      throw new Error('External OAuth2 config missing (clientId/clientSecret/tokenUrl)');
    }
    const cachedState = (await this.cache.get(this.stateKey(state))) as
      | { state?: string }
      | undefined;
    if (!cachedState?.state || cachedState.state !== state) {
      throw new UnauthorizedException('state expired');
    }
    const codeVerifierWrap = (await this.cache.get(this.codeVerifierKey(state))) as
      | { codeVerifier?: string }
      | undefined;
    const codeVerifier = codeVerifierWrap?.codeVerifier;
    if (!codeVerifier || typeof codeVerifier !== 'string') {
      throw new UnauthorizedException('code verifier expired');
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: resolvedRedirectUrl,
      code_verifier: String(codeVerifier),
    });

    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64'
    );
    const resp = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json',
      },
      body: params.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`token exchange failed: ${resp.status} ${text}`);
    }
    const token = (await resp.json()) as IExternalOAuth2Token;
    if (!token?.access_token) {
      throw new Error('token exchange response missing access_token');
    }

    // Cache token for refresh/try/userinfo
    await this.cache.setDetail(
      this.tokenKey(token.access_token),
      { token },
      token.expires_in || 3600
    );
    return token;
  }

  async refresh(accessToken: string): Promise<IExternalOAuth2Token> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.tokenUrl) {
      throw new Error('External OAuth2 config missing (clientId/clientSecret/tokenUrl)');
    }
    const cachedWrap = (await this.cache.get(this.tokenKey(accessToken))) as
      | { token?: IExternalOAuth2Token }
      | undefined;
    const cached = cachedWrap?.token;
    if (!cached) {
      throw new UnauthorizedException('token not found in cache');
    }
    const refreshToken = (cached as IExternalOAuth2Token).refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException('refresh_token not available');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64'
    );
    const resp = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json',
      },
      body: params.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`refresh failed: ${resp.status} ${text}`);
    }
    const token = (await resp.json()) as IExternalOAuth2Token;
    if (!token?.access_token) {
      throw new Error('refresh response missing access_token');
    }

    // Expire old token cache and save new
    await this.cache.del(this.tokenKey(accessToken));
    await this.cache.setDetail(
      this.tokenKey(token.access_token),
      { token },
      token.expires_in || 3600
    );
    return token;
  }

  async test(accessToken: string): Promise<IExternalOAuth2TestData> {
    if (!this.config.testUrl) {
      throw new Error('External OAuth2 config missing (testUrl)');
    }
    const url = new URL(this.config.testUrl);
    url.searchParams.set('access_token', accessToken);
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new UnauthorizedException(`token invalid: ${resp.status} ${text}`);
    }
    const body = (await resp.json()) as ITestResp;
    const data = body?.data;
    if (!data?.user_id) {
      throw new UnauthorizedException('token invalid (missing user_id)');
    }
    return data;
  }
}
