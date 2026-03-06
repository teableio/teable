import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRandomString, HttpErrorCode, nullsToUndefined } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { DecisionInfoGetVo } from '@teable/openapi';
import type { Response, Request } from 'express';
import { difference, pick } from 'lodash';
import ms from 'ms';
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
import { second } from '../../utils/second';
import { AccessTokenService } from '../access-token/access-token.service';
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
    private readonly jwtService: JwtService,
    private readonly oauthTxStore: OAuthTxStore,
    private readonly pkceService: PkceService,
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
  }

  private async getAuthorizedTime(userId: string, clientId: string) {
    const authorizedTime = await this.prismaService
      .txClient()
      .oAuthAppAuthorized.findUnique({
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
      })
      .then((data) => data?.authorizedTime);
    // validate authorized time is not expired
    return (
      authorizedTime &&
      new Date(authorizedTime).getTime() + ms(this.oauth2Config.authorizedExpireIn) > Date.now()
    );
  }

  private handleError(error: unknown | undefined) {
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

  private authorizeValidate: ValidateFunctionArity2<IAuthorizeClient> = async (areq, done) => {
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

  private authorizeImmediate: ImmediateFunction<IAuthorizeClient> = async (
    client,
    user,
    _scope,
    _type,
    _areq,
    done
  ) => {
    const isTrusted = await this.getAuthorizedTime(user.id, client.clientId);
    if (isTrusted) {
      await this.touchAuthorize(client.clientId, user.id);
      return done(null, true, undefined, undefined);
    }
    return done(null, false, undefined, undefined);
  };

  async authorize(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.server.token()(req as any, res, (error) => {
        if (error) {
          return reject(this.handleError(error));
        }
        resolve();
      });
    });
  }

  private decisionComplete = async (_req: unknown, oauth2: OAuth2, cb: (err?: unknown) => void) => {
    // complete the transaction
    await this.touchAuthorize(oauth2.req.clientID, oauth2.user.id)
      .then(() => cb())
      .catch(cb);
  };

  private touchAuthorize = async (clientId: string, userId: string) => {
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
  };

  async decision(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
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

  private codeGrant: IssueGrantCodeFunction = async (client, _redirectUri, user, _ares, done) => {
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
    const payload =
      client.type === 'pkce'
        ? { clientId: client.clientId, accessTokenId, sign }
        : { clientId: client.clientId, secret: client.clientSecret, accessTokenId, sign };
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

  private codeExchange: IssueExchangeCodeFunction = async (client, code, redirectUri, done) => {
    await this.prismaService
      .$tx(async () => {
        const codeState = await this.cacheService.get(`oauth:code:${code}`);
        if (!codeState) {
          return done(new UnauthorizedException('Invalid code'));
        }
        await this.cacheService.del(`oauth:code:${code}`);
        await this.checkTokenRateLimit(client.clientId, codeState.user.id);

        if (codeState.clientId !== client.clientId) {
          return done(new UnauthorizedException('Invalid client'));
        }
        if (!redirectUri) {
          return done(new UnauthorizedException('redirect_uri is required'));
        }
        if (redirectUri !== codeState.redirectUri) {
          return done(new UnauthorizedException('Invalid redirectUri'));
        }
        const tokenClient = client as ITokenClient;
        this.verifyExchangeClient(tokenClient, codeState);

        const accessToken = await this.generateAccessToken({
          userId: codeState.user.id,
          scopes: codeState.scopes,
          clientId: client.clientId,
          clientName: tokenClient.name,
        });

        const refreshTokenSign = getRandomString(16);
        const appSecretId = tokenClient.secretId;
        const refreshToken = await this.getRefreshToken(
          tokenClient,
          accessToken.id,
          refreshTokenSign
        );
        await this.prismaService.txClient().oAuthAppToken.create({
          data: {
            clientId: client.clientId,
            refreshTokenSign,
            appSecretId: appSecretId,
            createdBy: codeState.user.id,
            expiredTime: this.getRefreshTokenExpireTime(),
          },
        });
        done(null, accessToken.token, refreshToken, {
          scopes: codeState.scopes,
          expires_in: second(this.oauth2Config.accessTokenExpireIn),
          refresh_expires_in: second(this.oauth2Config.refreshTokenExpireIn),
        });
      })
      .catch((error) => done(error));
  };

  private refreshTokenExchange: (
    client: ITokenClient,
    refreshToken: string,
    issued: ExchangeDoneFunction
  ) => void = (client, refreshToken: string, done) => {
    return this.prismaService
      .$tx(async () => {
        const decoded = await this.jwtService.verifyAsync<{
          clientId: string;
          secret?: string;
          accessTokenId: string;
          sign: string;
        }>(refreshToken);

        if (client.clientId !== decoded.clientId) {
          return done(new UnauthorizedException('Invalid client'));
        }
        if ((client as ITokenClient & { clientSecret?: string })?.clientSecret !== decoded.secret) {
          return done(new UnauthorizedException('Invalid secret'));
        }

        const oldAccessToken = await this.prismaService.txClient().accessToken.findUnique({
          where: { id: decoded.accessTokenId },
        });
        if (!oldAccessToken) {
          return done(new UnauthorizedException('Invalid access token'));
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
          return done(new UnauthorizedException('Invalid authorized'));
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
        done(null, accessToken.token, newRefreshToken, {
          scopes,
          expires_in: second(this.oauth2Config.accessTokenExpireIn),
          refresh_expires_in: second(this.oauth2Config.refreshTokenExpireIn),
        });
      })
      .catch((error) => done(error));
  };

  async getDecisionInfo(req: Request, transactionId: string) {
    req.body['transaction_id'] = transactionId;
    return new Promise<DecisionInfoGetVo>((resolve, reject) => {
      this.oauthTxStore.load(req, async (err, txn) => {
        if (err) {
          reject(err);
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
