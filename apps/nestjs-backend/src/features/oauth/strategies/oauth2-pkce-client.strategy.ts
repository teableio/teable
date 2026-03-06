import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { PrismaService } from '@teable/db-main-prisma';
import type { Request } from 'express';
import { Strategy } from 'passport';
import type { IPkceExchangeClient } from '../types';

class PkceClientPasswordStrategy extends Strategy {
  override name = 'oauth2-pkce-client';
  private _verify: (
    clientId: string,
    codeVerifier: string | undefined,
    done: (err: unknown, client?: unknown) => void
  ) => void;

  constructor(
    verify: (
      clientId: string,
      codeVerifier: string | undefined,
      done: (err: unknown, client?: unknown) => void
    ) => void
  ) {
    super();
    this._verify = verify;
  }

  override authenticate(req: Request) {
    const clientId = req.body?.['client_id'] as string | undefined;
    const clientSecret = req.body?.['client_secret'] as string | undefined;
    const codeVerifier = req.body?.['code_verifier'] as string | undefined;
    if (clientSecret || !clientId) {
      return this.fail('Not a PKCE request', 401);
    }

    this._verify(clientId, codeVerifier, (err, client) => {
      if (err) {
        return this.error(err as Error);
      }
      if (!client) {
        return this.fail('authentication failed', 401);
      }
      this.success(client);
    });
  }
}

@Injectable()
export class OAuthPkceClientStrategy extends PassportStrategy(
  PkceClientPasswordStrategy,
  'oauth2-pkce-client'
) {
  constructor(private readonly prismaService: PrismaService) {
    super();
  }

  async validate(clientId: string, codeVerifier: string | undefined): Promise<IPkceExchangeClient> {
    const oauthApp = await this.prismaService.txClient().oAuthApp.findUnique({
      where: { clientId },
    });

    if (!oauthApp) {
      throw new UnauthorizedException('Client not found');
    }
    return {
      type: 'pkce',
      clientId,
      name: oauthApp.name,
      codeVerifier,
    };
  }
}
