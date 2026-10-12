/* eslint-disable sonarjs/no-duplicate-string */
import { Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { type ITokenUserInfoVo, type IUserMeVo } from '@teable/openapi';
import { omit, pick } from 'lodash';
import ms from 'ms';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { TeableJwtService } from './jwt/teable-jwt.service';
import { PermissionService } from './permission.service';
import { JwtAuthInternalType } from './strategies/types';
import type { IJwtAuthInternalInfo, IJwtAuthInfo } from './strategies/types';
import { USER_PLANS_RESOLVER, type IUserPlansResolver } from './user-plans-resolver';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService,
    private readonly jwtService: TeableJwtService,
    @Optional()
    @Inject(USER_PLANS_RESOLVER)
    private readonly userPlansResolver?: IUserPlansResolver
  ) {}

  async getUserInfo(user: IUserMeVo): Promise<ITokenUserInfoVo> {
    const res = pick(user, ['id', 'email', 'avatar', 'name']);
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) {
      return res;
    }
    const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
    const resolver = this.userPlansResolver;
    const [spaces, selfHostedLicenses] = await Promise.all([
      scopes.includes('user|spaces_read') && resolver
        ? this.readPlans('spaces', () => resolver.getSpaces(user.id))
        : undefined,
      scopes.includes('user|self_hosted_licenses_read') && resolver
        ? this.readPlans('self-hosted licenses', () => resolver.getSelfHostedLicenses(user.id))
        : undefined,
    ]);
    return {
      ...(scopes.includes('user|email_read') ? res : omit(res, 'email')),
      ...(spaces ? { spaces } : {}),
      ...(selfHostedLicenses ? { selfHostedLicenses } : {}),
    };
  }

  // Plans ride along with the user an app signs in; a billing read that fails leaves them out
  // rather than failing the sign-in.
  private async readPlans<T>(what: string, read: () => Promise<T>): Promise<T | undefined> {
    try {
      return await read();
    } catch (error) {
      this.logger.error(`Could not read the user's ${what} for the userinfo`, error);
      return undefined;
    }
  }

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtAuthInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  async getTempToken(
    options: {
      expiresIn?: string;
      /** Defaults to the current user. */
      userId?: string;
      allowSystemUser?: boolean;
      source?: IJwtAuthInfo['source'];
      sandboxPrincipal?: IJwtAuthInfo['sandboxPrincipal'];
    } = {}
  ) {
    const { expiresIn = '10m', userId, allowSystemUser, source } = options;
    // a token minted inside a sandbox keeps its source and principal on a fresh temp token
    const effectiveSource = source ?? this.cls.get('authSource');
    const sandboxPrincipal = options.sandboxPrincipal ?? this.cls.get('sandboxPrincipal');
    const payload: IJwtAuthInfo = {
      userId: userId ?? this.cls.get('user.id'),
      ...(allowSystemUser ? { allowSystemUser: true } : {}),
      ...(effectiveSource ? { source: effectiveSource } : {}),
      ...(sandboxPrincipal ? { sandboxPrincipal } : {}),
    };
    return {
      accessToken: await this.jwtService.signAsync(payload, { expiresIn }),
      expiresTime: new Date(Date.now() + ms(expiresIn)).toISOString(),
    };
  }

  async getTempInternalToken(
    baseId: string,
    type: JwtAuthInternalType,
    expiresIn: string = '10m',
    context?: IJwtAuthInternalInfo['context']
  ) {
    // For User type tokens, userId is required
    const userId = this.cls.get('user.id');
    if (type === JwtAuthInternalType.User && !userId) {
      throw new UnauthorizedException('User identity is required for User type tokens');
    }

    const payload = {
      type,
      baseId,
      // Include userId for User type tokens to maintain user identity
      ...(type === JwtAuthInternalType.User ? { userId } : {}),
      ...(context ? { context } : {}),
    } as IJwtAuthInternalInfo;
    return {
      accessToken: await this.jwtService.signAsync(payload, { expiresIn }),
      expiresTime: new Date(Date.now() + ms(expiresIn)).toISOString(),
    };
  }
}
