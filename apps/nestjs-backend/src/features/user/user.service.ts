import { Injectable } from '@nestjs/common';
import { SpaceRole, generateSpaceId } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { ICreateSpaceRo } from '@teable-group/openapi';
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

  async createSpaceBySignup(createSpaceRo: ICreateSpaceRo) {
    const userId = this.cls.get('user.id');
    const uniqName = createSpaceRo.name ?? 'Space';

    const space = await this.prismaService.txClient().space.create({
      select: {
        id: true,
        name: true,
      },
      data: {
        id: generateSpaceId(),
        name: uniqName,
        createdBy: userId,
        lastModifiedBy: userId,
      },
    });
    await this.prismaService.txClient().collaborator.create({
      data: {
        spaceId: space.id,
        roleName: SpaceRole.Owner,
        userId,
        createdBy: userId,
        lastModifiedBy: userId,
      },
    });
    return space;
  }

  async createUser(user: Prisma.UserCreateInput) {
    // default space created
    return await this.prismaService.$tx(async (prisma) => {
      const newUser = await prisma.user.create({ data: user });
      const { id, name } = newUser;
      await this.cls.runWith(this.cls.get(), async () => {
        this.cls.set('user.id', id);
        await this.createSpaceBySignup({ name: `${name}'s space` });
      });
      return newUser;
    });
  }
}
