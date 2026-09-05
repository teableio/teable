/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { HttpErrorCode, type IRole } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IGetUserLastVisitRo,
  IGetUserLastVisitBaseNodeRo,
  IUpdateUserLastVisitRo,
  IUserLastVisitListBaseVo,
  IUserLastVisitMapVo,
  IUserLastVisitVo,
  IUserLastVisitBaseNodeVo,
} from '@teable/openapi';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import type {
  BaseDeleteEvent,
  SpaceDeleteEvent,
  DashboardDeleteEvent,
  WorkflowDeleteEvent,
  AppDeleteEvent,
  TableDeleteEvent,
  ViewDeleteEvent,
} from '../../../event-emitter/events';
import { Events } from '../../../event-emitter/events';
import { LastVisitUpdateEvent } from '../../../event-emitter/events/last-visit/last-visit.event';
import type { IClsStore } from '../../../types/cls';
import { mergeBaseVisitRows } from './merge-base-visit-rows';

@Injectable()
export class LastVisitService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async getUserLastVisitBaseNode(
    userId: string,
    params: IGetUserLastVisitBaseNodeRo
  ): Promise<IUserLastVisitBaseNodeVo> {
    const lastVisit = await this.prismaService.userLastVisit.findFirst({
      where: {
        userId,
        parentResourceId: params.parentResourceId,
        resourceType: {
          in: [
            LastVisitResourceType.Table,
            LastVisitResourceType.Dashboard,
            LastVisitResourceType.Workflow,
            LastVisitResourceType.App,
          ],
        },
      },
      orderBy: {
        lastVisitTime: 'desc',
      },
      take: 1,
      select: {
        resourceId: true,
        resourceType: true,
      },
    });

    if (!lastVisit) {
      return;
    }

    return {
      resourceId: lastVisit.resourceId,
      resourceType: lastVisit.resourceType as LastVisitResourceType,
    };
  }

  /**
   * The entry URL of each given base, resolved purely from the user's own
   * visit history — so a base-list click can navigate straight to
   * /base/{id}/table/{tableId}/{viewId} instead of paying the /base/{id}
   * redirect chain. Pure resolution: callers own access control and pass ids
   * already scoped to what the user may see (the space controller passes its
   * permission-checked base list). A base maps to its latest visited
   * still-alive table, or — when never visited — to its default first table,
   * mirroring the redirect chain; bases whose target is a non-table node stay
   * omitted so the chain handles them.
   *
   * URLs mirror the frontend getNodeUrl table rule
   * (features/app/blocks/base/base-node/hooks/helper.ts) — keep in sync.
   */
  async getBaseEntryMap(userId: string, baseIds: string[]): Promise<Record<string, string>> {
    if (baseIds.length === 0) return {};

    // Latest visited node per base (newest first, pick first occurrence);
    // only table nodes proceed — matching what the redirect chain would pick.
    // Visit rows are pruned to one per (base, type). The userId filter keeps
    // this to the caller's own history only.
    const nodeVisits = await this.prismaService.userLastVisit.findMany({
      where: {
        userId,
        parentResourceId: { in: baseIds },
        resourceType: {
          in: [
            LastVisitResourceType.Table,
            LastVisitResourceType.Dashboard,
            LastVisitResourceType.Workflow,
            LastVisitResourceType.App,
          ],
        },
      },
      orderBy: { lastVisitTime: 'desc' },
      select: { parentResourceId: true, resourceId: true, resourceType: true },
    });
    const latestNodeByBase = new Map<string, { resourceId: string; resourceType: string }>();
    for (const visit of nodeVisits) {
      if (!latestNodeByBase.has(visit.parentResourceId)) {
        latestNodeByBase.set(visit.parentResourceId, visit);
      }
    }
    const tableIdToBaseId = new Map<string, string>();
    for (const [visitedBaseId, node] of latestNodeByBase) {
      if (node.resourceType === LastVisitResourceType.Table) {
        tableIdToBaseId.set(node.resourceId, visitedBaseId);
      }
    }
    // Never-visited bases fall back to the same default the redirect chain
    // would compute: the first non-folder node, when it is a table
    const neverVisitedBaseIds = baseIds.filter((id) => !latestNodeByBase.has(id));
    await this.collectDefaultTableEntries(neverVisitedBaseIds, tableIdToBaseId);

    if (tableIdToBaseId.size === 0) return {};
    const urlByTableId = await this.resolveTableEntryUrls(userId, tableIdToBaseId);
    const entryMap: Record<string, string> = {};
    for (const [tableId, entryBaseId] of tableIdToBaseId) {
      const url = urlByTableId[tableId];
      if (url) entryMap[entryBaseId] = url;
    }
    return entryMap;
  }

  /**
   * Entry URL per table (last visited view when alive, else the first by
   * order) for known (tableId, baseId) pairs — e.g. pinned tables. Same
   * contract as getBaseEntryMap: pure resolution over the user's own visit
   * history, callers own access control.
   */
  async getTableEntryUrls(
    userId: string,
    tables: { tableId: string; baseId: string }[]
  ): Promise<Record<string, string>> {
    if (tables.length === 0) return {};
    return this.resolveTableEntryUrls(
      userId,
      new Map(tables.map((table) => [table.tableId, table.baseId]))
    );
  }

  /**
   * The default table of each base — its first non-folder node when that node
   * is a table — mirroring the redirect chain. Bases whose first node is a
   * dashboard/automation/app are skipped on purpose: those URLs cannot
   * self-heal when stale (no table-route-style fallback), so the redirect
   * chain keeps handling them. (An EE authority-restricted first table can
   * slip in here; clicking it self-heals through the table route's
   * permission-filtered fallback.)
   */
  private async collectDefaultTableEntries(
    baseIds: string[],
    tableIdToBaseId: Map<string, string>
  ): Promise<void> {
    if (baseIds.length === 0) return;
    const nodes = await this.prismaService.baseNode.findMany({
      where: { baseId: { in: baseIds } },
      orderBy: [{ baseId: 'asc' }, { order: 'asc' }],
      select: { baseId: true, resourceType: true, resourceId: true },
    });
    const firstNodeByBase = new Map<string, { resourceType: string; resourceId: string }>();
    for (const node of nodes) {
      if (node.resourceType === BaseNodeResourceType.Folder) continue;
      if (!firstNodeByBase.has(node.baseId)) {
        firstNodeByBase.set(node.baseId, node);
      }
    }
    for (const [defaultBaseId, node] of firstNodeByBase) {
      if (node.resourceType === BaseNodeResourceType.Table) {
        tableIdToBaseId.set(node.resourceId, defaultBaseId);
      }
    }
  }

  /**
   * For each table: keep it only when still alive in its expected base, then
   * emit its entry pathname keyed by tableId — with the user's own last
   * visited view when alive, otherwise viewless (the table route resolves
   * the view with permission filtering, one redirect)
   */
  private async resolveTableEntryUrls(
    userId: string,
    tableIdToBaseId: Map<string, string>
  ): Promise<Record<string, string>> {
    const entryMap: Record<string, string> = {};
    const tableIds = [...tableIdToBaseId.keys()];
    const [tables, viewVisits, views] = await Promise.all([
      this.prismaService.tableMeta.findMany({
        where: { id: { in: tableIds }, deletedTime: null },
        select: { id: true, baseId: true },
      }),
      this.prismaService.userLastVisit.findMany({
        where: {
          userId,
          resourceType: LastVisitResourceType.View,
          parentResourceId: { in: tableIds },
        },
        orderBy: { lastVisitTime: 'desc' },
        select: { parentResourceId: true, resourceId: true },
      }),
      this.prismaService.view.findMany({
        where: { tableId: { in: tableIds }, deletedTime: null },
        orderBy: { order: 'asc' },
        select: { id: true, tableId: true },
      }),
    ]);
    const latestViewByTable = new Map<string, string>();
    for (const visit of viewVisits) {
      if (!latestViewByTable.has(visit.parentResourceId)) {
        latestViewByTable.set(visit.parentResourceId, visit.resourceId);
      }
    }
    const viewIdsByTable = new Map<string, string[]>();
    for (const view of views) {
      const list = viewIdsByTable.get(view.tableId) ?? [];
      list.push(view.id);
      viewIdsByTable.set(view.tableId, list);
    }

    for (const table of tables) {
      const entryBaseId = tableIdToBaseId.get(table.id);
      const tableViewIds = viewIdsByTable.get(table.id);
      if (entryBaseId !== table.baseId || !entryBaseId || !tableViewIds?.length) continue;
      // Only the user's own last visited view may appear in the URL — they
      // could see it at visit time. Falling back to the first view by order
      // would leak (and route to) views an EE authority-matrix role hides;
      // a viewless URL instead lets the table route resolve the view through
      // its permission-filtered list at the cost of one redirect.
      const lastViewId = latestViewByTable.get(table.id);
      const viewId = lastViewId && tableViewIds.includes(lastViewId) ? lastViewId : undefined;
      entryMap[table.id] = viewId
        ? `/base/${entryBaseId}/table/${table.id}/${viewId}`
        : `/base/${entryBaseId}/table/${table.id}`;
    }
    return entryMap;
  }

  async spaceVisit(userId: string, parentResourceId: string) {
    const lastVisit = await this.prismaService.userLastVisit.findFirst({
      where: {
        userId,
        parentResourceId,
        resourceType: LastVisitResourceType.Space,
      },
      orderBy: {
        lastVisitTime: 'desc',
      },
      take: 1,
      select: {
        resourceId: true,
        resourceType: true,
      },
    });

    if (lastVisit) {
      return {
        resourceId: lastVisit.resourceId,
        resourceType: lastVisit.resourceType as LastVisitResourceType,
      };
    }

    return undefined;
  }

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

  async workflowVisit(userId: string, parentResourceId: string) {
    const query = this.knex
      .select({
        resourceId: 'ulv.resource_id',
      })
      .from('user_last_visit as ulv')
      .leftJoin('workflow as v', function () {
        this.on('v.id', '=', 'ulv.resource_id').andOnNull('v.deleted_time');
      })
      .where('ulv.user_id', userId)
      .where('ulv.resource_type', LastVisitResourceType.Workflow)
      .where('ulv.parent_resource_id', parentResourceId)
      .whereNotNull('v.id')
      .limit(1)
      .toQuery();

    const results = await this.prismaService.$queryRawUnsafe<IUserLastVisitVo[]>(query);
    const lastVisit = results[0];

    if (lastVisit) {
      return {
        resourceId: lastVisit.resourceId,
        resourceType: LastVisitResourceType.Workflow,
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
        resourceType: LastVisitResourceType.Workflow,
      };
    }
  }

  async appVisit(userId: string, parentResourceId: string) {
    const query = this.knex
      .select({
        resourceId: 'ulv.resource_id',
      })
      .from('user_last_visit as ulv')
      .leftJoin('app as a', function () {
        this.on('a.id', '=', 'ulv.resource_id').andOnNull('a.deleted_time');
      })
      .where('ulv.user_id', userId)
      .where('ulv.resource_type', LastVisitResourceType.App)
      .where('ulv.parent_resource_id', parentResourceId)
      .whereNotNull('a.id')
      .limit(1)
      .toQuery();

    const results = await this.prismaService.$queryRawUnsafe<IUserLastVisitVo[]>(query);
    const lastVisit = results[0];

    if (lastVisit) {
      return {
        resourceId: lastVisit.resourceId,
        resourceType: LastVisitResourceType.App,
      };
    }

    const appQuery = this.knex('app')
      .select({
        id: 'id',
      })
      .where('base_id', parentResourceId)
      .whereNull('deleted_time')
      .orderBy('last_modified_time', 'desc')
      .limit(1)
      .toQuery();

    const appResults = await this.prismaService.$queryRawUnsafe<{ id: string }[]>(appQuery);
    const app = appResults[0];

    if (app) {
      return {
        resourceId: app.id,
        resourceType: LastVisitResourceType.App,
      };
    }

    return undefined;
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
        createBy: 'b.created_by',
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
        createBy: string;
      }[]
    >(query.toQuery());

    const uniqueResults = mergeBaseVisitRows(results);

    const list = uniqueResults.map((result) => ({
      resourceId: result.resourceId,
      resourceType: result.resourceType,
      lastVisitTime: new Date(result.lastVisitTime).toISOString(),
      resource: {
        id: result.resourceId,
        name: result.resourceName,
        icon: result.resourceIcon,
        role: result.resourceRole,
        spaceId: result.spaceId,
        createdBy: result.createBy,
      },
    }));

    return {
      total: uniqueResults.length,
      list,
    };
  }

  async getUserLastVisit(
    userId: string,
    params: IGetUserLastVisitRo
  ): Promise<IUserLastVisitVo | undefined> {
    switch (params.resourceType) {
      case LastVisitResourceType.Space:
        return this.spaceVisit(userId, params.parentResourceId);
      case LastVisitResourceType.Table:
        return this.tableVisit(userId, params.parentResourceId);
      case LastVisitResourceType.View:
        return this.viewVisit(userId, params.parentResourceId);
      case LastVisitResourceType.Dashboard:
        return this.dashboardVisit(userId, params.parentResourceId);
      case LastVisitResourceType.Workflow:
        return this.workflowVisit(userId, params.parentResourceId);
      case LastVisitResourceType.App:
        return this.appVisit(userId, params.parentResourceId);
      default:
        throw new CustomHttpException('Invalid resource type', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.lastVisit.invalidResourceType',
          },
        });
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
      });
      return;
    }

    await this.updateUserLastVisitRecord({
      userId,
      resourceType,
      resourceId,
      parentResourceId,
      maxRecords: 1,
      maxKeys: ['parentResourceId'],
    });

    if (childResourceId) {
      await this.updateUserLastVisitRecord({
        userId,
        resourceType: LastVisitResourceType.View,
        resourceId: childResourceId,
        parentResourceId: resourceId,
        maxRecords: 1,
        maxKeys: ['parentResourceId'],
      });
    }
  }

  async updateUserLastVisitRecord({
    userId,
    resourceType,
    resourceId,
    maxRecords = 0,
    parentResourceId,
    maxKeys,
  }: {
    userId: string;
    resourceType: string;
    resourceId: string;
    parentResourceId: string;
    maxRecords?: number;
    maxKeys?: 'parentResourceId'[];
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

      if (maxRecords > 0) {
        const oldRecords = await prisma.userLastVisit.findMany({
          where: {
            userId,
            resourceType,
            ...(maxKeys?.includes('parentResourceId') ? { parentResourceId } : {}),
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
  @OnEvent(Events.TABLE_DELETE, { async: true })
  @OnEvent(Events.TABLE_VIEW_DELETE, { async: true })
  @OnEvent(Events.DASHBOARD_DELETE, { async: true })
  @OnEvent(Events.WORKFLOW_DELETE, { async: true })
  @OnEvent(Events.APP_DELETE, { async: true })
  protected async resourceDeleteListener(
    listenerEvent:
      | BaseDeleteEvent
      | SpaceDeleteEvent
      | TableDeleteEvent
      | ViewDeleteEvent
      | DashboardDeleteEvent
      | WorkflowDeleteEvent
      | AppDeleteEvent
  ) {
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
      case Events.TABLE_DELETE:
        await this.prismaService.userLastVisit.deleteMany({
          where: {
            OR: [
              {
                resourceId: listenerEvent.payload.tableId,
                resourceType: LastVisitResourceType.Table,
              },
              {
                parentResourceId: listenerEvent.payload.tableId,
                resourceType: LastVisitResourceType.View,
              },
            ],
          },
        });
        break;
      case Events.TABLE_VIEW_DELETE:
        await this.prismaService.userLastVisit.deleteMany({
          where: {
            resourceId: listenerEvent.payload.viewId,
            resourceType: LastVisitResourceType.View,
          },
        });
        break;
      case Events.DASHBOARD_DELETE:
        await this.prismaService.userLastVisit.deleteMany({
          where: {
            resourceId: listenerEvent.payload.dashboardId,
            resourceType: LastVisitResourceType.Dashboard,
          },
        });
        break;
      case Events.WORKFLOW_DELETE:
        await this.prismaService.userLastVisit.deleteMany({
          where: {
            resourceId: listenerEvent.payload.workflowId,
            resourceType: LastVisitResourceType.Workflow,
          },
        });
        break;
      case Events.APP_DELETE:
        await this.prismaService.userLastVisit.deleteMany({
          where: {
            resourceId: listenerEvent.payload.appId,
            resourceType: LastVisitResourceType.App,
          },
        });
        break;
    }

    this.eventEmitterService.emitAsync(Events.LAST_VISIT_CLEAR, {});
  }
}
