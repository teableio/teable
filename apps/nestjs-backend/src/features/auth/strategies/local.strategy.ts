/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { HttpErrorCode } from '@teable/core';
import type { Request } from 'express';
import { Strategy } from 'passport-local';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import { CustomHttpException } from '../../../custom.exception';
import type { ISigninFailedReason } from '../../user/user.service';
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
    // Set where this method knows why the attempt failed; otherwise the audit row takes the
    // reason from the account's state (not registered, no password, system user).
    let reason: ISigninFailedReason | undefined;
    try {
      const turnstileToken = req.body?.turnstileToken;
      const remoteIp =
        req.ip || req.connection.remoteAddress || (req.headers['x-forwarded-for'] as string);
      const user = await this.authService
        .validateUserByEmailWithTurnstile(email, password, turnstileToken, remoteIp)
        .catch((error: unknown) => {
          // Turnstile rejects with a plain BadRequestException, the account checks don't.
          if (error instanceof BadRequestException) reason = 'captcha';
          throw error;
        });
      if (!user) {
        reason = 'wrong-password';
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
        reason = 'deactivated';
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
    } catch {
      const { lockoutEnabled, maxLoginAttempts, accountLockoutMinutes } = this.authConfig.signin;
      if (!lockoutEnabled) {
        await this.userService.recordSigninFailure({ email, method: 'password', reason });
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
      const lockoutKey = `signin:lockout:${email}` as const;
      const attemptsKey = `signin:attempts:${email}` as const;
      // Cache TTLs are in seconds
      const lockoutSeconds = accountLockoutMinutes * 60;
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
      const isLocked = await this.cacheService.get(lockoutKey);
      if (isLocked) {
        await this.userService.recordSigninFailure({ email, method: 'password', reason: 'locked' });
        throw lockError;
      }
      // Atomic increment prevents races; failures are counted over the same
      // window the lockout lasts, so slow guessing cannot slip under the limit
      const attempts = await this.cacheService.incr(attemptsKey, lockoutSeconds);
      if (attempts >= maxLoginAttempts) {
        await this.cacheService.set(lockoutKey, true, lockoutSeconds);
        await this.cacheService.expire(attemptsKey, 1);
        await this.userService.recordSigninFailure({
          email,
          method: 'password',
          reason,
          attempts,
          lockoutMinutes: accountLockoutMinutes,
        });
        throw lockError;
      }
      await this.userService.recordSigninFailure({ email, method: 'password', reason, attempts });
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
