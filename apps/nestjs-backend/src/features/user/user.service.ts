import { Injectable } from '@nestjs/common';
import { generateSpaceId, SpaceRole } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { ICreateSpaceRo, IUserNotifyMeta } from '@teable-group/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async getUserById(id: string) {
    const userRaw = await this.prismaService.user.findUnique({ where: { id, deletedTime: null } });

    return (
      userRaw && {
        ...userRaw,
        notifyMeta: userRaw.notifyMeta && JSON.parse(userRaw.notifyMeta),
      }
    );
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
    // defaults
    const defaultNotifyMeta: IUserNotifyMeta = {
      email: true,
    };

    user = {
      ...user,
      notifyMeta: JSON.stringify(defaultNotifyMeta),
    };
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

  async updateUserName(id: string, name: string) {
    await this.prismaService.txClient().user.update({
      data: {
        name,
      },
      where: { id, deletedTime: null },
    });
  }

  async updateAvatar(id: string, avatar: string) {
    await this.prismaService.txClient().user.update({
      data: {
        avatar,
      },
      where: { id, deletedTime: null },
    });
  }

  async updateNotifyMeta(id: string, notifyMetaRo: IUserNotifyMeta) {
    await this.prismaService.txClient().user.update({
      data: {
        notifyMeta: JSON.stringify(notifyMetaRo),
      },
      where: { id, deletedTime: null },
    });
  }
}
