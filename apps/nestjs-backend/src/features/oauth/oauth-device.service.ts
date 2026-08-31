import crypto from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { getRandomString, HttpErrorCode, nullsToUndefined } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { difference } from 'lodash';
import { CacheService } from '../../cache/cache.service';
import type { IOAuthDeviceState } from '../../cache/types';
import { IOAuthConfig, OAuthConfig } from '../../configs/oauth.config';
import { CustomHttpException } from '../../custom.exception';
import { DistributedLockService } from '../../distributed-lock';
import { second } from '../../utils/second';

/** Path of the page where the user types the code, resolved against this deployment. */
export const DEVICE_VERIFICATION_PATH = '/oauth/device';
export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * Consonants only, minus the ones that read as digits. A user code is read off
 * one screen and typed on another — often on a phone — so the alphabet has to
 * survive that: no 0/O, no 1/I/L, and no vowels, which keeps it from spelling
 * anything.
 */
const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ';
const USER_CODE_GROUP = 4;
const USER_CODE_GROUPS = 2;

export interface IDeviceCodeVo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface IDeviceAppVo {
  name: string;
  description?: string;
  homepage: string;
  logo?: string;
  scopes: string[];
}

/**
 * RFC 8628 §3.2: the device authorization endpoint reports failure as an
 * RFC 6749 §5.2 error object (`{error, error_description}`), not this
 * deployment's exception shape. Carries the wire `error` code; extends
 * BadRequestException so an instance that escapes the controller's mapping
 * still degrades to a plain 400.
 */
export class DeviceAuthorizationError extends BadRequestException {
  constructor(
    public readonly rfcError:
      | 'invalid_request'
      | 'invalid_client'
      | 'unauthorized_client'
      | 'invalid_scope',
    description: string
  ) {
    super(description);
  }
}

export type IDevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied' }
  | { status: 'expired' }
  | {
      status: 'approved';
      state: IOAuthDeviceState & { user: NonNullable<IOAuthDeviceState['user']> };
    };

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * For clients that cannot receive a browser redirect — a CLI on a remote host,
 * in a container, over SSH — where the loopback flow silently never completes
 * because the user's browser resolves 127.0.0.1 to their own machine. Nothing
 * has to travel back into the terminal here: the code goes the other way, and
 * the client polls until someone approves it.
 */
@Injectable()
export class OAuthDeviceService {
  private readonly logger = new Logger(OAuthDeviceService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly distributedLock: DistributedLockService,
    @OAuthConfig() private readonly oauth2Config: IOAuthConfig
  ) {}

  /**
   * Nobody has proven who they are yet at this endpoint, so the only handle to
   * limit on is the address the request came from. Each grant costs a DB read
   * plus two cache entries that live for `deviceCodeExpireIn`.
   */
  private async checkDeviceCodeRateLimit(ip: string) {
    const { deviceCodeRateLimit, tokenRateWindow } = this.oauth2Config;
    if (deviceCodeRateLimit <= 0) {
      return;
    }
    const count = await this.cacheService.incr(`oauth:device-rate:${ip}`, second(tokenRateWindow));
    if (count > deviceCodeRateLimit) {
      this.logger.warn(
        `Device code rate limit exceeded for ${ip}: ${count}/${deviceCodeRateLimit}`
      );
      throw new CustomHttpException(
        `Device code request rate limit exceeded, please try again later`,
        HttpErrorCode.TOO_MANY_REQUESTS
      );
    }
  }

  private generateUserCode(): string {
    const groups: string[] = [];
    for (let group = 0; group < USER_CODE_GROUPS; group++) {
      let chars = '';
      for (let index = 0; index < USER_CODE_GROUP; index++) {
        chars += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)];
      }
      groups.push(chars);
    }
    return groups.join('-');
  }

  /** Accepts what people actually type: lower case, spaces, missing dashes. */
  normalizeUserCode(userCode: string): string {
    const compact = userCode.toUpperCase().replace(/[^A-Z]/g, '');
    const groups: string[] = [];
    for (let index = 0; index < compact.length; index += USER_CODE_GROUP) {
      groups.push(compact.slice(index, index + USER_CODE_GROUP));
    }
    return groups.join('-');
  }

  private async getOAuthApp(clientId: string) {
    const app = await this.prismaService.txClient().oAuthApp.findUnique({ where: { clientId } });
    if (!app) {
      throw new BadRequestException('Invalid client');
    }
    return nullsToUndefined({
      ...app,
      scopes: app.scopes ? (JSON.parse(app.scopes) as string[]) : [],
    });
  }

  async requestDeviceCode(params: {
    clientId: string;
    scopes?: string[];
    /** Origin the client reached this deployment on, so the URL it prints is reachable. */
    origin: string;
    /** Address the request came from, for rate limiting an anonymous endpoint. */
    ip: string;
  }): Promise<IDeviceCodeVo> {
    await this.checkDeviceCodeRateLimit(params.ip);
    const app = await this.getOAuthApp(params.clientId).catch((error) => {
      if (error instanceof BadRequestException) {
        throw new DeviceAuthorizationError('invalid_client', 'Unknown client');
      }
      throw error;
    });
    // Per-app opt-in, like GitHub's "Enable Device Flow": any client_id can be
    // phished onto the approval page, so an app must accept that exposure
    // explicitly.
    if (!app.allowDeviceFlow) {
      throw new DeviceAuthorizationError(
        'unauthorized_client',
        'This app has not enabled the device authorization flow'
      );
    }
    const appScopes = app.scopes;

    const invalidScopes = difference(params.scopes ?? [], appScopes);
    if (invalidScopes.length > 0) {
      throw new DeviceAuthorizationError(
        'invalid_scope',
        'Invalid scopes: ' + invalidScopes.join(',')
      );
    }

    const deviceCode = getRandomString(32);
    const expiresIn = second(this.oauth2Config.deviceCodeExpireIn);

    // The user-code index is claimed with setnx: at 19^8 codes a collision is
    // nearly impossible, but overwriting on one would silently unbind someone
    // else's pending flow, so reroll instead.
    let userCode = this.generateUserCode();
    while (
      !(await this.cacheService.setnx(`oauth:device-user:${userCode}`, deviceCode, expiresIn))
    ) {
      userCode = this.generateUserCode();
    }

    const state: IOAuthDeviceState = {
      clientId: params.clientId,
      scopes: params.scopes?.length ? params.scopes : appScopes,
      userCode,
      status: 'pending',
      expiresAt: Date.now() + expiresIn * 1000,
    };
    // setDetail, not set: `set` pads the TTL by a random 20-60s, which would let
    // the code outlive the `expires_in` handed to the client.
    await this.cacheService.setDetail(`oauth:device:${deviceCode}`, state, expiresIn);

    // No `verification_uri_complete` (RFC 8628 optional): a link that carries
    // the code is the shape device-code phishing wants, and having to transcribe
    // a code from your own terminal is what makes this flow safe. Nothing here
    // needs it — a QR code would, and can add it back.
    return {
      deviceCode,
      userCode,
      verificationUri: `${params.origin}${DEVICE_VERIFICATION_PATH}`,
      expiresIn,
      interval: this.oauth2Config.deviceCodeInterval,
    };
  }

  /**
   * The opt-in is re-checked at every step after issuance, not only when the
   * codes are handed out: an owner who turns the flow off mid-campaign — the
   * realistic reason to touch the switch — must also cut off codes already in
   * flight, and the dangerous step to cut is the approval.
   */
  private async getAppIfDeviceFlowAllowed(clientId: string) {
    const app = await this.getOAuthApp(clientId);
    if (!app.allowDeviceFlow) {
      throw new ForbiddenException('This app has disabled the device authorization flow');
    }
    return app;
  }

  private async getStateByUserCode(userCode: string) {
    const deviceCode = await this.cacheService.get(
      `oauth:device-user:${this.normalizeUserCode(userCode)}`
    );
    if (!deviceCode) {
      return undefined;
    }
    const state = await this.cacheService.get(`oauth:device:${deviceCode}`);
    if (!state) {
      return undefined;
    }
    // `expiresAt` is the authoritative clock, same as in poll(): a lagging
    // cache eviction (or store()'s 1-second TTL floor) must not let the
    // approval page accept a code the token endpoint will report as expired.
    if (state.expiresAt <= Date.now()) {
      await this.forget(deviceCode, state.userCode);
      return undefined;
    }
    return { deviceCode, state };
  }

  /** What the approval page shows: which app is asking, and for what. */
  async getDeviceApp(userCode: string): Promise<IDeviceAppVo> {
    const entry = await this.getStateByUserCode(userCode);
    if (!entry) {
      throw new NotFoundException('This code has expired or does not exist');
    }
    if (entry.state.status !== 'pending') {
      throw new BadRequestException('This code has already been used');
    }
    const app = await this.getAppIfDeviceFlowAllowed(entry.state.clientId);
    return {
      name: app.name,
      description: app.description,
      homepage: app.homepage,
      logo: app.logo,
      scopes: entry.state.scopes,
    };
  }

  /**
   * The pending → approved|denied transition must happen at most once, but it
   * is a read-check-write: two concurrent decisions (double-click, two tabs)
   * would both pass the pending check and the later write would win. The lock
   * serializes them; the loser is told the code was already used, same as a
   * replay. `runExclusive` skips rather than waits, and degrades to a no-op
   * without Redis — a single-process deployment, where the window is one
   * event-loop interleaving.
   */
  async decide(params: {
    userCode: string;
    approve: boolean;
    user: { id: string; name: string; email: string };
  }): Promise<{ clientId: string }> {
    let decided: { clientId: string } | undefined;
    const ran = await this.distributedLock.runExclusive(
      `oauth-device-decide:${this.normalizeUserCode(params.userCode)}`,
      10,
      async () => {
        decided = await this.doDecide(params);
      }
    );
    if (!ran || !decided) {
      throw new BadRequestException('This code has already been used');
    }
    return decided;
  }

  private async doDecide(params: {
    userCode: string;
    approve: boolean;
    user: { id: string; name: string; email: string };
  }): Promise<{ clientId: string }> {
    const entry = await this.getStateByUserCode(params.userCode);
    if (!entry) {
      throw new NotFoundException('This code has expired or does not exist');
    }
    if (entry.state.status !== 'pending') {
      throw new BadRequestException('This code has already been used');
    }
    await this.getAppIfDeviceFlowAllowed(entry.state.clientId);

    const next: IOAuthDeviceState = {
      ...entry.state,
      status: params.approve ? 'approved' : 'denied',
      user: params.approve ? params.user : undefined,
    };
    await this.store(entry.deviceCode, next);
    return { clientId: entry.state.clientId };
  }

  /**
   * One poll from the client. Consumes the device code on success — it is
   * single-use, like an authorization code.
   */
  async poll(deviceCode: string, clientId: string): Promise<IDevicePollResult> {
    const state = await this.cacheService.get(`oauth:device:${deviceCode}`);
    if (!state || state.clientId !== clientId) {
      return { status: 'expired' };
    }

    const now = Date.now();
    if (state.expiresAt <= now) {
      await this.forget(deviceCode, state.userCode);
      return { status: 'expired' };
    }
    // Pacing lives in a side key whose TTL is the poll interval: the setnx
    // that fails is a poll arriving too soon. Kept off the state on purpose —
    // a pending poll that wrote the state back could race decide() and
    // silently roll a fresh approval back to pending.
    if (
      !(await this.cacheService.setnx(
        `oauth:device-poll:${deviceCode}`,
        now,
        this.oauth2Config.deviceCodeInterval
      ))
    ) {
      return { status: 'slow_down' };
    }

    if (state.status === 'denied') {
      await this.forget(deviceCode, state.userCode);
      return { status: 'denied' };
    }

    if (state.status === 'approved' && state.user) {
      return this.claimApproved(deviceCode, { ...state, user: state.user });
    }

    return { status: 'pending' };
  }

  /** Turn an approved state into a one-time claim the caller may mint tokens on. */
  private async claimApproved(
    deviceCode: string,
    state: IOAuthDeviceState & { user: NonNullable<IOAuthDeviceState['user']> }
  ): Promise<IDevicePollResult> {
    // Last look at the toggle before tokens are minted — one DB read per
    // successful login, not per poll. Covers the race where the approval
    // predates the owner turning the flow off (or deleting the app).
    try {
      await this.getAppIfDeviceFlowAllowed(state.clientId);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) {
        await this.forget(deviceCode, state.userCode);
        return { status: 'denied' };
      }
      // A transient failure (DB down) must not consume the approval.
      throw error;
    }
    // The delete is the claim: `del` reports whether *this* call removed the
    // entry, so of two concurrent polls only one gets to issue tokens.
    if (!(await this.cacheService.del(`oauth:device:${deviceCode}`))) {
      return { status: 'expired' };
    }
    await this.cacheService.del(`oauth:device-user:${state.userCode}`);
    return { status: 'approved', state };
  }

  /**
   * Put a claimed approval back. Token issuance can fail after `poll` has
   * consumed the code — rate limit, transient DB error — and losing the
   * approval to that would send the person through the whole flow again;
   * restoring it lets the client's next poll retry instead.
   */
  async restore(deviceCode: string, state: IOAuthDeviceState) {
    await this.store(deviceCode, state);
    await this.cacheService.setDetail(
      `oauth:device-user:${state.userCode}`,
      deviceCode,
      this.remainingTtl(state)
    );
  }

  /**
   * Rewrite the state without extending its life: an approval nobody polls for
   * has to expire on the original schedule.
   */
  private async store(deviceCode: string, state: IOAuthDeviceState) {
    await this.cacheService.setDetail(
      `oauth:device:${deviceCode}`,
      state,
      this.remainingTtl(state)
    );
  }

  private remainingTtl(state: IOAuthDeviceState): number {
    return Math.max(1, Math.ceil((state.expiresAt - Date.now()) / 1000));
  }

  private async forget(deviceCode: string, userCode: string) {
    await this.cacheService.del(`oauth:device:${deviceCode}`);
    await this.cacheService.del(`oauth:device-user:${userCode}`);
  }
}
