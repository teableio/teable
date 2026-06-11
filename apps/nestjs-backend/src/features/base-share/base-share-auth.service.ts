import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';

export interface IBaseShareInfo {
  shareId: string;
  baseId: string;
  nodeId: string | null;
  allowSave: boolean | null;
  allowCopy: boolean | null;
  allowEdit: boolean | null;
}

export interface IJwtBaseShareInfo {
  shareId: string;
  password: string;
}

@Injectable()
export class BaseShareAuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtBaseShareInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  async authBaseShare(shareId: string, pass: string): Promise<string | null> {
    const share = await this.prismaService.baseShare.findUnique({
      where: { shareId },
      select: { shareId: true, password: true, enabled: true },
    });

    if (!share || !share.enabled) {
      return null;
    }

    const password = share.password;
    if (!password) {
      throw new CustomHttpException(
        'Password restriction is not enabled',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.shareAuth.passwordRestrictionNotEnabled',
          },
        }
      );
    }
    return pass === password ? shareId : null;
  }

  async authToken(jwtShareInfo: IJwtBaseShareInfo) {
    return await this.jwtService.signAsync(jwtShareInfo);
  }

  async getBaseShareInfo(shareId: string): Promise<IBaseShareInfo> {
    const share = await this.prismaService.baseShare.findUnique({
      where: { shareId },
    });

    if (!share || !share.enabled) {
      throw new CustomHttpException('Base share not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.baseShare.notFound',
        },
      });
    }

    return {
      shareId: share.shareId,
      baseId: share.baseId,
      nodeId: share.nodeId ?? null,
      allowSave: share.allowSave,
      allowCopy: share.allowCopy,
      allowEdit: share.allowEdit,
    };
  }

  async hasPassword(shareId: string): Promise<boolean> {
    const share = await this.prismaService.baseShare.findUnique({
      where: { shareId },
      select: { password: true, enabled: true },
    });

    if (!share || !share.enabled) {
      return false;
    }

    return !!share.password;
  }
}
