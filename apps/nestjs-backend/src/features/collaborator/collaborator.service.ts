import { BadRequestException, Injectable } from '@nestjs/common';
import type { SpaceRole } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ListBaseCollaboratorVo,
  ListSpaceCollaboratorVo,
  UpdateSpaceCollaborateRo,
} from '@teable/openapi';
import { Knex } from 'knex';
import { isDate } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import {
  CollaboratorCreateEvent,
  CollaboratorDeleteEvent,
  Events,
} from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { getFullStorageUrl } from '../../utils/full-storage-url';

@Injectable()
export class CollaboratorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
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
    const collaborator = await this.prismaService.txClient().collaborator.create({
      data: {
        spaceId,
        roleName: role,
        userId,
        createdBy: currentUserId,
      },
    });
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_CREATE,
      new CollaboratorCreateEvent(spaceId)
    );
    return collaborator;
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

  async getBaseCollabsWithPrimary(tableId: string) {
    const { baseId } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      select: { baseId: true },
      where: { id: tableId },
    });

    const baseCollabs = await this.getListByBase(baseId);
    return baseCollabs.map(({ userId, userName, email }) => ({
      id: userId,
      name: userName,
      email,
    }));
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
      .$queryRawUnsafe<
        ListSpaceCollaboratorVo | ListBaseCollaboratorVo
      >(getCollaboratorsSql.toQuery());

    return collaborators.map((collaborator) => {
      if (isDate(collaborator.createdTime)) {
        collaborator.createdTime = collaborator.createdTime.toISOString();
      }
      if (collaborator.avatar) {
        collaborator.avatar = getFullStorageUrl(collaborator.avatar);
      }
      return collaborator;
    });
  }

  async deleteCollaborator(spaceId: string, userId: string) {
    const result = await this.prismaService.txClient().collaborator.updateMany({
      where: {
        spaceId,
        userId,
      },
      data: {
        deletedTime: new Date().toISOString(),
      },
    });
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_DELETE,
      new CollaboratorDeleteEvent(spaceId)
    );
    return result;
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
