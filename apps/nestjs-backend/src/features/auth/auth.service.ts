import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { generateUserId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IChangePasswordRo } from '@teable/openapi';
import * as bcrypt from 'bcrypt';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { UserService } from '../user/user.service';
import { SessionStoreService } from './session/session-store.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>,
    private readonly sessionStoreService: SessionStoreService
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

  async validateUserByEmail(email: string, pass: string) {
    const user = await this.userService.getUserByEmail(email);
    if (user) {
      const { password, salt, ...result } = user;
      return (await this.comparePassword(pass, password, salt)) ? result : null;
    }
    return null;
  }

  async signup(email: string, password: string) {
    const user = await this.userService.getUserByEmail(email);
    if (user) {
      throw new HttpException(`User ${email} is already registered`, HttpStatus.BAD_REQUEST);
    }
    const { salt, hashPassword } = await this.encodePassword(password);
    return await this.userService.createUser({
      id: generateUserId(),
      name: email.split('@')[0],
      email,
      salt,
      password: hashPassword,
      lastSignTime: new Date().toISOString(),
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
    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new InternalServerErrorException('User not found');
    }
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
}
