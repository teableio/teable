import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { Prisma } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { SpaceService } from '../space/space.service';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly spaceService: SpaceService,
    private readonly cls: ClsService
  ) {}

  async getUserById(id: string) {
    return await this.prismaService.user.findUnique({ where: { id, deletedTime: null } });
  }

  async getUserByEmail(email: string) {
    return await this.prismaService.user.findUnique({ where: { email, deletedTime: null } });
  }

  async createUser(user: Prisma.UserCreateInput) {
    // default space created
    return await this.prismaService.$tx(async (prisma) => {
      const newUser = await prisma.user.create({ data: user });
      const { id, name } = newUser;
      await this.cls.runWith(this.cls.get(), async () => {
        this.cls.set('user.id', id);
        await this.spaceService.createSpaceBySignup({ name: `${name}'s space` });
      });
      return newUser;
    });
  }
}
