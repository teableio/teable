import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { generateUserId, getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IChangePasswordRo } from '@teable/openapi';
import * as bcrypt from 'bcrypt';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { AuthConfig, type IAuthConfig } from '../../configs/auth.config';
import { MailConfig, type IMailConfig } from '../../configs/mail.config';
import type { IClsStore } from '../../types/cls';
import { second } from '../../utils/second';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { UserService } from '../user/user.service';
import { SessionStoreService } from './session/session-store.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>,
    private readonly sessionStoreService: SessionStoreService,
    private readonly mailSenderService: MailSenderService,
    private readonly cacheService: CacheService,
    @AuthConfig() private readonly authConfig: IAuthConfig,
    @MailConfig() private readonly mailConfig: IMailConfig
  ) {}

  private async encodePassword(password: string) {
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);
    return { salt, hashPassword };
  }

  private async comparePassword(
    password: string,
    hashPassword: string | null,
    salt: string | null
  ) {
    const _hashPassword = await bcrypt.hash(password || '', salt || '');
    return _hashPassword === hashPassword;
  }

  private async getUserByIdOrThrow(userId: string) {
    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return user;
  }

  async validateUserByEmail(email: string, pass: string) {
    const user = await this.userService.getUserByEmail(email);
    if (!user) {
      throw new BadRequestException(`${email} not registered`);
    }
    const { password, salt, ...result } = user;
    return (await this.comparePassword(pass, password, salt)) ? { ...result, password } : null;
  }

  async signup(email: string, password: string) {
    const user = await this.userService.getUserByEmail(email);
    if (user) {
      throw new HttpException(`User ${email} is already registered`, HttpStatus.BAD_REQUEST);
    }
    const { salt, hashPassword } = await this.encodePassword(password);
    return await this.prismaService.$tx(async () => {
      return await this.userService.createUser({
        id: generateUserId(),
        name: email.split('@')[0],
        email,
        salt,
        password: hashPassword,
        lastSignTime: new Date().toISOString(),
      });
    });
  }

  async signout(req: Express.Request) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy(function (err) {
        // cannot access session here
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async changePassword({ password, newPassword }: IChangePasswordRo) {
    const userId = this.cls.get('user.id');
    const user = await this.getUserByIdOrThrow(userId);

    const { password: currentHashPassword, salt } = user;
    if (!(await this.comparePassword(password, currentHashPassword, salt))) {
      throw new BadRequestException('Password is incorrect');
    }
    const { salt: newSalt, hashPassword: newHashPassword } = await this.encodePassword(newPassword);
    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null },
      data: {
        password: newHashPassword,
        salt: newSalt,
      },
    });
    // clear session
    await this.sessionStoreService.clearByUserId(userId);
  }

  async refreshLastSignTime(userId: string) {
    await this.prismaService.user.update({
      where: { id: userId, deletedTime: null },
      data: { lastSignTime: new Date().toISOString() },
    });
  }

  async sendResetPasswordEmail(email: string) {
    const user = await this.userService.getUserByEmail(email);
    if (!user) {
      throw new BadRequestException('Email is not registered');
    }
    const resetPasswordCode = getRandomString(30);

    const url = `${this.mailConfig.origin}/auth/reset-password?code=${resetPasswordCode}`;
    const resetPasswordEmailOptions = this.mailSenderService.resetPasswordEmailOptions({
      name: user.name,
      email: user.email,
      resetPasswordUrl: url,
    });
    await this.mailSenderService.sendMail({
      to: user.email,
      ...resetPasswordEmailOptions,
    });
    await this.cacheService.set(
      `reset-password-email:${resetPasswordCode}`,
      { userId: user.id },
      second(this.authConfig.resetPasswordEmailExpiresIn)
    );
  }

  async resetPassword(code: string, newPassword: string) {
    const resetPasswordEmail = await this.cacheService.get(`reset-password-email:${code}`);
    if (!resetPasswordEmail) {
      throw new BadRequestException('Token is invalid');
    }
    const { userId } = resetPasswordEmail;
    const { salt, hashPassword } = await this.encodePassword(newPassword);
    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null },
      data: {
        password: hashPassword,
        salt,
      },
    });
    await this.cacheService.del(`reset-password-email:${code}`);
  }

  async addPassword(newPassword: string) {
    const userId = this.cls.get('user.id');
    const user = await this.getUserByIdOrThrow(userId);

    if (user.password) {
      throw new BadRequestException('Password is already set');
    }
    const { salt, hashPassword } = await this.encodePassword(newPassword);
    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null, password: null },
      data: {
        password: hashPassword,
        salt,
      },
    });
  }
}
