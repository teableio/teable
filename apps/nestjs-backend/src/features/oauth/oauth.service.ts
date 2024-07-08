import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { generateClientId, getRandomString, nullsToUndefined } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import type {
  AuthorizedVo,
  GenerateOAuthSecretVo,
  OAuthCreateRo,
  OAuthCreateVo,
  OAuthGetListVo,
  OAuthGetVo,
  OAuthUpdateVo,
} from '@teable/openapi';
import * as bcrypt from 'bcrypt';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class OAuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private convertToVo<T extends { scopes?: string | null; redirectUris?: string | null }>(ro: T) {
    return nullsToUndefined({
      ...ro,
      scopes: ro.scopes ? JSON.parse(ro.scopes) : undefined,
      redirectUris: ro.redirectUris ? JSON.parse(ro.redirectUris) : undefined,
    });
  }

  async createOAuth(ro: OAuthCreateRo): Promise<OAuthCreateVo> {
    const userId = this.cls.get('user.id');
    const { redirectUris, name, description, scopes, homepage, logo } = ro;
    const res = await this.prismaService.oAuthApp.create({
      data: {
        name,
        description,
        scopes: scopes ? JSON.stringify(scopes) : null,
        homepage,
        logo,
        redirectUris: redirectUris ? JSON.stringify(redirectUris) : null,
        createdBy: userId,
        clientId: generateClientId(),
      },
    });
    return this.convertToVo(
      pick(res, [
        'id',
        'name',
        'description',
        'scopes',
        'homepage',
        'logo',
        'redirectUris',
        'clientId',
      ])
    );
  }

  private getSecrets = async (clientId: string) => {
    const secrets = await this.prismaService.oAuthAppSecret.findMany({
      where: {
        clientId,
      },
      orderBy: {
        createdTime: 'desc',
      },
    });
    if (!secrets.length) {
      return;
    }
    return secrets.map((s) => ({
      id: s.id,
      secret: s.maskedSecret,
      lastUsedTime: s.lastUsedTime?.toISOString(),
    }));
  };

  async getOAuth(clientId: string): Promise<OAuthGetVo> {
    const res = await this.prismaService.oAuthApp.findUnique({
      where: {
        clientId,
      },
    });
    if (!res) {
      throw new NotFoundException('OAuth client not found');
    }
    const secrets = await this.getSecrets(clientId);
    return this.convertToVo(
      pick(
        {
          ...res,
          secrets,
        },
        [
          'id',
          'name',
          'description',
          'scopes',
          'homepage',
          'logo',
          'redirectUris',
          'clientId',
          'secrets',
        ]
      )
    );
  }

  async updateOAuth(clientId: string, ro: OAuthCreateRo): Promise<OAuthUpdateVo> {
    const { redirectUris, name, description, scopes, homepage, logo } = ro;
    const res = await this.prismaService.oAuthApp.update({
      where: {
        clientId,
      },
      data: {
        name,
        description,
        scopes: scopes ? JSON.stringify(scopes) : null,
        homepage,
        logo,
        redirectUris: redirectUris ? JSON.stringify(redirectUris) : null,
      },
    });

    const secrets = await this.getSecrets(clientId);

    return this.convertToVo(
      pick({ ...res, secrets }, [
        'id',
        'name',
        'description',
        'scopes',
        'homepage',
        'logo',
        'redirectUris',
        'clientId',
      ])
    );
  }

  async deleteOAuth(clientId: string): Promise<void> {
    await this.prismaService.oAuthApp.delete({
      where: {
        clientId,
      },
    });
  }

  async getOAuthList(): Promise<OAuthGetListVo> {
    const userId = this.cls.get('user.id');
    const res = await this.prismaService.oAuthApp.findMany({
      where: {
        createdBy: userId,
      },
      select: {
        clientId: true,
        name: true,
        logo: true,
        homepage: true,
        description: true,
      },
    });
    return nullsToUndefined(res);
  }

  async generateSecret(clientId: string): Promise<GenerateOAuthSecretVo> {
    const secret = getRandomString(40).toLocaleLowerCase();
    const hashedSecret = await bcrypt.hash(secret, 10);

    const sensitivePart = secret.slice(0, secret.length - 10);
    const maskedSecret = secret.slice(0).replace(sensitivePart, '*'.repeat(sensitivePart.length));

    const res = await this.prismaService.oAuthAppSecret.create({
      data: {
        clientId,
        secret: hashedSecret,
        maskedSecret,
        createdBy: this.cls.get('user.id'),
      },
    });

    return {
      secret,
      maskedSecret,
      id: res.id,
      lastUsedTime: res.lastUsedTime?.toISOString(),
    };
  }

  async deleteSecret(clientId: string, secretId: string): Promise<void> {
    await this.prismaService.oAuthAppSecret.delete({
      where: {
        id: secretId,
        clientId,
      },
    });
  }

  async revokeAccess(clientId: string) {
    // validate clientId is match with current user
    const currentUserId = this.cls.get('user.id');
    const app = await this.prismaService.oAuthApp.findFirst({
      where: { clientId, createdBy: currentUserId },
    });
    if (!app) {
      throw new ForbiddenException('No permission to revoke access: ' + clientId);
    }
    await this.prismaService.$tx(async () => {
      await this.prismaService.txClient().oAuthAppAuthorized.deleteMany({
        where: { clientId },
      });
      const secrets = await this.prismaService.txClient().oAuthAppSecret.findMany({
        where: { clientId },
      });
      const secretIds = secrets.map((s) => s.id);
      await this.prismaService.txClient().oAuthAppToken.deleteMany({
        where: { appSecretId: { in: secretIds } },
      });
      // delete access token
      await this.prismaService.txClient().accessToken.deleteMany({
        where: { clientId },
      });
    });
  }

  async getAuthorizedList(): Promise<AuthorizedVo[]> {
    const userId = this.cls.get('user.id');
    const authorized = await this.prismaService.oAuthAppAuthorized.findMany({
      where: {
        userId,
      },
      select: {
        clientId: true,
      },
    });
    if (authorized.length === 0) {
      return [];
    }
    const clientIds = authorized.map((a) => a.clientId);
    const client = await this.prismaService.oAuthApp.findMany({
      where: {
        clientId: { in: clientIds },
      },
    });
    if (client.length === 0) {
      return [];
    }
    // user map
    const users = await this.prismaService.user.findMany({
      where: {
        id: { in: client.map((c) => c.createdBy) },
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });
    const userMap = users.reduce(
      (acc, u) => {
        acc[u.id] = {
          email: u.email,
          name: u.name,
        };
        return acc;
      },
      {} as Record<string, { email: string; name: string }>
    );

    // last used time
    const lastUsedTime = await this.prismaService.$queryRaw<
      {
        clientId: string;
        lastUsedTime: string;
      }[]
    >(Prisma.sql`
      WITH ranked_clients AS (
          SELECT
              client_id,
              last_used_time,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY last_used_time DESC) AS rn
          FROM oauth_app_secret
          WHERE client_id IN (${Prisma.join(clientIds)})
      )
      SELECT client_id as clientId, last_used_time as lastUsedTime
      FROM ranked_clients
      WHERE rn = 1;
    `);

    const lastUsedTimeMap = lastUsedTime.reduce(
      (acc, d) => {
        acc[d.clientId] = d;
        return acc;
      },
      {} as Record<string, { clientId: string; lastUsedTime: string }>
    );

    return client.map((c) =>
      this.convertToVo({
        clientId: c.clientId,
        name: c.name,
        description: c.description,
        logo: c.logo,
        homepage: c.homepage,
        scopes: c.scopes,
        lastUsedTime: lastUsedTimeMap[c.clientId]?.lastUsedTime,
        createdUser: userMap[c.createdBy],
      })
    );
  }
}
