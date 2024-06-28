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
import type { DecisionInfoGetVo, IUserMeVo } from '@teable/openapi';
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
    private readonly oauthTxStore: OAuthTxStore
  ) {
    this.server = oauth2orize.createServer({
      store: this.oauthTxStore,
    });
    this.registerCodeGrant();
    this.registerExchangeCode();
    this.registerExchangeRefreshToken();
  }

  private getAuthorizedTime(userId: string, clientId: string) {
    return this.prismaService
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
  }

  async authorize(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.server as any).authorization(
        (async (clientId, queryRedirectUri, queryScopes, done) => {
          try {
            const { redirectUris, scopes } = await this.getOAuthApp(clientId);

            // validate scopes if get scopes from user
            const invalidScopes = difference(queryScopes, scopes);
            if (invalidScopes.length > 0) {
              return done(new BadRequestException('Invalid scopes'));
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
              },
              redirectUri
            );
          } catch (error) {
            done(error as Error);
          }
        }) as ValidateFunctionArity4<IAuthorizeClient>,
        (async (client, user, _scope, _type, _areq, done) => {
          const isTrusted = await this.getAuthorizedTime(user.id, client.clientId);
          if (isTrusted) {
            return done(null, true, undefined, undefined);
          }
          return done(null, false, undefined, undefined);
        }) as ImmediateFunction<IAuthorizeClient, IUserMeVo>
      )(req, res, (error: unknown) => {
        if (error) {
          if (error instanceof AuthorizationError) {
            return reject(new HttpException(error.message, Number(error.status)));
          }
          return reject(error);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res.redirect(`/oauth/authorize/ensure?transaction_id=${(req as any).oauth2.transactionID}`);
        resolve();
      });
    });
  }

  async token(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.server.token()(req as any, res, (error) => {
        if (error) {
          if (error instanceof AuthorizationError) {
            return reject(new HttpException(error.message, Number(error.status)));
          }
          return reject(error);
        }
        resolve();
      });
    });
  }

  async decision(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fns: Array<ReturnType<IOAuth2Server['decision']>> = (this.server as any).decision(
        undefined,
        undefined,
        async (_req: unknown, oauth2: OAuth2, cb: () => void) => {
          // complete the transaction
          // update authorized time
          await this.prismaService.oAuthAppAuthorized.update({
            where: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              clientId_userId: {
                clientId: oauth2.req.clientID,
                userId: oauth2.user.id,
              },
            },
            data: {
              authorizedTime: new Date().toISOString(),
            },
          });
          cb();
        }
      );
      const transactionLoader = fns[0];
      const decisionFn = fns[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transactionLoader(req as any, res, (error) => {
        if (error) {
          if (error instanceof AuthorizationError) {
            return reject(new HttpException(error.message, Number(error.status)));
          }
          return reject(error);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        decisionFn(req as any, res, async (error) => {
          if (error) {
            if (error instanceof AuthorizationError) {
              return reject(new HttpException(error.message, Number(error.status)));
            }
            return reject(error);
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

  private registerCodeGrant() {
    this.server.grant(
      oauth2orize.grant.code((async (client: IAuthorizeClient, redirectUri, user, ares, done) => {
        const { clientId } = await this.getOAuthApp(client.clientId);

        const code = getRandomString(16);
        // save code
        await this.cacheService.set(`oauth:code:${code}`, {
          clientId,
          redirectUri,
          scopes: client.scopes,
          user: pick(user, ['id', 'email', 'name']),
        });
        done(null, code);
      }) as IssueGrantCodeFunction)
    );
  }

  private generateAccessToken(userId: string, scopes: string[], clientName: string) {
    return this.accessTokenService.createAccessToken({
      isOAuth: true,
      name: `oauth:${clientName}`,
      scopes,
      userId,
      // 10 minutes
      expiredTime: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
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
      { expiresIn: '30d' }
    );
  }

  private registerExchangeCode() {
    this.server.exchange(
      oauth2orize.exchange.code((async (client: IExchangeClient, code, redirectUri, done) => {
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

            if (codeState.redirectUri !== redirectUri) {
              return done(new UnauthorizedException('Invalid redirectUri'));
            }

            // save access token
            const accessToken = await this.generateAccessToken(
              codeState.user.id,
              codeState.scopes,
              client.name
            );

            // save oauth access token
            const refreshTokenSign = getRandomString(16);
            const refreshToken = await this.getRefreshToken(
              client,
              accessToken.id,
              refreshTokenSign
            );
            await this.prismaService.txClient().oAuthAppToken.create({
              data: {
                refreshTokenSign,
                appSecretId: client.secretId,
                createdBy: codeState.user.id,
                // 30 days
                expiredTime: new Date(Date.now() + ms('30d')).toISOString(),
              },
            });
            // Issue a token
            done(null, accessToken.token, refreshToken, { scopes: codeState.scopes });
          })
          .catch((error) => done(error));
      }) as IssueExchangeCodeFunction)
    );
  }

  private registerExchangeRefreshToken() {
    this.server.exchange(
      oauth2orize.exchange.refreshToken(
        async (_client, refreshToken, done: ExchangeDoneFunction) => {
          await this.prismaService
            .$tx(async () => {
              const client = _client as IExchangeClient;
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

              // validate refresh_token and refresh refresh_token
              const oauthAppToken = await this.prismaService
                .txClient()
                .oAuthAppToken.update({
                  where: { refreshTokenSign: sign, appSecretId: secretId },
                  data: {
                    refreshTokenSign: getRandomString(16),
                    expiredTime: new Date(Date.now() + ms('30d')).toISOString(),
                  },
                })
                .catch(() => {
                  throw new UnauthorizedException('Invalid refresh token');
                });

              const oldAccessToken = await this.prismaService.txClient().accessToken.findUnique({
                where: { id: accessTokenId },
              });

              if (!oldAccessToken) {
                return done(new UnauthorizedException('Invalid access token'));
              }
              const scopes = oldAccessToken.scopes ? JSON.parse(oldAccessToken.scopes) : [];
              const accessToken = await this.generateAccessToken(
                oldAccessToken.userId,
                scopes,
                name
              );

              if (!accessToken) {
                return done(new UnauthorizedException('Invalid access token'));
              }

              const newRefreshToken = await this.getRefreshToken(
                client,
                accessToken.id,
                oauthAppToken.refreshTokenSign
              );
              // Issue a token
              done(null, accessToken.token, newRefreshToken, { scopes });
            })
            .catch((error) => done(error));
        }
      )
    );
  }

  async getDecisionInfo(req: Request) {
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
