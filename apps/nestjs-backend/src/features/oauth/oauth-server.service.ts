import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getRandomString, HttpErrorCode, nullsToUndefined } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { DecisionInfoGetVo, IUserMeVo } from '@teable/openapi';
import type { Response, Request } from 'express';
import { difference, pick, union } from 'lodash';
import ms from 'ms';
import { ClsService } from 'nestjs-cls';
import type {
  IssueGrantCodeFunction,
  IssueExchangeCodeFunction,
  ImmediateFunction,
  ExchangeDoneFunction,
  OAuth2,
  ValidateFunctionArity2,
} from 'oauth2orize';
import oauth2orize, { AuthorizationError } from 'oauth2orize';
import { CacheService } from '../../cache/cache.service';
import type { IOAuthCodeState } from '../../cache/types';
import { IOAuthConfig, OAuthConfig } from '../../configs/oauth.config';
import { CustomHttpException } from '../../custom.exception';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { second } from '../../utils/second';
import { AccessTokenService } from '../access-token/access-token.service';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { TeableJwtService } from '../auth/jwt/teable-jwt.service';
import { DEVICE_CODE_GRANT_TYPE, OAuthDeviceService } from './oauth-device.service';
import { OAuthTxStore } from './oauth-tx-store';
import { PkceService } from './pkce.service';
import type { IAuthorizeClient, ITokenClient, IOAuth2Server, IAuthorizeRequest } from './types';

@Injectable()
export class OAuthServerService {
  private readonly logger = new Logger(OAuthServerService.name);
  server: IOAuth2Server;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly accessTokenService: AccessTokenService,
    private readonly jwtService: TeableJwtService,
    private readonly oauthTxStore: OAuthTxStore,
    private readonly pkceService: PkceService,
    private readonly deviceService: OAuthDeviceService,
    // `audit` + `cls` are the @Audit decorator's host contract (it reads
    // this.audit / this.cls) — required by the decorated touchAuthorize.
    private readonly audit: AuditScope,
    private readonly cls: ClsService<IClsStore>,
    @OAuthConfig() private readonly oauth2Config: IOAuthConfig
  ) {
    this.server = oauth2orize.createServer({
      store: this.oauthTxStore,
    });
    this.server.grant(oauth2orize.grant.code(this.codeGrant));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.server.grant(require('oauth2orize-pkce').extensions());
    this.server.exchange(oauth2orize.exchange.code(this.codeExchange));
    (this.server as unknown as IOAuth2Server<ITokenClient>).exchange(
      oauth2orize.exchange.refreshToken(this.refreshTokenExchange)
    );
    // Device grant: a plain middleware rather than an oauth2orize exchange
    // factory, because the client polls the same endpoint many times and most
    // of those calls answer with an error rather than a token.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server as any).exchange(DEVICE_CODE_GRANT_TYPE, this.deviceCodeExchange);
  }

  /**
   * The scopes the app already holds for the user, while their approval still spares them the
   * consent screen; undefined once it has lapsed. Every token an app gets for a user (code,
   * device grant, refresh) carries the scopes the user approved, and a token's row stays for
   * as long as its refresh token can be used, so the tokens of the last refresh lifetime say
   * what the app can use without asking.
   */
  private async getApprovedScopes(userId: string, clientId: string) {
    const authorized = await this.prismaService.txClient().oAuthAppAuthorized.findUnique({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        clientId_userId: {
          clientId,
          userId,
        },
      },
      select: {
        authorizedTime: true,
      },
    });
    if (
      !authorized ||
      new Date(authorized.authorizedTime).getTime() + ms(this.oauth2Config.authorizedExpireIn) <=
        Date.now()
    ) {
      return;
    }
    const tokens = await this.prismaService.txClient().accessToken.findMany({
      where: {
        clientId,
        userId,
        createdTime: { gt: new Date(Date.now() - ms(this.oauth2Config.refreshTokenExpireIn)) },
      },
      select: { scopes: true },
      distinct: ['scopes'],
    });
    return union(...tokens.map(({ scopes }) => JSON.parse(scopes) as string[]));
  }

  private handleError(error: unknown) {
    if (error instanceof AuthorizationError) {
      return new HttpException(error.message, Number(error.status));
    }
    return error;
  }

  private async checkTokenRateLimit(clientId: string, userId: string) {
    const { tokenRateLimit, tokenRateWindow } = this.oauth2Config;
    if (tokenRateLimit <= 0) {
      return;
    }
    const cacheKey = `oauth:token-rate:${clientId}:${userId}` as const;
    const count = await this.cacheService.incr(cacheKey, second(tokenRateWindow));
    if (count > tokenRateLimit) {
      this.logger.warn(
        `OAuth token rate limit exceeded for client ${clientId} user ${userId}: ${count}/${tokenRateLimit}`
      );
      throw new CustomHttpException(
        `Token request rate limit exceeded, please try again later`,
        HttpErrorCode.TOO_MANY_REQUESTS
      );
    }
  }

  private validateRedirectUri(
    redirectUri: string,
    redirectUris: string[],
    type: 'pkce' | 'secret'
  ) {
    if (
      type === 'pkce' &&
      redirectUris.some((uri) => this.pkceService.isLoopbackMatch(uri, redirectUri))
    ) {
      return;
    }
    if (type === 'secret' && redirectUris.includes(redirectUri)) {
      return;
    }
    throw new UnauthorizedException('Invalid redirectUri');
  }

  private readonly authorizeValidate: ValidateFunctionArity2<IAuthorizeClient> = async (
    areq,
    done
  ) => {
    const {
      clientID: clientId,
      redirectURI,
      scope: queryScopes,
      codeChallenge,
      codeChallengeMethod,
    } = areq as IAuthorizeRequest;
    try {
      const { redirectUris, scopes } = await this.getOAuthApp(clientId);
      // validate scopes if get scopes from user
      const invalidScopes = difference(queryScopes, scopes);
      if (invalidScopes.length > 0) {
        return done(new BadRequestException('Invalid scopes: ' + invalidScopes.join(',')));
      }

      // valid redirectUri
      if (!redirectUris.length) {
        return done(new BadRequestException('Redirect uri not configured'));
      }
      const redirectUri = redirectURI || redirectUris[0];
      const clientScopes = queryScopes ?? scopes;
      if (codeChallenge) {
        if (codeChallengeMethod !== 'S256') {
          return done(new BadRequestException('Invalid code challenge method'));
        }
        if (!this.pkceService.isValidCodeChallenge(codeChallenge)) {
          return done(new BadRequestException('Invalid code challenge'));
        }
        this.validateRedirectUri(redirectUri, redirectUris, 'pkce');
        return done(
          null,
          {
            clientId,
            scopes: clientScopes,
            redirectUri,
            codeChallenge,
            codeChallengeMethod,
          },
          redirectUri
        );
      }
      // valid redirectUri
      this.validateRedirectUri(redirectUri, redirectUris, 'secret');
      done(
        null,
        {
          clientId,
          scopes: clientScopes,
          redirectUri,
        },
        redirectUri
      );
    } catch (error) {
      done(error as Error);
    }
  };

  private readonly authorizeImmediate: ImmediateFunction<IAuthorizeClient> = async (
    client,
    user,
    _scope,
    _type,
    _areq,
    done
  ) => {
    // Skip the consent screen only for scopes the app already holds for the user: an app that
    // asks for more is shown to them again.
    const approvedScopes = await this.getApprovedScopes(user.id, client.clientId);
    if (approvedScopes && difference(client.scopes, approvedScopes).length === 0) {
      await this.touchAuthorize(client.clientId, user.id, client.scopes);
      return done(null, true, undefined, undefined);
    }
    return done(null, false, undefined, undefined);
  };

  // oauth2orize middlewares complete the response themselves on their success
  // paths (trusted-client authorize, token issuance, decision redirect) and
  // never invoke next() there — so a promise resolved only from the next()
  // callback stays pending forever, retaining the request context. Resolving
  // on response close (fires after finish and on aborted connections alike)
  // settles every path; a later resolve after reject is a no-op.
  private settleOnResponseClose(res: Response, resolve: () => void) {
    res.once('close', resolve);
  }

  async authorize(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
      this.settleOnResponseClose(res, resolve);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.server as any).authorization(this.authorizeValidate, this.authorizeImmediate)(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req as any,
        res,
        (error: unknown) => {
          if (error) {
            return reject(this.handleError(error));
          }
          res.redirect(
            `/oauth/decision?transaction_id=${
              (req as Request & { oauth2: { transactionID: string } }).oauth2.transactionID
            }`
          );
          resolve();
        }
      );
    });
  }

  async token(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
      this.settleOnResponseClose(res, resolve);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.server.token()(req as any, res, (error) => {
        if (error) {
          return reject(this.handleError(error));
        }
        resolve();
      });
    });
  }

  private readonly decisionComplete = async (
    _req: unknown,
    oauth2: OAuth2<IAuthorizeClient, IUserMeVo>,
    cb: (err?: unknown) => void
  ) => {
    // complete the transaction: the scopes on the client are the ones the consent screen showed
    await this.touchAuthorize(oauth2.req.clientID, oauth2.user.id, oauth2.client.scopes)
      .then(() => cb())
      .catch(cb);
  };

  // Was an arrow property; now a method so @Audit can decorate it (decisionComplete
  // still binds `this` itself). Audit row + emit make the grant visible to the audit
  // trail and to analytics ("user authorized app X" — integration-adoption signal).
  @Audit({
    action: Events.OAUTH_APP_AUTHORIZE,
    resourceId: (clientId: string) => clientId,
    userId: (_clientId: string, userId: string) => userId,
    params: (clientId: string, _userId: string, scopes: string[]) => ({ clientId, scopes }),
    emit: true,
  })
  // `_scopes`, the ones just approved, is read by @Audit's params.
  private async touchAuthorize(clientId: string, userId: string, _scopes: string[]) {
    await this.prismaService.oAuthAppAuthorized.upsert({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        clientId_userId: {
          clientId: clientId,
          userId: userId,
        },
      },
      create: {
        clientId: clientId,
        userId: userId,
        authorizedTime: new Date().toISOString(),
      },
      update: {
        authorizedTime: new Date().toISOString(),
      },
    });
  }

  async decision(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
      this.settleOnResponseClose(res, resolve);
      // this.decision() return an array of middleware
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fns: Array<ReturnType<IOAuth2Server['decision']>> = (this.server as any).decision(
        undefined,
        undefined,
        this.decisionComplete
      );
      // transactionLoader loads oauth data into req.oauth2
      const transactionLoader = fns[0];
      const decisionFn = fns[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transactionLoader(req as any, res, (error) => {
        if (error) {
          return reject(this.handleError(error));
        }
        // oauth2orize answers a posted `cancel` with access_denied (decisionComplete never runs).
        const oauth2 = (req as Request & { oauth2?: OAuth2 }).oauth2;
        if (req.body?.cancel && oauth2?.req?.clientID) {
          void this.recordAuthorizeDenied(oauth2.req.clientID, 'authorization-code');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        decisionFn(req as any, res, async (error) => {
          if (error) {
            return reject(this.handleError(error));
          }
          resolve();
        });
      });
    });
  }

  private async getOAuthApp(clientId: string) {
    const data = await this.prismaService
      .txClient()
      .oAuthApp.findUniqueOrThrow({
        where: {
          clientId,
        },
      })
      .catch((error) => {
        throw new UnauthorizedException(error.message);
      });
    return nullsToUndefined({
      ...data,
      redirectUris: data.redirectUris ? (JSON.parse(data.redirectUris) as string[]) : [],
      scopes: data.scopes ? (JSON.parse(data.scopes) as string[]) : [],
    });
  }

  private readonly codeGrant: IssueGrantCodeFunction = async (
    client,
    _redirectUri,
    user,
    _ares,
    done
  ) => {
    const { clientId } = await this.getOAuthApp(client.clientId);
    const code = getRandomString(16);
    // save code
    await this.cacheService.set(
      `oauth:code:${code}`,
      {
        clientId,
        redirectUri: client.redirectUri,
        scopes: client.scopes,
        user: pick(user, ['id', 'email', 'name']),
        codeChallenge: client.codeChallenge,
        codeChallengeMethod: client.codeChallengeMethod,
      },
      this.oauth2Config.codeExpireIn
    );
    done(null, code);
  };

  private generateAccessToken({
    userId,
    scopes,
    clientId,
    clientName,
  }: {
    userId: string;
    scopes: string[];
    clientId: string;
    clientName: string;
  }) {
    return this.accessTokenService.createAccessToken({
      clientId,
      name: `oauth:${clientName}`,
      scopes,
      userId,
      // 10 minutes
      expiredTime: new Date(Date.now() + ms(this.oauth2Config.accessTokenExpireIn)).toISOString(),
    });
  }

  private getRefreshToken(client: ITokenClient, accessTokenId: string, sign: string) {
    // Confidential clients are bound to the secret row, not to the secret hash:
    // a JWT payload is readable by whoever holds the refresh token. Deleting
    // that secret still invalidates every refresh token issued under it.
    const payload =
      client.type === 'pkce'
        ? { clientId: client.clientId, accessTokenId, sign }
        : { clientId: client.clientId, secretId: client.secretId, accessTokenId, sign };
    return this.jwtService.signAsync(payload, {
      expiresIn: this.oauth2Config.refreshTokenExpireIn,
    });
  }

  private getRefreshTokenExpireTime() {
    return new Date(Date.now() + ms(this.oauth2Config.refreshTokenExpireIn)).toISOString();
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private verifyExchangeClient(client: ITokenClient, state: IOAuthCodeState) {
    // code_challenge was set during authorize — code_verifier is required
    if (client.type === 'pkce') {
      if (!client.codeVerifier) {
        throw new BadRequestException('code_verifier is required');
      }
      if (!this.pkceService.isValidCodeVerifier(client.codeVerifier)) {
        throw new BadRequestException('Invalid code_verifier format');
      }
      if (!state.codeChallenge) {
        throw new BadRequestException('code_challenge is required');
      }
      if (!state.codeChallengeMethod || state.codeChallengeMethod !== 'S256') {
        throw new BadRequestException('Invalid code_challenge method');
      }
      const valid = this.pkceService.validateCodeVerifier(
        state.codeChallenge,
        state.codeChallengeMethod,
        client.codeVerifier
      );
      if (!valid) {
        throw new UnauthorizedException('Invalid code_verifier');
      }
    } else if (client.type === 'secret') {
      if (!client.clientSecret) {
        throw new BadRequestException('client_secret is required');
      }
      // RFC 7636: once code_challenge is sent, code_verifier must be provided
      if (state.codeChallenge) {
        throw new BadRequestException('code_verifier is required for PKCE flow');
      }
    } else {
      throw new BadRequestException('Invalid client type');
    }
  }

  /**
   * Poll leg of the device grant (RFC 8628 §3.4-3.5). Answers with a token pair
   * once someone approved the user code in a browser, and with the spec's error
   * codes until then — `authorization_pending` is the normal case, not a fault.
   */
  private readonly deviceCodeExchange = async (
    req: Request,
    res: Response,
    next: (err?: unknown) => void
  ) => {
    const deviceCode = (req.body as Record<string, string> | undefined)?.device_code;
    const client = req.user as ITokenClient | undefined;

    const respond = (status: number, payload: Record<string, unknown>) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.statusCode = status;
      res.end(JSON.stringify(payload));
    };

    try {
      if (!client) {
        return next(new UnauthorizedException('Invalid client'));
      }
      if (!deviceCode) {
        return respond(400, {
          error: 'invalid_request',
          error_description: 'device_code is required',
        });
      }

      const result = await this.deviceService.poll(deviceCode, client.clientId);
      if (result.status !== 'approved') {
        const errors = {
          pending: 'authorization_pending',
          slow_down: 'slow_down',
          denied: 'access_denied',
          expired: 'expired_token',
        } as const;
        return respond(400, { error: errors[result.status] });
      }

      const { user, scopes } = result.state;
      let tokens: { accessToken: string; refreshToken: string };
      try {
        await this.checkTokenRateLimit(client.clientId, user.id);
        tokens = await this.prismaService.$tx(() =>
          this.issueTokenPair({ client, userId: user.id, scopes })
        );
      } catch (error) {
        // poll() consumed the code as its claim; put the approval back so a
        // transient failure here (rate limit, DB hiccup) costs the client one
        // poll, not the person the whole browser round-trip.
        await this.deviceService.restore(deviceCode, result.state);
        throw error;
      }
      // No touchAuthorize here: decideDevice already recorded the grant when
      // the person approved, and a second call would double the audit event.

      return respond(200, {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: 'Bearer',
        scopes,
        expires_in: second(this.oauth2Config.accessTokenExpireIn),
        refresh_expires_in: second(this.oauth2Config.refreshTokenExpireIn),
      });
    } catch (error) {
      return next(error);
    }
  };

  /** Access token + refresh token for one (client, user, scopes). */
  private async issueTokenPair(params: {
    client: ITokenClient;
    userId: string;
    scopes: string[];
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const { client, userId, scopes } = params;
    const accessToken = await this.generateAccessToken({
      userId,
      scopes,
      clientId: client.clientId,
      clientName: client.name,
    });
    const refreshTokenSign = getRandomString(16);
    const refreshToken = await this.getRefreshToken(client, accessToken.id, refreshTokenSign);
    await this.prismaService.txClient().oAuthAppToken.create({
      data: {
        clientId: client.clientId,
        refreshTokenSign,
        appSecretId: (client as { secretId?: string }).secretId,
        createdBy: userId,
        expiredTime: this.getRefreshTokenExpireTime(),
      },
    });
    return { accessToken: accessToken.token, refreshToken };
  }

  /** Approve or deny a device user code on behalf of the signed-in user. */
  async decideDevice(params: {
    userCode: string;
    approve: boolean;
    user: { id: string; name: string; email: string };
  }) {
    const { clientId, scopes } = await this.deviceService.decide(params);
    if (params.approve) {
      await this.touchAuthorize(clientId, params.user.id, scopes);
    } else {
      await this.recordAuthorizeDenied(clientId, 'device', params.user.id);
    }
  }

  /** The signed-in user refused to grant the app access (consent page or device approval). */
  private async recordAuthorizeDenied(
    clientId: string,
    flow: 'authorization-code' | 'device',
    userId?: string
  ) {
    await this.audit.emitAtomic({
      action: 'oauth-app.authorize-denied',
      resourceId: clientId,
      ...(userId ? { userId } : {}),
      params: { clientId, flow },
    });
  }

  private readonly codeExchange: IssueExchangeCodeFunction = async (
    client,
    code,
    redirectUri,
    done
  ) => {
    const completeExchange = await this.prismaService
      .$tx(async () => {
        const codeState = await this.cacheService.get(`oauth:code:${code}`);
        if (!codeState) {
          return () => done(new UnauthorizedException('Invalid code'));
        }
        await this.cacheService.del(`oauth:code:${code}`);
        await this.checkTokenRateLimit(client.clientId, codeState.user.id);

        if (codeState.clientId !== client.clientId) {
          return () => done(new UnauthorizedException('Invalid client'));
        }
        if (!redirectUri) {
          return () => done(new UnauthorizedException('redirect_uri is required'));
        }
        if (redirectUri !== codeState.redirectUri) {
          return () => done(new UnauthorizedException('Invalid redirectUri'));
        }
        const tokenClient = client as ITokenClient;
        this.verifyExchangeClient(tokenClient, codeState);

        const { accessToken, refreshToken } = await this.issueTokenPair({
          client: tokenClient,
          userId: codeState.user.id,
          scopes: codeState.scopes,
        });
        return () =>
          done(null, accessToken, refreshToken, {
            scopes: codeState.scopes,
            expires_in: second(this.oauth2Config.accessTokenExpireIn),
            refresh_expires_in: second(this.oauth2Config.refreshTokenExpireIn),
          });
      })
      .catch((error) => () => done(error));

    return completeExchange();
  };

  private readonly refreshTokenExchange: (
    client: ITokenClient,
    refreshToken: string,
    issued: ExchangeDoneFunction
  ) => void = (client, refreshToken, done) => {
    return this.prismaService
      .$tx(async () => {
        const decoded = await this.jwtService.verifyAsync<{
          clientId: string;
          secretId?: string;
          // Refresh tokens issued before `secretId` carry the secret hash; they
          // stay valid until they expire (refreshTokenExpireIn).
          secret?: string;
          accessTokenId: string;
          sign: string;
        }>(refreshToken);

        if (client.clientId !== decoded.clientId) {
          return () => done(new UnauthorizedException('Invalid client'));
        }
        // PKCE tokens carry neither field and must only be honored by a PKCE
        // client (whose clientSecret is undefined), and vice versa.
        const boundToClient =
          decoded.secretId !== undefined
            ? decoded.secretId === client.secretId
            : decoded.secret === (client as { clientSecret?: string }).clientSecret;
        if (!boundToClient) {
          return () => done(new UnauthorizedException('Invalid secret'));
        }

        const oldAccessToken = await this.prismaService.txClient().accessToken.findUnique({
          where: { id: decoded.accessTokenId },
        });
        if (!oldAccessToken) {
          return () => done(new UnauthorizedException('Invalid access token'));
        }
        await this.checkTokenRateLimit(client.clientId, oldAccessToken.userId);

        const authorized = await this.prismaService.txClient().oAuthAppAuthorized.findUnique({
          where: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            clientId_userId: {
              clientId: decoded.clientId,
              userId: oldAccessToken.userId,
            },
          },
        });
        if (!authorized) {
          return () => done(new UnauthorizedException('Invalid authorized'));
        }

        const scopes = oldAccessToken.scopes ? JSON.parse(oldAccessToken.scopes) : [];
        const accessToken = await this.generateAccessToken({
          userId: oldAccessToken.userId,
          scopes,
          clientId: decoded.clientId,
          clientName: client.name,
        });

        const oauthAppToken = await this.prismaService
          .txClient()
          .oAuthAppToken.update({
            where: {
              clientId: decoded.clientId,
              refreshTokenSign: decoded.sign,
              appSecretId: client.secretId,
            },
            data: {
              refreshTokenSign: getRandomString(16),
              expiredTime: this.getRefreshTokenExpireTime(),
            },
            select: { refreshTokenSign: true },
          })
          .catch(() => {
            throw new UnauthorizedException('Invalid refresh token');
          });

        const newRefreshToken = await this.getRefreshToken(
          client,
          accessToken.id,
          oauthAppToken.refreshTokenSign
        );
        return () =>
          done(null, accessToken.token, newRefreshToken, {
            scopes,
            expires_in: second(this.oauth2Config.accessTokenExpireIn),
            refresh_expires_in: second(this.oauth2Config.refreshTokenExpireIn),
          });
      })
      .catch((error) => () => done(error))
      .then((completeExchange) => completeExchange());
  };

  async getDecisionInfo(req: Request, transactionId: string) {
    // Express 5 leaves req.body undefined on GET requests (no body parser ran).
    req.body ??= {};
    req.body['transaction_id'] = transactionId;
    return new Promise<DecisionInfoGetVo>((resolve, reject) => {
      this.oauthTxStore.load(req, async (err, txn) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } else {
          const clientId = txn!.req.clientID;
          const oauthApp = await this.getOAuthApp(clientId);
          if (!oauthApp) {
            return reject(new NotFoundException('Client not found'));
          }
          resolve({
            name: oauthApp.name,
            description: oauthApp.description ?? undefined,
            homepage: oauthApp.homepage,
            logo: oauthApp.logo ?? undefined,
            scopes: txn!.req.scope,
          });
        }
      });
    });
  }
}
