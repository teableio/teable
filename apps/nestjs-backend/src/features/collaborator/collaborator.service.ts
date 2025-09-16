/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { canManageRole, getRandomString, Role, type IBaseRole, type IRole } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  AddBaseCollaboratorRo,
  AddSpaceCollaboratorRo,
  CollaboratorItem,
  IItemBaseCollaboratorUser,
  IListBaseCollaboratorUserRo,
} from '@teable/openapi';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import { Knex } from 'knex';
import { difference, map } from 'lodash';
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
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';

@Injectable()
export class CollaboratorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  async createSpaceCollaborator({
    collaborators,
    spaceId,
    role,
    createdBy,
  }: {
    collaborators: {
      principalId: string;
      principalType: PrincipalType;
    }[];
    spaceId: string;
    role: IRole;
    createdBy?: string;
  }) {
    const currentUserId = createdBy || this.cls.get('user.id');
    const exist = await this.prismaService.txClient().collaborator.count({
      where: {
        OR: collaborators.map((collaborator) => ({
          principalId: collaborator.principalId,
          principalType: collaborator.principalType,
        })),
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
        OR: collaborators.map((collaborator) => ({
          principalId: collaborator.principalId,
          principalType: collaborator.principalType,
        })),
        resourceId: { in: bases.map((base) => base.id) },
        resourceType: CollaboratorType.Base,
      },
    });

    await this.prismaService.txClient().collaborator.createMany({
      data: collaborators.map((collaborator) => ({
        id: getRandomString(16),
        resourceId: spaceId,
        resourceType: CollaboratorType.Space,
        roleName: role,
        principalId: collaborator.principalId,
        principalType: collaborator.principalType,
        createdBy: currentUserId!,
      })),
    });
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_CREATE,
      new CollaboratorCreateEvent(spaceId)
    );
  }

  protected async getBaseCollaboratorBuilder(
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
    const builder = this.knex.queryBuilder();
    await this.getBaseCollaboratorBuilder(builder, baseId, options);
    const res = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { count: number }[]
      >(builder.select(this.knex.raw('COUNT(*) as count')).toQuery());
    return Number(res[0].count);
  }

  protected async getListByBaseBuilder(
    builder: Knex.QueryBuilder,
    options?: {
      includeSystem?: boolean;
      skip?: number;
      take?: number;
      search?: string;
      type?: PrincipalType;
      orderBy?: 'desc' | 'asc';
    }
  ) {
    const { skip = 0, take = 50 } = options ?? {};
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
    builder.orderBy('collaborator.created_time', options?.orderBy ?? 'desc');
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
  ): Promise<CollaboratorItem[]> {
    const builder = this.knex.queryBuilder();
    builder.whereNotNull('users.id');
    await this.getBaseCollaboratorBuilder(builder, baseId, options);
    await this.getListByBaseBuilder(builder, options);
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
      avatar: collaborator.user_avatar ? getPublicFullStorageUrl(collaborator.user_avatar) : null,
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

    const builder = this.knex.queryBuilder();
    await this.getBaseCollaboratorBuilder(builder, baseId, {
      includeSystem: true,
    });
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
    builder.whereNotNull('users.id');
    builder.select({
      id: 'users.id',
      name: 'users.name',
      email: 'users.email',
      avatar: 'users.avatar',
      isSystem: 'users.is_system',
    });

    return this.prismaService.txClient().$queryRawUnsafe<
      {
        id: string;
        name: string;
        email: string;
        avatar: string | null;
        isSystem: boolean | null;
      }[]
    >(builder.toQuery());
  }

  protected async getSpaceCollaboratorBuilder(
    knex: Knex.QueryBuilder,
    spaceId: string,
    options?: {
      includeSystem?: boolean;
      search?: string;
      includeBase?: boolean;
      type?: PrincipalType;
    }
  ): Promise<{
    builder: Knex.QueryBuilder;
    baseMap: Record<string, { name: string; id: string }>;
  }> {
    const { includeSystem, search, type, includeBase } = options ?? {};

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
    return { builder, baseMap };
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
    const builder = this.knex.queryBuilder();
    await this.getSpaceCollaboratorBuilder(builder, spaceId, options);
    const res = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { count: number }[]
      >(builder.select(this.knex.raw('COUNT(*) as count')).toQuery());
    return Number(res[0].count);
  }

  async getSpaceCollaboratorStats(
    spaceId: string,
    options?: {
      includeSystem?: boolean;
      includeBase?: boolean;
      search?: string;
      type?: PrincipalType;
    }
  ) {
    // Get total count (existing logic)
    const builder = this.knex.queryBuilder();
    await this.getSpaceCollaboratorBuilder(builder, spaceId, options);
    const res = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { count: number }[]
      >(builder.select(this.knex.raw('COUNT(*) as count')).toQuery());
    const total = Number(res[0].count);

    // Get unique total - distinct users across space and base collaborators
    const uniqBuilder = this.knex.queryBuilder();
    await this.getSpaceCollaboratorBuilder(uniqBuilder, spaceId, { ...options, includeBase: true });
    const uniqRes = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { count: number }[]
      >(uniqBuilder.select(this.knex.raw('COUNT(DISTINCT users.id) as count')).toQuery());
    const uniqTotal = Number(uniqRes[0].count);

    return {
      total,
      uniqTotal,
    };
  }

  // eslint-disable-next-line sonarjs/no-identical-functions
  protected async getListBySpaceBuilder(
    builder: Knex.QueryBuilder,
    options?: {
      includeSystem?: boolean;
      includeBase?: boolean;
      skip?: number;
      take?: number;
      search?: string;
      type?: PrincipalType;
      orderBy?: 'desc' | 'asc';
    }
  ) {
    const { skip = 0, take = 50 } = options ?? {};
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
    builder.orderBy('collaborator.created_time', options?.orderBy ?? 'desc');
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
      orderBy?: 'desc' | 'asc';
    }
  ): Promise<CollaboratorItem[]> {
    const isCommunityEdition =
      process.env.NEXT_BUILD_ENV_EDITION?.toUpperCase() !== 'EE' &&
      process.env.NEXT_BUILD_ENV_EDITION?.toUpperCase() !== 'CLOUD';

    const builder = this.knex.queryBuilder();
    builder.whereNotNull('users.id');
    const { baseMap } = await this.getSpaceCollaboratorBuilder(builder, spaceId, options);
    await this.getListBySpaceBuilder(builder, options);
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

    // Get billable users if not community edition and includeBase is true
    let billableUserIds = new Set<string>();
    if (!isCommunityEdition && options?.includeBase) {
      const billableRoles = ['owner', 'creator', 'editor'];
      const billableBuilder = this.knex.queryBuilder();
      await this.getSpaceCollaboratorBuilder(billableBuilder, spaceId, {
        ...options,
        includeBase: true,
      });
      billableBuilder.whereIn('collaborator.role_name', billableRoles);
      billableBuilder.select({ user_id: 'users.id' });

      const billableUsers = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ user_id: string }[]>(billableBuilder.toQuery());

      billableUserIds = new Set(billableUsers.map((u) => u.user_id));
    }

    return collaborators.map((collaborator) => {
      const billableRoles = ['owner', 'creator', 'editor'];

      return {
        type: PrincipalType.User,
        resourceType: collaborator.resource_type as CollaboratorType,
        userId: collaborator.user_id,
        userName: collaborator.user_name,
        email: collaborator.user_email,
        avatar: collaborator.user_avatar ? getPublicFullStorageUrl(collaborator.user_avatar) : null,
        role: collaborator.role_name as IRole,
        createdTime: collaborator.created_time.toISOString(),
        base: baseMap[collaborator.resource_id],
        billable:
          !isCommunityEdition &&
          (billableRoles.includes(collaborator.role_name) ||
            billableUserIds.has(collaborator.user_id)),
      };
    });
  }

  private async getOperatorCollaborators({
    targetPrincipalId,
    currentPrincipalId,
    resourceId,
    resourceType,
  }: {
    resourceId: string;
    resourceType: CollaboratorType;
    targetPrincipalId: string;
    currentPrincipalId: string;
  }) {
    const currentUserWhere: {
      principalId: string;
      resourceId: string | Record<string, string[]>;
    } = {
      principalId: currentPrincipalId,
      resourceId,
    };
    const targetUserWhere: {
      principalId: string;
      resourceId: string | Record<string, string[]>;
    } = {
      principalId: targetPrincipalId,
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

    const currentColl = colls.find((coll) => coll.principalId === currentPrincipalId);
    const targetColl = colls.find((coll) => coll.principalId === targetPrincipalId);
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
    const { currentColl, targetColl } = await this.getOperatorCollaborators({
      currentPrincipalId: currentUserId,
      targetPrincipalId: principalId,
      resourceId,
      resourceType,
    });

    // validate user can operator target user
    if (
      currentUserId !== principalId &&
      currentColl.roleName !== Role.Owner &&
      !canManageRole(currentColl.roleName as IRole, targetColl.roleName)
    ) {
      throw new ForbiddenException(
        `You do not have permission to delete this collaborator: ${principalId}`
      );
    }
    const result = await this.prismaService.txClient().collaborator.delete({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        resourceType_resourceId_principalId_principalType: {
          resourceId: resourceId,
          resourceType: resourceType,
          principalId,
          principalType,
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
    const { currentColl, targetColl } = await this.getOperatorCollaborators({
      currentPrincipalId: currentUserId,
      targetPrincipalId: principalId,
      resourceId,
      resourceType,
    });

    // validate user can operator target user
    if (
      currentUserId !== principalId &&
      currentColl.roleName !== targetColl.roleName &&
      !canManageRole(currentColl.roleName as IRole, targetColl.roleName)
    ) {
      throw new ForbiddenException(
        `You do not have permission to operator this collaborator: ${principalId}`
      );
    }

    // validate user can operator target role
    if (role !== currentColl.roleName && !canManageRole(currentColl.roleName as IRole, role)) {
      throw new ForbiddenException(`You do not have permission to operator this role: ${role}`);
    }

    return this.prismaService.txClient().collaborator.updateMany({
      where: {
        resourceId: resourceId,
        resourceType: resourceType,
        principalId: principalId,
        principalType: principalType,
      },
      data: {
        roleName: role,
        lastModifiedBy: currentUserId,
      },
    });
  }

  async getCurrentUserCollaboratorsBaseAndSpaceArray(searchRoles?: IRole[]) {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: { in: [userId, ...(departmentIds || [])] },
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
    collaborators.forEach(({ resourceId, roleName, resourceType }) => {
      if (!roleMap[resourceId] || canManageRole(roleName as IRole, roleMap[resourceId])) {
        roleMap[resourceId] = roleName as IRole;
      }
      if (resourceType === CollaboratorType.Base) {
        baseIds.add(resourceId);
      } else {
        spaceIds.add(resourceId);
      }
    });
    return {
      baseIds: Array.from(baseIds),
      spaceIds: Array.from(spaceIds),
      roleMap: roleMap,
    };
  }

  async createBaseCollaborator({
    collaborators,
    baseId,
    role,
    createdBy,
  }: {
    collaborators: {
      principalId: string;
      principalType: PrincipalType;
    }[];
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
        OR: collaborators.map((collaborator) => ({
          principalId: collaborator.principalId,
          principalType: collaborator.principalType,
        })),
        resourceId: { in: [baseId, base.spaceId] },
      },
    });
    // if has exist space collaborator
    if (exist) {
      throw new BadRequestException('has already existed in base');
    }

    const res = await this.prismaService.txClient().collaborator.createMany({
      data: collaborators.map((collaborator) => ({
        id: getRandomString(16),
        resourceId: baseId,
        resourceType: CollaboratorType.Base,
        roleName: role,
        principalId: collaborator.principalId,
        principalType: collaborator.principalType,
        createdBy: currentUserId!,
      })),
    });
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_CREATE,
      new CollaboratorCreateEvent(base.spaceId)
    );
    return res;
  }

  async getSharedBase() {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    const coll = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: { in: [userId, ...(departmentIds || [])] },
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
      if (!roleMap[c.resourceId] || canManageRole(c.roleName as IRole, roleMap[c.resourceId])) {
        roleMap[c.resourceId] = c.roleName as IRole;
      }
      return c.resourceId;
    });
    const bases = await this.prismaService.txClient().base.findMany({
      where: {
        id: { in: baseIds },
        deletedTime: null,
      },
      include: {
        space: {
          select: {
            name: true,
          },
        },
      },
    });
    return bases.map((base) => ({
      id: base.id,
      name: base.name,
      role: roleMap[base.id],
      icon: base.icon,
      spaceId: base.spaceId,
      spaceName: base.space?.name,
      collaboratorType: CollaboratorType.Base,
    }));
  }

  protected async validateCollaboratorUser(userIds: string[]) {
    const users = await this.prismaService.txClient().user.findMany({
      where: {
        id: { in: userIds },
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });
    const diffIds = difference(
      userIds,
      users.map((u) => u.id)
    );
    if (diffIds.length > 0) {
      throw new BadRequestException(`User not found: ${diffIds.join(', ')}`);
    }
  }

  async addSpaceCollaborators(spaceId: string, collaborator: AddSpaceCollaboratorRo) {
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    await this.validateUserAddRole({
      departmentIds,
      userId: this.cls.get('user.id'),
      addRole: collaborator.role,
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
    });
    await this.validateCollaboratorUser(
      collaborator.collaborators
        .filter((c) => c.principalType === PrincipalType.User)
        .map((c) => c.principalId)
    );
    return this.createSpaceCollaborator({
      collaborators: collaborator.collaborators,
      spaceId,
      role: collaborator.role,
      createdBy: this.cls.get('user.id'),
    });
  }

  async addBaseCollaborators(baseId: string, collaborator: AddBaseCollaboratorRo) {
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    await this.validateUserAddRole({
      departmentIds,
      userId: this.cls.get('user.id'),
      addRole: collaborator.role,
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
    });
    await this.validateCollaboratorUser(
      collaborator.collaborators
        .filter((c) => c.principalType === PrincipalType.User)
        .map((c) => c.principalId)
    );
    return this.createBaseCollaborator({
      collaborators: collaborator.collaborators,
      baseId,
      role: collaborator.role,
      createdBy: this.cls.get('user.id'),
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

  async getUserCollaboratorsTotal(baseId: string, options?: IListBaseCollaboratorUserRo) {
    return this.getTotalBase(baseId, options);
  }

  async getUserCollaborators(baseId: string, options?: IListBaseCollaboratorUserRo) {
    const { skip = 0, take = 50 } = options ?? {};
    const builder = this.knex.queryBuilder();
    await this.getBaseCollaboratorBuilder(builder, baseId, options);
    builder.whereNotNull('users.id');
    builder.orderBy('collaborator.created_time', options?.orderBy ?? 'desc');
    builder.offset(skip);
    builder.limit(take);
    builder.select({
      id: 'users.id',
      name: 'users.name',
      email: 'users.email',
      avatar: 'users.avatar',
    });
    const res = await this.prismaService
      .txClient()
      .$queryRawUnsafe<IItemBaseCollaboratorUser[]>(builder.toQuery());
    return res.map((item) => ({
      ...item,
      avatar: item.avatar ? getPublicFullStorageUrl(item.avatar) : null,
    }));
  }
}
