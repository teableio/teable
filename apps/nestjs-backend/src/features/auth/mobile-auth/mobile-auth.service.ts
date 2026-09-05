import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ICreateMobileAuthCodeRo,
  ICreateMobileAuthCodeVo,
  ICreateMobileWebSessionCodeVo,
  IExchangeMobileAuthCodeRo,
  IUserMeVo,
} from '@teable/openapi';
import { MOBILE_AUTH_CODE_CHALLENGE_RE } from '@teable/openapi';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, type IAuthConfig } from '../../../configs/auth.config';
import { UserService } from '../../user/user.service';
import { SessionStoreService } from '../session/session-store.service';
import { pickUserMe } from '../utils';
import { hashCode, randomCode, verifyS256 } from './pkce';

const INVALID_CODE = 'Invalid or expired code';
/** Child (WebView) sessions are tracked for as long as the default session lifetime. */
const CHILD_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface IWebSessionGrant {
  user: IUserMeVo;
  /** The native session that minted the code; the WebView session is tied to it. */
  parentSessionId: string;
}

/**
 * PKCE sign-in for the native app (see `@teable/openapi` auth/mobile-auth.ts for the flow).
 * Codes are 256-bit, single-use, short-lived and stored under their hash; the exchange is
 * only accepted with the verifier the app generated, so a code observed on the way through
 * the browser (custom URL schemes are not exclusive) is worthless on its own.
 */
@Injectable()
export class MobileAuthService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly userService: UserService,
    private readonly sessionStore: SessionStoreService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {}

  async createCode(userId: string, ro: ICreateMobileAuthCodeRo): Promise<ICreateMobileAuthCodeVo> {
    if (!MOBILE_AUTH_CODE_CHALLENGE_RE.test(ro.codeChallenge)) {
      throw new BadRequestException('Invalid code_challenge');
    }
    const redirect = this.parseRedirectUri(ro.redirectUri);
    const code = randomCode();
    await this.cacheService.set(
      `auth:mobile-code:${hashCode(code)}`,
      {
        userId,
        codeChallenge: ro.codeChallenge,
        redirectUri: redirect.toString(),
        createdAt: Date.now(),
      },
      this.authConfig.mobileAuth.codeExpiresInSeconds
    );
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', ro.state);
    return { redirectUrl: redirect.toString() };
  }

  async exchange(ro: IExchangeMobileAuthCodeRo): Promise<IUserMeVo> {
    const key = `auth:mobile-code:${hashCode(ro.code)}` as const;
    const stored = await this.cacheService.get(key);
    // Atomic consume: of two concurrent requests only the one that deletes the key goes on,
    // and the code is burned even when the verifier turns out wrong (one guess per code).
    if (!stored || !(await this.cacheService.del(key))) {
      throw new BadRequestException(INVALID_CODE);
    }
    if (!verifyS256(ro.codeVerifier, stored.codeChallenge)) {
      throw new BadRequestException('Invalid code_verifier');
    }
    return this.loadUser(stored.userId);
  }

  async createWebSessionCode(
    userId: string,
    parentSessionId: string
  ): Promise<ICreateMobileWebSessionCodeVo> {
    const code = randomCode();
    await this.cacheService.set(
      `auth:mobile-web-session:${hashCode(code)}`,
      { userId, parentSessionId, createdAt: Date.now() },
      this.authConfig.mobileAuth.webSessionCodeExpiresInSeconds
    );
    return { code };
  }

  async consumeWebSessionCode(code: string): Promise<IWebSessionGrant> {
    const key = `auth:mobile-web-session:${hashCode(code)}` as const;
    const stored = await this.cacheService.get(key);
    if (!stored || !(await this.cacheService.del(key))) {
      throw new BadRequestException(INVALID_CODE);
    }
    // The native session that minted the code must still be alive.
    if (!(await this.sessionExists(stored.parentSessionId))) {
      throw new BadRequestException(INVALID_CODE);
    }
    return { user: await this.loadUser(stored.userId), parentSessionId: stored.parentSessionId };
  }

  /** Links a WebView session to the native one so signing out natively ends it as well. */
  async registerChildSession(parentSessionId: string, childSessionId: string): Promise<void> {
    const key = `auth:mobile-children:${parentSessionId}` as const;
    const children = (await this.cacheService.get(key)) ?? [];
    await this.cacheService.set(
      key,
      [...children.filter((id) => id !== childSessionId), childSessionId],
      CHILD_SESSION_TTL_SECONDS
    );
  }

  private sessionExists(sessionId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.sessionStore.get(sessionId, (error, session) => resolve(!error && Boolean(session)));
    });
  }

  private parseRedirectUri(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('Invalid redirect_uri');
    }
    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    if (!this.authConfig.mobileAuth.redirectSchemes.includes(scheme)) {
      throw new BadRequestException(`redirect_uri scheme "${scheme}" is not allowed`);
    }
    if (url.hash) {
      throw new BadRequestException('redirect_uri must not carry a fragment');
    }
    return url;
  }

  private async loadUser(userId: string): Promise<IUserMeVo> {
    const user = await this.userService.getUserById(userId);
    if (!user || user.deactivatedTime) {
      throw new BadRequestException(INVALID_CODE);
    }
    return pickUserMe(user);
  }
}
