import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { Prisma } from '@teable-group/db-main-prisma';
import { SpaceService } from '../space/space.service';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly spaceService: SpaceService
  ) {}

  async getUserById(id: string) {
    return await this.prismaService.user.findUnique({ where: { id, deletedTime: null } });
  }

  async getUserByEmail(email: string) {
    return await this.prismaService.user.findUnique({ where: { email, deletedTime: null } });
  }

  async createUser(user: Prisma.UserCreateInput) {
    // default space created
    return await this.prismaService.$transaction(async (prisma) => {
      const newUser = await prisma.user.create({ data: user });
      const { id, name } = newUser;
      await this.spaceService.createSpaceBySignup(prisma, { name: `${name}'s space` }, id);
      return newUser;
    });
  }
}
