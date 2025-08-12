/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type IRole } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IGetUserLastVisitRo,
  IUpdateUserLastVisitRo,
  IUserLastVisitListBaseVo,
  IUserLastVisitMapVo,
  IUserLastVisitVo,
} from '@teable/openapi';
import { LastVisitResourceType } from '@teable/openapi';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import type { BaseDeleteEvent, SpaceDeleteEvent } from '../../../event-emitter/events';
import { Events } from '../../../event-emitter/events';
import { LastVisitUpdateEvent } from '../../../event-emitter/events/last-visit/last-visit.event';
import type { IClsStore } from '../../../types/cls';

@Injectable()
export class LastVisitService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async tableVisit(userId: string, baseId: string): Promise<IUserLastVisitVo | undefined> {
    const knex = this.knex;

    const query = this.knex
      .with('table_visit', (qb) => {
        qb.select({
          resourceId: 'ulv.resource_id',
        })
          .from('user_last_visit as ulv')
          .leftJoin('table_meta as t', function () {
            this.on('t.id', '=', 'ulv.resource_id').andOnNull('t.deleted_time');
          })
          .where('ulv.user_id', userId)
          .where('ulv.resource_type', LastVisitResourceType.Table)
          .where('ulv.parent_resource_id', baseId)
          .limit(1);
      })
      .select({
        tableId: 'table_visit.resourceId',
        viewId: 'ulv.resource_id',
      })
      .from('table_visit')
      .leftJoin('user_last_visit as ulv', function () {
        this.on('ulv.parent_resource_id', '=', 'table_visit.resourceId')
          .andOn('ulv.resource_type', knex.raw('?', LastVisitResourceType.View))
          .andOn('ulv.user_id', knex.raw('?', userId));
      })
      .leftJoin('view as v', function () {
        this.on('v.id', '=', 'ulv.resource_id').andOnNull('v.deleted_time');
      })
      .whereRaw('(ulv.resource_id IS NULL OR v.id IS NOT NULL)')
      .limit(1)
      .toQuery();

    const results = await this.prismaService.$queryRawUnsafe<
      {
        tableId: string;
        tableLastVisitTime: Date;
        viewId: string;
        viewLastVisitTime: Date;
      }[]
    >(query);

    const result = results[0];

    if (result && result.tableId && result.viewId) {
      return {
        resourceId: result.tableId,
        childResourceId: result.viewId,
        resourceType: LastVisitResourceType.Table,
      };
    }

    if (result && result.tableId) {
      const table = await this.prismaService.tableMeta.findFirst({
        select: {
          id: true,
          views: {
            select: {
              id: true,
            },
            take: 1,
            orderBy: {
              order: 'asc',
            },
            where: {
              deletedTime: null,
            },
          },
        },
        where: {
          id: result.tableId,
          deletedTime: null,
        },
      });

      if (!table) {
        return;
      }

      return {
        resourceId: table.id,
        childResourceId: table.views[0].id,
        resourceType: LastVisitResourceType.Table,
      };
    }

    const table = await this.prismaService.tableMeta.findFirst({
      select: {
        id: true,
        views: {
          select: {
            id: true,
          },
          take: 1,
          orderBy: {
            order: 'asc',
          },
          where: {
            deletedTime: null,
          },
        },
      },
      where: {
        baseId,
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });

    if (!table) {
      return;
    }

    return {
      resourceId: table.id,
      childResourceId: table.views[0].id,
      resourceType: LastVisitResourceType.Table,
    };
  }

  async viewVisit(userId: string, parentResourceId: string) {
    const query = this.knex
      .select({
        resourceId: 'ulv.resource_id',
      })
      .from('user_last_visit as ulv')
      .leftJoin('view as v', function () {
        this.on('v.id', '=', 'ulv.resource_id').andOnNull('v.deleted_time');
      })
      .where('ulv.user_id', userId)
      .where('ulv.resource_type', LastVisitResourceType.View)
      .where('ulv.parent_resource_id', parentResourceId)
      .whereNotNull('v.id')
      .limit(1);

    const sql = query.toQuery();

    const results = await this.prismaService.$queryRawUnsafe<IUserLastVisitVo[]>(sql);
    const lastVisit = results[0];

    if (lastVisit) {
      return {
        resourceId: lastVisit.resourceId,
        resourceType: LastVisitResourceType.View,
      };
    }

    const view = await this.prismaService.view.findFirst({
      select: {
        id: true,
      },
      where: {
        tableId: parentResourceId,
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });

    if (view) {
      return {
        resourceId: view.id,
        resourceType: LastVisitResourceType.View,
      };
    }
  }

  async dashboardVisit(userId: string, parentResourceId: string) {
    const query = this.knex
      .select({
        resourceId: 'ulv.resource_id',
      })
      .from('user_last_visit as ulv')
      .leftJoin('dashboard as v', function () {
        this.on('v.id', '=', 'ulv.resource_id');
      })
      .where('ulv.user_id', userId)
      .where('ulv.resource_type', LastVisitResourceType.Dashboard)
      .where('ulv.parent_resource_id', parentResourceId)
      .whereNotNull('v.id')
      .limit(1);

    const sql = query.toQuery();

    const results = await this.prismaService.$queryRawUnsafe<IUserLastVisitVo[]>(sql);
    const lastVisit = results[0];

    if (lastVisit) {
      return {
        resourceId: lastVisit.resourceId,
        resourceType: LastVisitResourceType.Dashboard,
      };
    }

    const dashboard = await this.prismaService.dashboard.findFirst({
      select: {
        id: true,
      },
      where: {
        baseId: parentResourceId,
      },
    });

    if (dashboard) {
      return {
        resourceId: dashboard.id,
        resourceType: LastVisitResourceType.Dashboard,
      };
    }
  }

  async automationVisit(userId: string, parentResourceId: string) {
    const query = this.knex
      .select({
        resourceId: 'ulv.resource_id',
      })
      .from('user_last_visit as ulv')
      .leftJoin('workflow as v', function () {
        this.on('v.id', '=', 'ulv.resource_id').andOnNull('v.deleted_time');
      })
      .where('ulv.user_id', userId)
      .where('ulv.resource_type', LastVisitResourceType.Automation)
      .where('ulv.parent_resource_id', parentResourceId)
      .whereNotNull('v.id')
      .limit(1)
      .toQuery();

    const results = await this.prismaService.$queryRawUnsafe<IUserLastVisitVo[]>(query);
    const lastVisit = results[0];

    if (lastVisit) {
      return {
        resourceId: lastVisit.resourceId,
        resourceType: LastVisitResourceType.Automation,
      };
    }

    const workflowQuery = this.knex('workflow')
      .select({
        id: 'id',
      })
      .where('base_id', parentResourceId)
      .whereNull('deleted_time')
      .orderBy('order', 'asc')
      .limit(1)
      .toQuery();

    const workflowResults =
      await this.prismaService.$queryRawUnsafe<{ id: string }[]>(workflowQuery);
    const workflow = workflowResults[0];

    if (workflow) {
      return {
        resourceId: workflow.id,
        resourceType: LastVisitResourceType.Automation,
      };
    }
  }

  async baseVisit(): Promise<IUserLastVisitListBaseVo> {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    const query = this.knex
      .distinct(['ulv.resource_id'])
      .select({
        resourceId: 'ulv.resource_id',
        resourceType: 'ulv.resource_type',
        lastVisitTime: 'ulv.last_visit_time',
        resourceName: 'b.name',
        resourceIcon: 'b.icon',
        resourceRole: 'c.role_name',
        spaceId: 's.id',
      })
      .from('user_last_visit as ulv')
      .join('base as b', function () {
        this.on('b.id', '=', 'ulv.resource_id').andOnNull('b.deleted_time');
      })
      .join('space as s', function () {
        this.on('s.id', '=', 'ulv.parent_resource_id').andOnNull('s.deleted_time');
      })
      .join('collaborator as c', function () {
        this.onIn('c.principal_id', [...(departmentIds ?? []), userId]).andOn(function () {
          this.on('c.resource_id', '=', 'ulv.parent_resource_id').orOn(
            'c.resource_id',
            '=',
            'ulv.resource_id'
          );
        });
      })
      .where('ulv.user_id', userId)
      .where('ulv.resource_type', LastVisitResourceType.Base)
      .whereNotNull('b.id')
      .whereNotNull('c.id')
      .orderBy('ulv.last_visit_time', 'desc');

    const results = await this.prismaService.$queryRawUnsafe<
      {
        resourceId: string;
        resourceType: LastVisitResourceType;
        lastVisitTime: Date;
        resourceName: string;
        resourceIcon: string;
        resourceRole: IRole;
        spaceId: string;
      }[]
    >(query.toQuery());

    const list = results.map((result) => ({
      resourceId: result.resourceId,
      resourceType: result.resourceType,
      lastVisitTime: result.lastVisitTime.toISOString(),
      resource: {
        id: result.resourceId,
        name: result.resourceName,
        icon: result.resourceIcon,
        role: result.resourceRole,
        spaceId: result.spaceId,
      },
    }));

    return {
      total: results.length,
      list,
    };
  }

  async getUserLastVisit(
    userId: string,
    params: IGetUserLastVisitRo
  ): Promise<IUserLastVisitVo | undefined> {
    switch (params.resourceType) {
      case LastVisitResourceType.Table:
        return this.tableVisit(userId, params.parentResourceId);
      case LastVisitResourceType.View:
        return this.viewVisit(userId, params.parentResourceId);
      case LastVisitResourceType.Dashboard:
        return this.dashboardVisit(userId, params.parentResourceId);
      case LastVisitResourceType.Automation:
        return this.automationVisit(userId, params.parentResourceId);
      default:
        throw new NotFoundException('Invalid resource type');
    }
  }

  async updateUserLastVisit(userId: string, updateData: IUpdateUserLastVisitRo) {
    this.eventEmitterService.emitAsync(
      Events.LAST_VISIT_UPDATE,
      new LastVisitUpdateEvent(updateData)
    );
    const { resourceType, resourceId, parentResourceId, childResourceId } = updateData;

    if (resourceType === LastVisitResourceType.Base) {
      await this.updateUserLastVisitRecord({
        userId,
        resourceType: LastVisitResourceType.Base,
        resourceId,
        parentResourceId,
        maxRecords: 10,
      });
      return;
    }

    await this.updateUserLastVisitRecord({
      userId,
      resourceType,
      resourceId,
      parentResourceId,
      maxRecords: 1,
    });

    if (childResourceId) {
      await this.updateUserLastVisitRecord({
        userId,
        resourceType: LastVisitResourceType.View,
        resourceId: childResourceId,
        parentResourceId: resourceId,
        maxRecords: 1,
      });
    }
  }

  async updateUserLastVisitRecord({
    userId,
    resourceType,
    resourceId,
    maxRecords = 10,
    parentResourceId,
  }: {
    userId: string;
    resourceType: string;
    resourceId: string;
    parentResourceId: string;
    maxRecords?: number;
  }) {
    await this.prismaService.$transaction(async (prisma) => {
      await prisma.userLastVisit.upsert({
        where: {
          userId_resourceType_resourceId: {
            userId,
            resourceType,
            resourceId,
          },
        },
        update: {
          lastVisitTime: new Date().toISOString(),
        },
        create: {
          userId,
          resourceType,
          resourceId,
          parentResourceId,
        },
      });

      const oldRecords = await prisma.userLastVisit.findMany({
        where: {
          userId,
          resourceType,
        },
        orderBy: {
          lastVisitTime: 'desc',
        },
        skip: maxRecords,
        select: {
          id: true,
        },
      });

      if (oldRecords.length > 0) {
        await prisma.userLastVisit.deleteMany({
          where: {
            id: {
              in: oldRecords.map((record) => record.id),
            },
          },
        });
      }
    });
  }

  async getUserLastVisitMap(
    userId: string,
    params: IGetUserLastVisitRo
  ): Promise<IUserLastVisitMapVo> {
    const tables = await this.prismaService.tableMeta.findMany({
      select: {
        id: true,
      },
      where: {
        baseId: params.parentResourceId,
        deletedTime: null,
      },
    });

    const query = this.knex
      .select({
        resourceId: 'ulv.resource_id',
        parentResourceId: 'ulv.parent_resource_id',
      })
      .from('user_last_visit as ulv')
      .leftJoin('view as v', function () {
        this.on('v.id', '=', 'ulv.resource_id').andOnNull('v.deleted_time');
      })
      .where('ulv.user_id', userId)
      .where('ulv.resource_type', LastVisitResourceType.View)
      .whereIn(
        'ulv.parent_resource_id',
        tables.map((table) => table.id)
      )
      .whereNotNull('v.id');

    const sql = query.toQuery();
    const results =
      await this.prismaService.$queryRawUnsafe<(IUserLastVisitVo & { parentResourceId: string })[]>(
        sql
      );

    // If some tables don't have a last visited view, find their first view
    const tablesWithVisit = new Set(results.map((result) => result.parentResourceId));
    const tablesWithoutVisit = tables.filter((table) => !tablesWithVisit.has(table.id));

    if (tablesWithoutVisit.length > 0) {
      const defaultViews = await this.prismaService.view.findMany({
        select: {
          id: true,
          tableId: true,
        },
        where: {
          tableId: {
            in: tablesWithoutVisit.map((t) => t.id),
          },
          deletedTime: null,
        },
        orderBy: {
          order: 'asc',
        },
        distinct: ['tableId'],
      });

      // Add default views to results
      for (const view of defaultViews) {
        results.push({
          resourceId: view.id,
          parentResourceId: view.tableId,
          resourceType: LastVisitResourceType.View,
        });
      }
    }

    return keyBy(results, 'parentResourceId');
  }

  @OnEvent(Events.BASE_DELETE, { async: true })
  @OnEvent(Events.SPACE_DELETE, { async: true })
  protected async resourceDeleteListener(listenerEvent: BaseDeleteEvent | SpaceDeleteEvent) {
    switch (listenerEvent.name) {
      case Events.BASE_DELETE:
        await this.prismaService.userLastVisit.deleteMany({
          where: {
            OR: [
              {
                resourceId: listenerEvent.payload.baseId,
                resourceType: LastVisitResourceType.Base,
              },
              {
                parentResourceId: listenerEvent.payload.baseId,
                resourceType: LastVisitResourceType.Table,
              },
            ],
          },
        });
        break;
      case Events.SPACE_DELETE:
        await this.prismaService.userLastVisit.deleteMany({
          where: {
            parentResourceId: listenerEvent.payload.spaceId,
            resourceType: LastVisitResourceType.Base,
          },
        });
        break;
    }

    this.eventEmitterService.emitAsync(Events.LAST_VISIT_CLEAR, {});
  }
}
