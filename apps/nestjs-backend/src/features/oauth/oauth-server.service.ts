import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRandomString, nullsToUndefined } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { DecisionInfoGetVo } from '@teable/openapi';
import type { Response, Request } from 'express';
import { difference, pick } from 'lodash';
import ms from 'ms';
import type {
  IssueGrantCodeFunction,
  IssueExchangeCodeFunction,
  ValidateFunctionArity4,
  ImmediateFunction,
  ExchangeDoneFunction,
  OAuth2,
} from 'oauth2orize';
import oauth2orize, { AuthorizationError } from 'oauth2orize';
import { CacheService } from '../../cache/cache.service';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { IOAuthConfig, OAuthConfig } from '../../configs/oauth.config';
import { second } from '../../utils/second';
import { AccessTokenService } from '../access-token/access-token.service';
import { OAuthTxStore } from './oauth-tx-store';
import type { IAuthorizeClient, IExchangeClient, IOAuth2Server } from './types';

@Injectable()
export class OAuthServerService {
  server: IOAuth2Server;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly accessTokenService: AccessTokenService,
    private readonly jwtService: JwtService,
    private readonly oauthTxStore: OAuthTxStore,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @OAuthConfig() private readonly oauth2Config: IOAuthConfig
  ) {
    this.server = oauth2orize.createServer({
      store: this.oauthTxStore,
    });
    this.server.grant(oauth2orize.grant.code(this.codeGrant));
    this.server.exchange(oauth2orize.exchange.code(this.codeExchange));
    (this.server as unknown as IOAuth2Server<IExchangeClient>).exchange(
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

  private authorizeValidate: ValidateFunctionArity4<IAuthorizeClient> = async (
    clientId,
    queryRedirectUri,
    queryScopes,
    done
  ) => {
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
      const redirectUri = queryRedirectUri || redirectUris[0];
      // valid redirectUri
      if (!redirectUris.includes(redirectUri)) {
        return done(new BadRequestException('Redirect uri not found'));
      }
      const clientScopes = queryScopes ?? scopes;
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            `/oauth/decision?transaction_id=${(req as any).oauth2.transactionID}`
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
    // update authorized time
    console.log('touchAuthorize', clientId, userId);
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

  private codeGrant: IssueGrantCodeFunction = async (client, _redirectUri, user, ares, done) => {
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

  private getRefreshToken(client: IExchangeClient, accessTokenId: string, sign: string) {
    const { clientId, clientSecret } = client;
    return this.jwtService.signAsync(
      {
        clientId,
        secret: clientSecret,
        accessTokenId,
        sign: sign,
      },
      { expiresIn: this.oauth2Config.refreshTokenExpireIn }
    );
  }

  private getRefreshTokenExpireTime() {
    return new Date(Date.now() + ms(this.oauth2Config.refreshTokenExpireIn)).toISOString();
  }

  private codeExchange: IssueExchangeCodeFunction = async (client, code, redirectUri, done) => {
    await this.prismaService
      .$tx(async () => {
        // Verify the code
        const codeState = await this.cacheService.get(`oauth:code:${code}`);
        if (!codeState) {
          return done(new UnauthorizedException('Invalid code'));
        }
        await this.cacheService.del(`oauth:code:${code}`);

        if (codeState.clientId !== client.clientId) {
          return done(new UnauthorizedException('Invalid client'));
        }
        if (redirectUri && codeState.redirectUri !== redirectUri) {
          return done(new UnauthorizedException('Invalid redirectUri'));
        }

        // save access token
        const accessToken = await this.generateAccessToken({
          userId: codeState.user.id,
          scopes: codeState.scopes,
          clientId: client.clientId,
          clientName: client.name,
        });

        // save oauth access token
        const refreshTokenSign = getRandomString(16);
        const refreshToken = await this.getRefreshToken(client, accessToken.id, refreshTokenSign);
        await this.prismaService.txClient().oAuthAppToken.create({
          data: {
            refreshTokenSign,
            appSecretId: client.secretId,
            createdBy: codeState.user.id,
            expiredTime: this.getRefreshTokenExpireTime(),
          },
        });
        // Issue a token
        done(null, accessToken.token, refreshToken, {
          scopes: codeState.scopes,
          expires_in: second(this.oauth2Config.accessTokenExpireIn),
          refresh_expires_in: second(this.oauth2Config.refreshTokenExpireIn),
        });
      })
      .catch((error) => done(error));
  };

  private refreshTokenExchange: (
    client: IExchangeClient,
    refreshToken: string,
    issued: ExchangeDoneFunction
  ) => void = (client, refreshToken: string, done) => {
    return this.prismaService
      .$tx(async () => {
        const { clientSecret, name, secretId } = client;
        const { clientId, secret, accessTokenId, sign } = await this.jwtService.verifyAsync<{
          clientId: string;
          secret: string;
          accessTokenId: string;
          sign: string;
        }>(refreshToken);

        if (client.clientId !== clientId) {
          return done(new UnauthorizedException('Invalid client'));
        }
        if (clientSecret !== secret) {
          return done(new UnauthorizedException('Invalid secret'));
        }

        const oldAccessToken = await this.prismaService.txClient().accessToken.findUnique({
          where: { id: accessTokenId },
        });

        if (!oldAccessToken) {
          return done(new UnauthorizedException('Invalid access token'));
        }
        const scopes = oldAccessToken.scopes ? JSON.parse(oldAccessToken.scopes) : [];
        const accessToken = await this.generateAccessToken({
          userId: oldAccessToken.userId,
          scopes,
          clientId,
          clientName: name,
        });

        // validate refresh_token and refresh refresh_token
        const oauthAppToken = await this.prismaService
          .txClient()
          .oAuthAppToken.update({
            where: { refreshTokenSign: sign, appSecretId: secretId },
            data: {
              refreshTokenSign: getRandomString(16),
              expiredTime: this.getRefreshTokenExpireTime(),
            },
            select: {
              refreshTokenSign: true,
            },
          })
          .catch(() => {
            throw new UnauthorizedException('Invalid refresh token');
          });

        const newRefreshToken = await this.getRefreshToken(
          client,
          accessToken.id,
          oauthAppToken.refreshTokenSign
        );
        // Issue a token
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
