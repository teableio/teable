import { Injectable, NotFoundException } from '@nestjs/common';
import { generateClientId, getRandomString, nullsToUndefined } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
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
}
