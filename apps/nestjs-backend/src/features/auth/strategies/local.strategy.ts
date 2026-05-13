/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { HttpErrorCode } from '@teable/core';
import type { Request } from 'express';
import { Strategy } from 'passport-local';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import { CustomHttpException } from '../../../custom.exception';
import { UserService } from '../../user/user.service';
import { LocalAuthService } from '../local-auth/local-auth.service';
import { pickUserMe } from '../utils';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    private readonly authService: LocalAuthService,
    private readonly cacheService: CacheService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {
    super({
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, email: string, password: string) {
    try {
      const turnstileToken = req.body?.turnstileToken;
      const remoteIp =
        req.ip || req.connection.remoteAddress || (req.headers['x-forwarded-for'] as string);
      const user = await this.authService.validateUserByEmailWithTurnstile(
        email,
        password,
        turnstileToken,
        remoteIp
      );
      if (!user) {
        throw new CustomHttpException(
          'Email or password is incorrect',
          HttpErrorCode.INVALID_CREDENTIALS,
          {
            localization: {
              i18nKey: 'httpErrors.auth.emailOrPasswordIncorrect',
            },
          }
        );
      }
      if (user.deactivatedTime) {
        throw new CustomHttpException(
          `Your account has been deactivated by the administrator`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.auth.accountDeactivated',
            },
          }
        );
      }
      await this.userService.refreshLastSignTime(user.id);
      return pickUserMe(user);
    } catch (error) {
      const { maxLoginAttempts, accountLockoutMinutes } = this.authConfig.signin;
      const hasLockout = maxLoginAttempts && accountLockoutMinutes;
      const isLockout = await this.cacheService.get(`signin:lockout:${email}`);
      if (!hasLockout) {
        throw new CustomHttpException(
          `Email or password is incorrect`,
          HttpErrorCode.INVALID_CREDENTIALS,
          {
            localization: {
              i18nKey: 'httpErrors.auth.emailOrPasswordIncorrect',
            },
          }
        );
      }
      const lockError = new CustomHttpException(
        `Your account has been locked out, please try again after ${accountLockoutMinutes} minutes`,
        HttpErrorCode.TOO_MANY_REQUESTS,
        {
          minutes: accountLockoutMinutes,
          localization: {
            i18nKey: 'httpErrors.auth.accountLockedOut',
          },
        }
      );
      if (isLockout) {
        throw lockError;
      }
      // Use atomic increment to prevent race conditions
      const attempts = await this.cacheService.incr(`signin:attempts:${email}`, 30);
      if (attempts >= maxLoginAttempts) {
        await this.cacheService.set(`signin:lockout:${email}`, true, accountLockoutMinutes);
        await this.cacheService.expire(`signin:attempts:${email}`, 1);
        throw lockError;
      }
      throw new CustomHttpException(
        'Email or password is incorrect',
        HttpErrorCode.INVALID_CREDENTIALS,
        {
          attempts,
          localization: {
            i18nKey: 'httpErrors.auth.emailOrPasswordIncorrect',
          },
        }
      );
    }
  }
}
