import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateUserId } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<{ id: string }>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  async validateUserByEmail(email: string, pass: string) {
    const user = await this.userService.getUserByEmail(email);
    if (user) {
      const { password, salt, ...result } = user;
      const hashPassword = await bcrypt.hash(pass || '', salt || '');
      return hashPassword === password ? result : null;
    }
    return null;
  }

  async signin(user: Prisma.UserGetPayload<null>) {
    return {
      access_token: await this.jwtService.signAsync({ id: user.id }),
    };
  }

  async signup(email: string, password: string) {
    const user = await this.userService.getUserByEmail(email);
    if (user) {
      throw new HttpException(`User ${email} is already registered`, HttpStatus.BAD_REQUEST);
    }
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);
    const newUser = await this.userService.createUser({
      id: generateUserId(),
      name: email.split('@')[0],
      email,
      salt,
      password: hashPassword,
    });
    return {
      access_token: await this.jwtService.signAsync({ id: newUser.id }),
    };
  }
}
