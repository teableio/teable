import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';
import { hashSharePassword } from '../../utils/share-password-hash';
import { TeableJwtService } from '../auth/jwt/teable-jwt.service';

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
  // sha256 over shareId + password (see hashSharePassword); never the password.
  pwHash: string;
}

@Injectable()
export class BaseShareAuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: TeableJwtService
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtBaseShareInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  private async getSharePassword(shareId: string): Promise<string | null> {
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
    return password;
  }

  async authBaseShare(shareId: string, pass: string): Promise<string | null> {
    const password = await this.getSharePassword(shareId);
    return password !== null && pass === password ? shareId : null;
  }

  /** Cookie counterpart of authBaseShare: compares the hash the cookie carries. */
  async authBaseShareByHash(shareId: string, pwHash: string): Promise<string | null> {
    const password = await this.getSharePassword(shareId);
    return password !== null && hashSharePassword(shareId, password) === pwHash ? shareId : null;
  }

  async authToken(shareId: string, password: string) {
    const payload: IJwtBaseShareInfo = { shareId, pwHash: hashSharePassword(shareId, password) };
    // Same lifetime the BaseShareModule JwtModule registration used to apply.
    return await this.jwtService.signAsync(payload, { expiresIn: '7d' });
  }

  async getBaseShareInfo(shareId: string): Promise<IBaseShareInfo> {
    const share = await this.prismaService.baseShare.findUnique({
      where: { shareId },
    });

    if (!share || !share.enabled) {
      throw new CustomHttpException('Project share not found', HttpErrorCode.NOT_FOUND, {
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
