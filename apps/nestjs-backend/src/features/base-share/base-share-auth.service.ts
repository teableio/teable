import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { CustomHttpException } from '../../custom.exception';

export interface IBaseShareInfo {
  shareId: string;
  baseId: string;
  nodeId: string | null;
  allowSave: boolean | null;
  allowCopy: boolean | null;
  allowEdit: boolean | null;
}

/**
 * JWT payload for base share authentication.
 * Contains only a shareId and a random nonce -- no plaintext password.
 */
export interface IJwtBaseShareInfo {
  shareId: string;
  /** Random nonce to ensure each auth produces a unique token */
  nonce: string;
  /**
   * @deprecated Legacy field -- old JWTs issued before bcrypt migration may
   * contain a plaintext `password` instead of `nonce`. Kept for backward compat.
   */
  password?: string;
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

  /**
   * Check if a stored password is a bcrypt hash (starts with "$2b$" or "$2a$").
   */
  private isBcryptHash(storedPassword: string): boolean {
    return /^\$2[aby]\$/.test(storedPassword);
  }

  async authBaseShare(shareId: string, pass: string): Promise<string | null> {
    const share = await this.prismaService.baseShare.findUnique({
      where: { shareId },
      select: { shareId: true, password: true, enabled: true },
    });

    if (!share || !share.enabled) {
      return null;
    }

    const storedPassword = share.password;
    if (!storedPassword) {
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

    // Support both bcrypt hashes (new) and plaintext passwords (legacy/transition)
    if (this.isBcryptHash(storedPassword)) {
      const match = await bcrypt.compare(pass, storedPassword);
      return match ? shareId : null;
    }

    // Legacy plaintext comparison (backward compatibility)
    return pass === storedPassword ? shareId : null;
  }

  async authToken(shareId: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload: IJwtBaseShareInfo = { shareId, nonce };
    return await this.jwtService.signAsync(payload);
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
