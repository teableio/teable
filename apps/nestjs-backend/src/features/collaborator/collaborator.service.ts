/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { canManageRole, Role, type IBaseRole, type IRole } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  AddBaseCollaboratorRo,
  AddSpaceCollaboratorRo,
  UserCollaboratorItem,
} from '@teable/openapi';
import { CollaboratorType, UploadType, PrincipalType } from '@teable/openapi';
import { Knex } from 'knex';
import { map } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import {
  CollaboratorCreateEvent,
  CollaboratorDeleteEvent,
  Events,
} from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { getMaxLevelRole } from '../../utils/get-max-level-role';
import StorageAdapter from '../attachments/plugins/adapter';
import { getFullStorageUrl } from '../attachments/plugins/utils';

@Injectable()
export class CollaboratorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  private checkPrincipalType(principalType: PrincipalType) {
    if (principalType === PrincipalType.Department) {
      throw new BadRequestException('only support user principal type');
    }
  }

  async createSpaceCollaborator({
    principalId,
    principalType,
    spaceId,
    role,
    createdBy,
  }: {
    principalId: string;
    principalType: PrincipalType;
    spaceId: string;
    role: IRole;
    createdBy?: string;
  }) {
    const currentUserId = createdBy || this.cls.get('user.id');
    const exist = await this.prismaService.txClient().collaborator.count({
      where: {
        principalId,
        principalType,
        resourceId: spaceId,
        resourceType: CollaboratorType.Space,
      },
    });
    if (exist) {
      throw new BadRequestException('has already existed in space');
    }
    // if has exist base collaborator, then delete it
    const bases = await this.prismaService.txClient().base.findMany({
      where: {
        spaceId,
        deletedTime: null,
      },
    });
    await this.prismaService.txClient().collaborator.deleteMany({
      where: {
        principalId,
        principalType,
        resourceId: { in: bases.map((base) => base.id) },
        resourceType: CollaboratorType.Base,
      },
    });
    const collaborator = await this.prismaService.txClient().collaborator.create({
      data: {
        resourceId: spaceId,
        resourceType: CollaboratorType.Space,
        roleName: role,
        principalId,
        principalType,
        createdBy: currentUserId!,
      },
    });
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_CREATE,
      new CollaboratorCreateEvent(spaceId)
    );
    return collaborator;
  }

  private async getBaseCollaboratorBuilder(
    knex: Knex.QueryBuilder,
    baseId: string,
    options?: { includeSystem?: boolean; search?: string; type?: PrincipalType }
  ) {
    const base = await this.prismaService
      .txClient()
      .base.findUniqueOrThrow({ select: { spaceId: true }, where: { id: baseId } });

    const builder = knex
      .from('collaborator')
      .leftJoin('users', 'collaborator.principal_id', 'users.id')
      .whereIn('collaborator.resource_id', [baseId, base.spaceId]);
    const { includeSystem, search, type } = options ?? {};
    if (!includeSystem) {
      builder.where((db) => {
        return db.whereNull('users.is_system').orWhere('users.is_system', false);
      });
    }
    if (search) {
      this.dbProvider.searchBuilder(builder, [
        ['users.name', search],
        ['users.email', search],
      ]);
    }
    if (type) {
      builder.where('collaborator.principal_type', type);
    }
  }

  async getTotalBase(
    baseId: string,
    options?: { includeSystem?: boolean; search?: string; type?: PrincipalType }
  ) {
    const builder = this.knex();
    await this.getBaseCollaboratorBuilder(builder, baseId, options);
    const res = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { count: number }[]
      >(builder.select(this.knex.raw('COUNT(*) as count')).toQuery());
    return Number(res[0].count);
  }

  async getListByBase(
    baseId: string,
    options?: {
      includeSystem?: boolean;
      skip?: number;
      take?: number;
      search?: string;
      type?: PrincipalType;
    }
  ): Promise<UserCollaboratorItem[]> {
    const { skip = 0, take = 50 } = options ?? {};
    const builder = this.knex();
    await this.getBaseCollaboratorBuilder(builder, baseId, options);
    builder.offset(skip);
    builder.limit(take);
    builder.select({
      resource_id: 'collaborator.resource_id',
      role_name: 'collaborator.role_name',
      created_time: 'collaborator.created_time',
      resource_type: 'collaborator.resource_type',
      user_id: 'users.id',
      user_name: 'users.name',
      user_email: 'users.email',
      user_avatar: 'users.avatar',
      user_is_system: 'users.is_system',
    });
    builder.whereNotNull('users.id');
    builder.orderBy('collaborator.created_time', 'asc');
    const collaborators = await this.prismaService.txClient().$queryRawUnsafe<
      {
        resource_id: string;
        role_name: string;
        created_time: Date;
        resource_type: string;
        user_id: string;
        user_name: string;
        user_email: string;
        user_avatar: string;
        user_is_system: boolean | null;
      }[]
    >(builder.toQuery());

    return collaborators.map((collaborator) => ({
      type: PrincipalType.User,
      userId: collaborator.user_id,
      userName: collaborator.user_name,
      email: collaborator.user_email,
      avatar: collaborator.user_avatar
        ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), collaborator.user_avatar)
        : null,
      role: collaborator.role_name as IRole,
      createdTime: collaborator.created_time.toISOString(),
      resourceType: collaborator.resource_type as CollaboratorType,
      isSystem: collaborator.user_is_system || undefined,
    }));
  }

  async getUserCollaboratorsByTableId(
    tableId: string,
    query: {
      containsIn: {
        keys: ('id' | 'name' | 'email' | 'phone')[];
        values: string[];
      };
    }
  ) {
    const { baseId } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      select: { baseId: true },
      where: { id: tableId },
    });

    const base = await this.prismaService.txClient().base.findUniqueOrThrow({
      where: { id: baseId },
      select: { spaceId: true },
    });
    const builder = this.knex('collaborator');
    builder.join('users', 'collaborator.principal_id', 'users.id');
    builder.whereIn('collaborator.resource_id', [baseId, base.spaceId]);
    if (query.containsIn) {
      builder.where((db) => {
        const keys = query.containsIn.keys;
        const values = query.containsIn.values;
        keys.forEach((key) => {
          db.orWhereIn('users.' + key, values);
        });
        return db;
      });
    }
    builder.orderBy('collaborator.created_time', 'asc');
    builder.select({
      user_id: 'users.id',
      user_name: 'users.name',
      user_email: 'users.email',
      user_avatar: 'users.avatar',
      user_is_system: 'users.is_system',
    });
    const collaborators = await this.prismaService.txClient().$queryRawUnsafe<
      {
        user_id: string;
        user_name: string;
        user_email: string;
        user_avatar: string | null;
        user_is_system: boolean | null;
      }[]
    >(builder.toQuery());
    return collaborators.map(({ user_id, user_name, user_email, user_avatar, user_is_system }) => ({
      id: user_id,
      name: user_name,
      email: user_email,
      avatar: user_avatar,
      isSystem: user_is_system,
    }));
  }

  private getSpaceCollaboratorBuilder(
    knex: Knex.QueryBuilder,
    spaceId: string,
    options?: { includeSystem?: boolean; baseIds?: string[]; search?: string; type?: PrincipalType }
  ) {
    const { includeSystem, baseIds, search, type } = options ?? {};

    const builder = knex
      .from('collaborator')
      .leftJoin('users', 'collaborator.principal_id', 'users.id');

    if (baseIds?.length) {
      builder.whereIn('collaborator.resource_id', [...baseIds, spaceId]);
    } else {
      builder.where('collaborator.resource_id', spaceId);
    }
    if (!includeSystem) {
      builder.where((db) => {
        return db.whereNull('users.is_system').orWhere('users.is_system', false);
      });
    }
    if (search) {
      this.dbProvider.searchBuilder(builder, [
        ['users.name', search],
        ['users.email', search],
      ]);
    }
    if (type) {
      builder.where('collaborator.principal_type', type);
    }
  }

  async getTotalSpace(
    spaceId: string,
    options?: {
      includeSystem?: boolean;
      includeBase?: boolean;
      search?: string;
      type?: PrincipalType;
    }
  ) {
    const { includeBase } = options ?? {};
    let baseIds: string[] = [];
    if (includeBase) {
      const bases = await this.prismaService.txClient().base.findMany({
        where: { spaceId, deletedTime: null, space: { deletedTime: null } },
      });
      baseIds = map(bases, 'id') as string[];
    }
    const builder = this.knex();
    await this.getSpaceCollaboratorBuilder(builder, spaceId, {
      ...options,
      baseIds,
    });
    const res = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { count: number }[]
      >(builder.select(this.knex.raw('COUNT(*) as count')).toQuery());
    return Number(res[0].count);
  }

  async getListBySpace(
    spaceId: string,
    options?: {
      includeSystem?: boolean;
      includeBase?: boolean;
      skip?: number;
      take?: number;
      search?: string;
      type?: PrincipalType;
    }
  ): Promise<UserCollaboratorItem[]> {
    const { includeBase, skip = 0, take = 50 } = options ?? {};
    let baseIds: string[] = [];
    let baseMap: Record<string, { name: string; id: string }> = {};
    if (includeBase) {
      const bases = await this.prismaService.txClient().base.findMany({
        where: { spaceId, deletedTime: null, space: { deletedTime: null } },
      });
      baseIds = map(bases, 'id') as string[];
      baseMap = bases.reduce(
        (acc, base) => {
          acc[base.id] = { name: base.name, id: base.id };
          return acc;
        },
        {} as Record<string, { name: string; id: string }>
      );
    }
    const builder = this.knex();
    await this.getSpaceCollaboratorBuilder(builder, spaceId, {
      ...options,
      baseIds,
    });
    builder.offset(skip);
    builder.limit(take);
    builder.select({
      resourceId: 'collaborator.resource_id',
      role_name: 'collaborator.role_name',
      created_time: 'collaborator.created_time',
      resource_type: 'collaborator.resource_type',
      user_id: 'users.id',
      user_name: 'users.name',
      user_email: 'users.email',
      user_avatar: 'users.avatar',
      user_is_system: 'users.is_system',
    });
    builder.whereNotNull('users.id');
    const collaborators = await this.prismaService.txClient().$queryRawUnsafe<
      {
        resource_id: string;
        role_name: string;
        created_time: Date;
        resource_type: string;
        user_id: string;
        user_name: string;
        user_email: string;
        user_avatar: string;
        user_is_system: boolean | null;
      }[]
    >(builder.toQuery());
    return collaborators.map((collaborator) => ({
      type: PrincipalType.User,
      resourceType: CollaboratorType.Space,
      userId: collaborator.user_id,
      userName: collaborator.user_name,
      email: collaborator.user_email,
      avatar: collaborator.user_avatar
        ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), collaborator.user_avatar)
        : null,
      role: collaborator.role_name as IRole,
      createdTime: collaborator.created_time.toISOString(),
      base: baseMap[collaborator.resource_id],
    }));
  }

  private async getOperatorCollaborators({
    targetUserId,
    currentUserId,
    resourceId,
    resourceType,
  }: {
    resourceId: string;
    resourceType: CollaboratorType;
    targetUserId: string;
    currentUserId: string;
  }) {
    const currentUserWhere: {
      principalId: string;
      principalType: PrincipalType;
      resourceId: string | Record<string, string[]>;
    } = {
      principalId: currentUserId,
      principalType: PrincipalType.User,
      resourceId,
    };
    const targetUserWhere: {
      principalId: string;
      principalType: PrincipalType;
      resourceId: string | Record<string, string[]>;
    } = {
      principalId: targetUserId,
      principalType: PrincipalType.User,
      resourceId,
    };

    // for space user delete base collaborator
    if (resourceType === CollaboratorType.Base) {
      const spaceId = await this.prismaService
        .txClient()
        .base.findUniqueOrThrow({
          where: { id: resourceId, deletedTime: null },
          select: { spaceId: true },
        })
        .then((base) => base.spaceId);
      currentUserWhere.resourceId = { in: [resourceId, spaceId] };
    }
    const colls = await this.prismaService.txClient().collaborator.findMany({
      where: {
        OR: [currentUserWhere, targetUserWhere],
      },
    });

    const currentColl = colls.find((coll) => coll.principalId === currentUserId);
    const targetColl = colls.find((coll) => coll.principalId === targetUserId);
    if (!currentColl || !targetColl) {
      throw new BadRequestException('User not found in collaborator');
    }
    return { currentColl, targetColl };
  }

  async isUniqueOwnerUser(spaceId: string, userId: string) {
    const builder = this.knex('collaborator')
      .leftJoin('users', 'collaborator.principal_id', 'users.id')
      .where('collaborator.resource_id', spaceId)
      .where('collaborator.resource_type', CollaboratorType.Space)
      .where('collaborator.role_name', Role.Owner)
      .where('users.is_system', null)
      .where('users.deleted_time', null)
      .where('users.deactivated_time', null)
      .select('collaborator.principal_id');
    const collaborators = await this.prismaService.txClient().$queryRawUnsafe<
      {
        principal_id: string;
      }[]
    >(builder.toQuery());
    return collaborators.length === 1 && collaborators[0].principal_id === userId;
  }

  async deleteCollaborator({
    resourceId,
    resourceType,
    principalId,
    principalType,
  }: {
    principalId: string;
    principalType: PrincipalType;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    const currentUserId = this.cls.get('user.id');
    this.checkPrincipalType(principalType);
    const userId = principalId;
    const { currentColl, targetColl } = await this.getOperatorCollaborators({
      currentUserId,
      targetUserId: userId,
      resourceId,
      resourceType,
    });

    // validate user can operator target user
    if (
      currentUserId !== userId &&
      currentColl.roleName !== Role.Owner &&
      !canManageRole(currentColl.roleName as IRole, targetColl.roleName)
    ) {
      throw new ForbiddenException(`You do not have permission to delete this user: ${userId}`);
    }
    const result = await this.prismaService.txClient().collaborator.delete({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        resourceType_resourceId_principalId_principalType: {
          resourceId: resourceId,
          resourceType: resourceType,
          principalId: userId,
          principalType: PrincipalType.User,
        },
      },
    });
    let spaceId: string = resourceId;
    if (resourceType === CollaboratorType.Base) {
      const space = await this.prismaService
        .txClient()
        .base.findUniqueOrThrow({ where: { id: resourceId }, select: { spaceId: true } });
      spaceId = space.spaceId;
    }
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_DELETE,
      new CollaboratorDeleteEvent(spaceId)
    );
    return result;
  }

  async updateCollaborator({
    role,
    principalId,
    principalType,
    resourceId,
    resourceType,
  }: {
    role: IRole;
    principalId: string;
    principalType: PrincipalType;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    const currentUserId = this.cls.get('user.id');
    this.checkPrincipalType(principalType);
    const userId = principalId;
    const { currentColl, targetColl } = await this.getOperatorCollaborators({
      currentUserId,
      targetUserId: userId,
      resourceId,
      resourceType,
    });

    // validate user can operator target user
    if (
      currentUserId !== userId &&
      currentColl.roleName !== targetColl.roleName &&
      !canManageRole(currentColl.roleName as IRole, targetColl.roleName)
    ) {
      throw new ForbiddenException(`You do not have permission to operator this user: ${userId}`);
    }

    // validate user can operator target role
    if (role !== currentColl.roleName && !canManageRole(currentColl.roleName as IRole, role)) {
      throw new ForbiddenException(`You do not have permission to operator this role: ${role}`);
    }

    return this.prismaService.txClient().collaborator.updateMany({
      where: {
        resourceId: resourceId,
        resourceType: resourceType,
        principalId: userId,
        principalType: PrincipalType.User,
      },
      data: {
        roleName: role,
        lastModifiedBy: currentUserId,
      },
    });
  }

  async getCollaboratorsBaseAndSpaceArray(userId: string, searchRoles?: IRole[]) {
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: userId,
        principalType: PrincipalType.User,
        ...(searchRoles && searchRoles.length > 0 ? { roleName: { in: searchRoles } } : {}),
      },
      select: {
        roleName: true,
        resourceId: true,
        resourceType: true,
      },
    });
    const roleMap: Record<string, IRole> = {};
    const baseIds = new Set<string>();
    const spaceIds = new Set<string>();
    collaborators.forEach(({ resourceId, resourceType, roleName }) => {
      if (resourceType === CollaboratorType.Base) {
        baseIds.add(resourceId);
        roleMap[resourceId] = roleName as IRole;
      }
      if (resourceType === CollaboratorType.Space) {
        spaceIds.add(resourceId);
        roleMap[resourceId] = roleName as IRole;
      }
    });
    return {
      baseIds: Array.from(baseIds),
      spaceIds: Array.from(spaceIds),
      roleMap: roleMap,
    };
  }

  async createBaseCollaborator({
    principalId,
    principalType,
    baseId,
    role,
    createdBy,
  }: {
    principalId: string;
    principalType: PrincipalType;
    baseId: string;
    role: IBaseRole;
    createdBy?: string;
  }) {
    const currentUserId = createdBy || this.cls.get('user.id');
    const base = await this.prismaService.txClient().base.findUniqueOrThrow({
      where: { id: baseId },
    });
    const exist = await this.prismaService.txClient().collaborator.count({
      where: {
        principalId,
        principalType,
        resourceId: { in: [baseId, base.spaceId] },
      },
    });
    // if has exist space collaborator
    if (exist) {
      throw new BadRequestException('has already existed in base');
    }

    const res = await this.prismaService.txClient().collaborator.create({
      data: {
        resourceId: baseId,
        resourceType: CollaboratorType.Base,
        roleName: role,
        principalId,
        principalType,
        createdBy: currentUserId!,
      },
    });
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_CREATE,
      new CollaboratorCreateEvent(base.spaceId)
    );
    return res;
  }

  async getSharedBase() {
    const userId = this.cls.get('user.id');
    const coll = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: userId,
        principalType: PrincipalType.User,
        resourceType: CollaboratorType.Base,
      },
      select: {
        resourceId: true,
        roleName: true,
      },
    });

    if (!coll.length) {
      return [];
    }

    const roleMap: Record<string, IRole> = {};
    const baseIds = coll.map((c) => {
      roleMap[c.resourceId] = c.roleName as IRole;
      return c.resourceId;
    });
    const bases = await this.prismaService.txClient().base.findMany({
      where: {
        id: { in: baseIds },
        deletedTime: null,
      },
    });
    return bases.map((base) => ({
      id: base.id,
      name: base.name,
      role: roleMap[base.id],
      icon: base.icon,
      spaceId: base.spaceId,
      collaboratorType: CollaboratorType.Base,
    }));
  }

  async addSpaceCollaborator(spaceId: string, collaborator: AddSpaceCollaboratorRo) {
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    await this.validateUserAddRole({
      departmentIds,
      userId: this.cls.get('user.id'),
      addRole: collaborator.role,
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
    });
    return this.createSpaceCollaborator({
      principalId: collaborator.principalId,
      principalType: collaborator.principalType,
      spaceId,
      role: collaborator.role,
    });
  }

  async addBaseCollaborator(baseId: string, collaborator: AddBaseCollaboratorRo) {
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    await this.validateUserAddRole({
      departmentIds,
      userId: this.cls.get('user.id'),
      addRole: collaborator.role,
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
    });
    return this.createBaseCollaborator({
      principalId: collaborator.principalId,
      principalType: collaborator.principalType,
      baseId,
      role: collaborator.role,
    });
  }

  async validateUserAddRole({
    departmentIds,
    userId,
    addRole,
    resourceId,
    resourceType,
  }: {
    departmentIds?: string[];
    userId: string;
    addRole: IRole;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    let spaceId = resourceType === CollaboratorType.Space ? resourceId : '';
    if (resourceType === CollaboratorType.Base) {
      const base = await this.prismaService
        .txClient()
        .base.findFirstOrThrow({
          where: {
            id: resourceId,
            deletedTime: null,
          },
        })
        .catch(() => {
          throw new BadRequestException('Base not found');
        });
      spaceId = base.spaceId;
    }
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: departmentIds ? { in: [...departmentIds, userId] } : userId,
        resourceId: {
          in: [spaceId, resourceId],
        },
      },
    });
    if (collaborators.length === 0) {
      throw new BadRequestException('User not found in collaborator');
    }
    const userRole = getMaxLevelRole(collaborators);

    if (userRole === addRole) {
      return;
    }
    if (!canManageRole(userRole, addRole)) {
      throw new ForbiddenException(
        `You do not have permission to add this role collaborator: ${addRole}`
      );
    }
  }
}
