import { Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { IUserMeVo } from '@teable/openapi';
import type { Request } from 'express';
import { splitAccessToken } from '../../access-token/access-token.encryptor';
import { AccessTokenService } from '../../access-token/access-token.service';
import { UserModel } from '../../model/user';
import { Public } from '../decorators/public.decorator';
import { pickUserMe } from '../utils';

/**
 * 通过 access token 自动登录的 Controller
 * 这个 API 接收 access token，验证后创建 session cookie，实现自动登录
 */
@Controller('api/auth')
export class AutoLoginController {
  constructor(
    private readonly userModel: UserModel,
    private readonly accessTokenService: AccessTokenService
  ) {}

  @Public()
  @Post('auto-login')
  async autoLogin(@Req() req: Request): Promise<IUserMeVo> {
    // 从 Authorization header 获取 access token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const accessToken = authHeader.substring(7);

    // 解析 access token 格式：pat_accessTokenId_encryptedSign 或 pat_accessTokenId_sign（未加密）
    const accessTokenObj = splitAccessToken(accessToken);
    let accessTokenId: string;
    let sign: string;

    if (accessTokenObj) {
      // 标准格式（加密的 sign）
      accessTokenId = accessTokenObj.accessTokenId;
      sign = accessTokenObj.sign;
    } else {
      // 尝试解析简化格式：pat_accessTokenId_sign（未加密，用于直接创建的 token）
      const parts = accessToken.split('_');
      if (parts.length === 3 && parts[0] === 'pat') {
        accessTokenId = parts[1];
        sign = parts[2];
      } else {
        throw new UnauthorizedException('Invalid access token format');
      }
    }

    // 使用 access token 验证用户
    try {
      // 验证 access token
      const { userId } = await this.accessTokenService.validate({
        accessTokenId,
        sign,
      });

      // 获取用户信息（通过 UserModel 获取原始数据）
      const userRaw = await this.userModel.getUserRawById(userId);
      if (!userRaw) {
        throw new UnauthorizedException('User not found');
      }

      // 检查用户是否被停用
      if (userRaw.deactivatedTime) {
        throw new UnauthorizedException('Account has been deactivated');
      }

      // 创建 session cookie（使用 Passport 的 login 方法）
      const userMe = pickUserMe({
        id: userRaw.id,
        name: userRaw.name,
        phone: userRaw.phone,
        email: userRaw.email,
        password: userRaw.password,
        notifyMeta: userRaw.notifyMeta,
        isAdmin: userRaw.isAdmin,
        lang: userRaw.lang,
        avatar: userRaw.avatar,
      });
      await new Promise<void>((resolve, reject) => {
        req.login(userMe, (err) => (err ? reject(err) : resolve()));
      });

      return userMe;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        `Auto login failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
