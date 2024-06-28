import { UnauthorizedException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { PrismaService } from '@teable/db-main-prisma';
import * as bcrypt from 'bcrypt';
import { Strategy } from 'passport-oauth2-client-password';
import type { IExchangeClient } from '../types';

@Injectable()
export class OAuthClientStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prismaService: PrismaService) {
    super();
  }

  async validate(clientId: string, clientSecret: string): Promise<IExchangeClient> {
    const oauthApp = await this.prismaService.txClient().oAuthApp.findUnique({
      where: {
        clientId,
      },
    });

    if (!oauthApp) {
      throw new UnauthorizedException('Client not found');
    }

    const secrets = await this.prismaService.txClient().oAuthAppSecret.findMany({
      where: {
        clientId,
      },
    });
    if (!secrets.length) {
      throw new UnauthorizedException('No secrets found for the given clientId');
    }

    for (const appSecret of secrets) {
      const isMatch = await bcrypt.compare(clientSecret, appSecret.secret);
      if (isMatch) {
        // update last use
        await this.prismaService.txClient().oAuthAppSecret.update({
          where: {
            id: appSecret.id,
          },
          data: {
            lastUsedTime: new Date().toISOString(),
          },
        });
        return {
          name: oauthApp.name,
          secretId: appSecret.id,
          clientId: appSecret.clientId,
          clientSecret: appSecret.secret,
        };
      }
    }

    throw new UnauthorizedException('Client secret invalid');
  }
}
