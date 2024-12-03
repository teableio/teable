import { Injectable } from '@nestjs/common';
import type { IUserInfoVo, IUserMeVo } from '@teable/openapi';
import { omit, pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from './permission.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService
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
}
