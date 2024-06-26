import type { CanActivate } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {}

  async canActivate() {
    const userId = this.cls.get('user.id');

    const user = await this.prismaService.txClient().user.findUnique({
      where: { id: userId, deletedTime: null, deactivatedTime: null },
    });

    if (!user || !user.isAdmin) {
      throw new ForbiddenException('User is not an admin');
    }

    return true;
  }
}
