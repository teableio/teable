import { BadRequestException, Injectable } from '@nestjs/common';
import type { SpaceRole } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  ListSpaceCollaboratorVo,
  UpdateSpaceCollaborateRo,
  ListBaseCollaboratorVo,
} from '@teable-group/openapi';
import { Knex } from 'knex';
import { isDate } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class CollaboratorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async createSpaceCollaborator(userId: string, spaceId: string, role: SpaceRole) {
    const currentUserId = this.cls.get('user.id');
    const exist = await this.prismaService
      .txClient()
      .collaborator.count({ where: { userId, spaceId, deletedTime: null } });
    if (exist) {
      throw new BadRequestException('has already existed in space');
    }
    return await this.prismaService.txClient().collaborator.create({
      data: {
        spaceId,
        roleName: role,
        userId,
        createdBy: currentUserId,
        lastModifiedBy: currentUserId,
      },
    });
  }

  async deleteBySpaceId(spaceId: string) {
    return await this.prismaService.txClient().collaborator.updateMany({
      where: {
        spaceId,
      },
      data: {
        deletedTime: new Date().toISOString(),
      },
    });
  }

  async getListByBase(baseId: string): Promise<ListBaseCollaboratorVo> {
    const base = await this.prismaService
      .txClient()
      .base.findUniqueOrThrow({ select: { spaceId: true }, where: { id: baseId } });

    return await this.getCollaborators({ spaceId: base.spaceId, baseId });
  }

  async getListBySpace(spaceId: string): Promise<ListSpaceCollaboratorVo> {
    return await this.getCollaborators({ spaceId });
  }

  private async getCollaborators(params: {
    spaceId: string;
    baseId?: string;
  }): Promise<ListSpaceCollaboratorVo | ListBaseCollaboratorVo> {
    const { spaceId, baseId } = params;
    const getCollaboratorsSql = this.knex
      .select({
        userId: 'u.id',
        userName: 'u.name',
        email: 'u.email',
        avatar: 'u.avatar',
        role: 'c.role_name',
        createdTime: 'c.created_time',
      })
      .from(this.knex.ref('collaborator').as('c'))
      .join(this.knex.ref('users').as('u'), (clause) => {
        clause.on('c.user_id', 'u.id').andOnNull('c.deleted_time').andOnNull('u.deleted_time');
      })
      .where((builder) => {
        builder.where('c.space_id', spaceId);
        if (baseId) {
          builder.orWhere('c.base_id', baseId);
        } else {
          builder.whereNull('c.base_id');
        }
      });

    const collaborators = await this.prismaService
      .txClient()
      .$queryRawUnsafe<ListSpaceCollaboratorVo | ListBaseCollaboratorVo>(
        getCollaboratorsSql.toQuery()
      );

    return collaborators.map((collaborator) => {
      if (isDate(collaborator.createdTime)) {
        collaborator.createdTime = collaborator.createdTime.toISOString();
      }
      return collaborator;
    });
  }

  async deleteCollaborator(spaceId: string, userId: string) {
    return await this.prismaService.txClient().collaborator.updateMany({
      where: {
        spaceId,
        userId,
      },
      data: {
        deletedTime: new Date().toISOString(),
      },
    });
  }

  async updateCollaborator(spaceId: string, updateCollaborator: UpdateSpaceCollaborateRo) {
    const currentUserId = this.cls.get('user.id');
    const { userId, role } = updateCollaborator;
    return await this.prismaService.txClient().collaborator.updateMany({
      where: {
        spaceId,
        userId,
      },
      data: {
        roleName: role,
        lastModifiedBy: currentUserId,
        lastModifiedTime: new Date().toISOString(),
      },
    });
  }

  async getCollaboratorsBaseAndSpaceArray(userId: string) {
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        userId,
        deletedTime: null,
      },
      select: {
        roleName: true,
        baseId: true,
        spaceId: true,
      },
    });
    const roleMap: Record<string, SpaceRole> = {};
    const baseIds = new Set<string>();
    const spaceIds = new Set<string>();
    collaborators.forEach(({ baseId, spaceId, roleName }) => {
      if (baseId) {
        baseIds.add(baseId);
        roleMap[baseId] = roleName as SpaceRole;
      }
      if (spaceId) {
        spaceIds.add(spaceId);
        roleMap[spaceId] = roleName as SpaceRole;
      }
    });
    return {
      baseIds: Array.from(baseIds),
      spaceIds: Array.from(spaceIds),
      roleMap: roleMap,
    };
  }
}
