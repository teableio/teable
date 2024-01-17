import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { generateUserId } from '@teable-group/core';
import * as bcrypt from 'bcrypt';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../configs/auth.config';
import type { IClsStore } from '../../types/cls';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<IClsStore>,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {}

  async validateUserByEmail(email: string, pass: string) {
    const user = await this.userService.getUserByEmail(email);
    if (user) {
      const { password, salt, ...result } = user;
      const hashPassword = await bcrypt.hash(pass || '', salt || '');
      return hashPassword === password ? result : null;
    }
    return null;
  }

  async signup(email: string, password: string) {
    const user = await this.userService.getUserByEmail(email);
    if (user) {
      throw new HttpException(`User ${email} is already registered`, HttpStatus.BAD_REQUEST);
    }
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);
    return await this.userService.createUser({
      id: generateUserId(),
      name: email.split('@')[0],
      email,
      salt,
      password: hashPassword,
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
}
