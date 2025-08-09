/* eslint-disable sonarjs/no-duplicate-string */
import { join } from 'path';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRandomString, HttpErrorCode, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  PluginStatus,
  PrincipalType,
  UploadType,
  type IUserInfoVo,
  type IUserMeVo,
} from '@teable/openapi';
import { Knex } from 'knex';
import { omit, pick } from 'lodash';
import ms from 'ms';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { PermissionService } from './permission.service';
import type { IJwtAuthAutomationInfo, IJwtAuthInfo } from './strategies/types';

@Injectable()
export class AuthService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService,
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
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

  async getTempAutomationToken(baseId: string, expiresIn: string = '10m') {
    const payload: IJwtAuthAutomationInfo = {
      baseId,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload, { expiresIn }),
      expiresTime: new Date(Date.now() + ms(expiresIn)).toISOString(),
    };
  }
}
