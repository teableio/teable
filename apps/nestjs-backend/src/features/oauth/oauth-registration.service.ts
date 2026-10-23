import { Injectable, Logger } from '@nestjs/common';
import { generateClientId, HttpErrorCode, mcpOAuthScopes, SYSTEM_USER_ID } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import ms from 'ms';
import { CacheService } from '../../cache/cache.service';
import { IOAuthConfig, OAuthConfig } from '../../configs/oauth.config';
import { CustomHttpException } from '../../custom.exception';
import { second } from '../../utils/second';
import { createOAuthSecret } from './oauth-secret';

/** RFC 7591 §3.2.2 error codes this server can answer with. */
export class ClientRegistrationError extends Error {
  constructor(
    readonly rfcError: 'invalid_redirect_uri' | 'invalid_client_metadata',
    message: string
  ) {
    super(message);
  }
}

/* eslint-disable @typescript-eslint/naming-convention */
/** Wire format of RFC 7591; snake_case on purpose. Everything is optional but redirect_uris. */
export interface IClientRegistrationRequest {
  redirect_uris?: unknown;
  client_name?: unknown;
  client_uri?: unknown;
  scope?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
}

export interface IClientRegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  client_name: string;
  client_uri?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: ITokenEndpointAuthMethod;
  grant_types: string[];
  response_types: string[];
  scope: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

type ITokenEndpointAuthMethod = 'none' | 'client_secret_post';

const MAX_REDIRECT_URIS = 10;
const MAX_NAME_LENGTH = 100;
const MAX_URI_LENGTH = 2048;
const DEFAULT_CLIENT_NAME = 'OAuth client';
const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const SUPPORTED_RESPONSE_TYPES = ['code'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'blob:',
  'vbscript:',
  'about:',
  'ftp:',
  'mailto:',
  'tel:',
  'sms:',
  'intent:',
  'ms-msdt:',
  'chrome:',
]);

/**
 * Dynamic client registration (RFC 7591).
 *
 * MCP clients (Claude Code, claude.ai, Cursor, VS Code, ChatGPT) register
 * themselves here on first connect instead of a developer creating an OAuth app
 * for each of them. Native clients register as public clients (`none`, no
 * secret); a server-side client such as claude.ai asks for
 * `client_secret_post` and gets a secret. Either way authorize requires PKCE
 * from a self-registered client, so a secret adds to PKCE rather than
 * replacing it. The row is a regular `oauth_app` flagged
 * `dynamicRegistration`, so the rest of the OAuth server (authorize, consent,
 * token, refresh, revoke, authorized-apps list) needs no special case.
 */
@Injectable()
export class OAuthRegistrationService {
  private readonly logger = new Logger(OAuthRegistrationService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    @OAuthConfig() private readonly oauth2Config: IOAuthConfig
  ) {}

  async register(
    body: IClientRegistrationRequest,
    ip: string
  ): Promise<IClientRegistrationResponse> {
    await this.checkRateLimit(ip);
    const metadata = this.validate(body);
    await this.pruneAbandonedClients();

    const clientId = generateClientId();
    // Claude Code registers as "Claude Code (<server alias the user typed>)";
    // the alias is noise next to our own product name on the consent page
    // and in the authorized-apps list. Keep the full name as the description.
    const displayName = metadata.clientName.replace(/\s*\([^()]*\)\s*$/, '').trim();
    const name = displayName || metadata.clientName;
    const issued =
      metadata.authMethod === 'client_secret_post' ? await createOAuthSecret() : undefined;
    const created = await this.prismaService.oAuthApp.create({
      data: {
        clientId,
        name,
        description: name === metadata.clientName ? undefined : metadata.clientName,
        homepage: metadata.clientUri ?? '',
        redirectUris: JSON.stringify(metadata.redirectUris),
        scopes: JSON.stringify(metadata.scopes),
        allowDeviceFlow: false,
        dynamicRegistration: true,
        createdBy: SYSTEM_USER_ID,
        ...(issued
          ? {
              secrets: {
                create: {
                  secret: issued.hashedSecret,
                  maskedSecret: issued.maskedSecret,
                  createdBy: SYSTEM_USER_ID,
                },
              },
            }
          : {}),
      },
      select: { createdTime: true },
    });
    this.logger.log(
      `Registered dynamic OAuth client ${clientId} (${name}, ${metadata.authMethod}) for ${metadata.redirectUris.join(', ')}`
    );

    /* eslint-disable @typescript-eslint/naming-convention */
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(created.createdTime.getTime() / 1000),
      // 0: the secret does not expire (RFC 7591 §3.2.1).
      ...(issued ? { client_secret: issued.secret, client_secret_expires_at: 0 } : {}),
      client_name: metadata.clientName,
      ...(metadata.clientUri ? { client_uri: metadata.clientUri } : {}),
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: metadata.authMethod,
      grant_types: SUPPORTED_GRANT_TYPES,
      response_types: SUPPORTED_RESPONSE_TYPES,
      scope: metadata.scopes.join(' '),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  /** Nobody is authenticated here, so the only handle is the caller's address. */
  private async checkRateLimit(ip: string) {
    const { registrationRateLimit, tokenRateWindow } = this.oauth2Config;
    if (registrationRateLimit <= 0) {
      return;
    }
    const count = await this.cacheService.incr(
      `oauth:register-rate:${ip}`,
      second(tokenRateWindow)
    );
    if (count > registrationRateLimit) {
      this.logger.warn(
        `Client registration rate limit exceeded for ${ip}: ${count}/${registrationRateLimit}`
      );
      throw new CustomHttpException(
        'Client registration rate limit exceeded, please try again later',
        HttpErrorCode.TOO_MANY_REQUESTS
      );
    }
  }

  /**
   * A registration that never turned into an authorization is just a row an
   * anonymous caller made us write. Drop those past the retention window; an
   * app someone did authorize keeps its tokens and stays.
   */
  private async pruneAbandonedClients() {
    const retention = ms(this.oauth2Config.dynamicClientRetention);
    if (!retention || retention <= 0) {
      return;
    }
    const { count } = await this.prismaService.oAuthApp.deleteMany({
      where: {
        dynamicRegistration: true,
        createdTime: { lt: new Date(Date.now() - retention) },
        authorized: { none: {} },
        tokens: { none: {} },
      },
    });
    if (count > 0) {
      this.logger.log(`Pruned ${count} abandoned dynamic OAuth client(s)`);
    }
  }

  private validate(body: IClientRegistrationRequest) {
    const redirectUris = this.validateRedirectUris(body.redirect_uris);
    const clientName = this.validateName(body.client_name);
    const clientUri = this.validateClientUri(body.client_uri);
    const scopes = this.validateScopes(body.scope);
    const authMethod = this.validateAuthMethod(body.token_endpoint_auth_method);
    this.validateGrantTypes(body.grant_types);
    this.validateResponseTypes(body.response_types);
    return { redirectUris, clientName, clientUri, scopes, authMethod };
  }

  private validateRedirectUris(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new ClientRegistrationError(
        'invalid_redirect_uri',
        'redirect_uris must be a non-empty array'
      );
    }
    if (value.length > MAX_REDIRECT_URIS) {
      throw new ClientRegistrationError(
        'invalid_redirect_uri',
        `at most ${MAX_REDIRECT_URIS} redirect_uris are allowed`
      );
    }
    return value.map((uri) => this.validateRedirectUri(uri));
  }

  /**
   * RFC 8252: https for web clients, http only on the loopback interface, and
   * private-use schemes (`cursor://…`, `vscode://…`) for native apps.
   */
  private validateRedirectUri(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ClientRegistrationError('invalid_redirect_uri', 'redirect_uris must be strings');
    }
    if (value.length > MAX_URI_LENGTH) {
      throw new ClientRegistrationError('invalid_redirect_uri', 'redirect_uri is too long');
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ClientRegistrationError(
        'invalid_redirect_uri',
        `redirect_uri is not an absolute URL: ${value}`
      );
    }
    if (url.hash || value.includes('#')) {
      throw new ClientRegistrationError(
        'invalid_redirect_uri',
        `redirect_uri must not contain a fragment: ${value}`
      );
    }
    if (url.username || url.password) {
      // `https://app.teable.ai@evil.example/cb` reads like us on the consent page.
      throw new ClientRegistrationError(
        'invalid_redirect_uri',
        `redirect_uri must not carry credentials: ${value}`
      );
    }
    if (FORBIDDEN_SCHEMES.has(url.protocol)) {
      throw new ClientRegistrationError(
        'invalid_redirect_uri',
        `redirect_uri scheme is not allowed: ${value}`
      );
    }
    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
      throw new ClientRegistrationError(
        'invalid_redirect_uri',
        `http redirect_uri is only allowed on the loopback interface: ${value}`
      );
    }
    return value;
  }

  private validateName(value: unknown): string {
    if (value === undefined || value === null) {
      return DEFAULT_CLIENT_NAME;
    }
    if (typeof value !== 'string') {
      throw new ClientRegistrationError('invalid_client_metadata', 'client_name must be a string');
    }
    const name = value.trim();
    if (!name) {
      return DEFAULT_CLIENT_NAME;
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        `client_name must be at most ${MAX_NAME_LENGTH} characters`
      );
    }
    return name;
  }

  private validateClientUri(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value !== 'string' || value.length > MAX_URI_LENGTH) {
      throw new ClientRegistrationError('invalid_client_metadata', 'client_uri must be a string');
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('scheme');
      }
    } catch {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        `client_uri must be an http(s) URL: ${value}`
      );
    }
    return value;
  }

  private validateScopes(value: unknown): string[] {
    if (value === undefined || value === null || value === '') {
      return [...mcpOAuthScopes];
    }
    if (typeof value !== 'string') {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        'scope must be a space-delimited string'
      );
    }
    const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
    // Self-registered clients never get the user-level scopes (stored
    // integration credentials, notifications, …); only the MCP set.
    const unknown = scopes.filter((scope) => !(mcpOAuthScopes as string[]).includes(scope));
    if (unknown.length > 0) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        `unknown scope: ${unknown.join(', ')}`
      );
    }
    return scopes.length > 0 ? scopes : [...mcpOAuthScopes];
  }

  /**
   * The methods the token endpoint takes from a self-registered client: no
   * secret, or the secret in the request body. RFC 7591 defaults an absent
   * value to `client_secret_basic`, which the token endpoint cannot read, so
   * absent registers as public like every MCP client expects.
   */
  private validateAuthMethod(value: unknown): ITokenEndpointAuthMethod {
    if (value === undefined || value === null || value === 'none') {
      return 'none';
    }
    if (value === 'client_secret_post') {
      return value;
    }
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'token_endpoint_auth_method must be "none" or "client_secret_post"'
    );
  }

  private validateGrantTypes(value: unknown) {
    if (value === undefined || value === null) {
      return;
    }
    if (!Array.isArray(value) || value.some((type) => typeof type !== 'string')) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        'grant_types must be an array of strings'
      );
    }
    const unsupported = value.filter((type) => !SUPPORTED_GRANT_TYPES.includes(type));
    if (unsupported.length > 0) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        `unsupported grant_types: ${unsupported.join(', ')}`
      );
    }
    if (!value.includes('authorization_code')) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        'grant_types must include authorization_code'
      );
    }
  }

  private validateResponseTypes(value: unknown) {
    if (value === undefined || value === null) {
      return;
    }
    if (!Array.isArray(value) || value.some((type) => !SUPPORTED_RESPONSE_TYPES.includes(type))) {
      throw new ClientRegistrationError(
        'invalid_client_metadata',
        'response_types must be ["code"]'
      );
    }
  }
}
