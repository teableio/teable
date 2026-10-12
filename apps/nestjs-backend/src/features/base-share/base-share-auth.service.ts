import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { hashSharePassword } from '../../utils/share-password-hash';
import { AuditScope } from '../audit/audit-scope';
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
    private readonly jwtService: TeableJwtService,
    private readonly cls: ClsService<IClsStore>,
    private readonly audit: AuditScope
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtBaseShareInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  private async getSharePassword(
    shareId: string
  ): Promise<{ password: string; baseId: string } | null> {
    const share = await this.prismaService.baseShare.findUnique({
      where: { shareId },
      select: { shareId: true, password: true, enabled: true, baseId: true },
    });

    if (!share?.enabled) {
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
    return { password, baseId: share.baseId };
  }

  /**
   * The password form of a shared project. Every attempt on a live share is audited, the wrong
   * ones as `share.base.auth-failed` so a guessing run stays visible; `actorId` is the visitor's
   * own session user when they are signed in, else the row goes to 'anonymous'.
   */
  async authBaseShare(shareId: string, pass: string, actorId?: string): Promise<string | null> {
    const share = await this.getSharePassword(shareId);
    if (!share) {
      return null;
    }
    const userId = actorId ?? this.cls.get('user.id') ?? 'anonymous';
    const params = { shareId, baseId: share.baseId };
    if (pass !== share.password) {
      await this.audit.emitAtomic({
        action: 'share.base.auth-failed',
        resourceId: shareId,
        userId,
        params,
      });
      return null;
    }
    await this.audit.emitAtomic({
      action: 'share.base.auth',
      resourceId: shareId,
      userId,
      params,
    });
    return shareId;
  }

  /** Cookie counterpart of authBaseShare: compares the hash the cookie carries. */
  async authBaseShareByHash(shareId: string, pwHash: string): Promise<string | null> {
    const share = await this.getSharePassword(shareId);
    return share !== null && hashSharePassword(shareId, share.password) === pwHash ? shareId : null;
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

    if (!share?.enabled) {
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

    if (!share?.enabled) {
      return false;
    }

    return !!share.password;
  }
}
