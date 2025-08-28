/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type IUserInfoVo, type IUserMeVo } from '@teable/openapi';
import { omit, pick } from 'lodash';
import ms from 'ms';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from './permission.service';
import type { IJwtAuthInternalInfo, IJwtAuthInfo, JwtAuthInternalType } from './strategies/types';

@Injectable()
export class AuthService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService,
    private readonly jwtService: JwtService
  ) {}

  async getUserInfo(user: IUserMeVo): Promise<IUserInfoVo> {
    const res = pick(user, ['id', 'email', 'avatar', 'name']);
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) {
      return res;
    }
    const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
    if (!scopes.includes('user|email_read')) {
      return omit(res, 'email');
    }
    return res;
  }

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtAuthInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  async getTempToken() {
    const payload: IJwtAuthInfo = {
      userId: this.cls.get('user.id'),
    };
    const expiresIn = '10m';
    return {
      accessToken: await this.jwtService.signAsync(payload, { expiresIn }),
      expiresTime: new Date(Date.now() + ms(expiresIn)).toISOString(),
    };
  }

  async getTempInternalToken(baseId: string, type: JwtAuthInternalType, expiresIn: string = '10m') {
    const payload: IJwtAuthInternalInfo = {
      type,
      baseId,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload, { expiresIn }),
      expiresTime: new Date(Date.now() + ms(expiresIn)).toISOString(),
    };
  }
}
