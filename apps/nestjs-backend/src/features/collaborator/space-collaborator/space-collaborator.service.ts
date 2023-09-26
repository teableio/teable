import { Injectable } from '@nestjs/common';
import { SpaceRole } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';

@Injectable()
export class SpaceCollaboratorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async registerSpaceOwner(spaceId: string) {
    const userId = this.cls.get('user.id');
    return await this.prismaService.txClient().spaceCollaborator.create({
      data: { spaceId, roleName: SpaceRole.Owner, userId },
    });
  }
}
