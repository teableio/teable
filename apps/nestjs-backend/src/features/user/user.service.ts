import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { Prisma } from '@teable-group/db-main-prisma';

@Injectable()
export class UserService {
  constructor(private readonly prismaService: PrismaService) {}

  async getUserById(id: string) {
    return await this.prismaService.user.findUnique({ where: { id, deletedTime: null } });
  }

  async getUserByEmail(email: string) {
    return await this.prismaService.user.findUnique({ where: { email, deletedTime: null } });
  }

  async createUser(user: Prisma.UserCreateInput) {
    return await this.prismaService.user.create({ data: user });
  }
}
