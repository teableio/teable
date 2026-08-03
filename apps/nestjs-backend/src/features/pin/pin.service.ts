/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { HttpErrorCode, nullsToUndefined, type ViewType } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import type { IGetPinListVo, AddPinRo, DeletePinRo, UpdatePinOrderRo } from '@teable/openapi';
import { PinType } from '@teable/openapi';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type {
  AppDeleteEvent,
  BaseDeleteEvent,
  DashboardDeleteEvent,
  SpaceDeleteEvent,
  TableDeleteEvent,
  ViewDeleteEvent,
  WorkflowDeleteEvent,
} from '../../event-emitter/events';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';

@Injectable()
export class PinService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getMaxOrder(where: Prisma.PinResourceWhereInput) {
    const aggregate = await this.prismaService.pinResource.aggregate({
      where,
      _max: { order: true },
    });
    return aggregate._max.order || 0;
  }

  async addPin(query: AddPinRo) {
    const { type, id } = query;
    const maxOrder = await this.getMaxOrder({
      createdBy: this.cls.get('user.id'),
    });
    return this.prismaService.pinResource
      .create({
        data: {
          type,
          resourceId: id,
          createdBy: this.cls.get('user.id'),
          order: maxOrder + 1,
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin already exists', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.pin.alreadyExists',
          },
        });
      });
  }

  async deletePin(query: DeletePinRo) {
    const { id, type } = query;
    return this.prismaService.pinResource
      .delete({
        where: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          createdBy_resourceId: {
            resourceId: id,
            createdBy: this.cls.get('user.id'),
          },
          type,
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.pin.notFound',
          },
        });
      });
  }

  async getList(): Promise<IGetPinListVo> {
    const list = await this.prismaService.pinResource.findMany({
      where: {
        createdBy: this.cls.get('user.id'),
      },
      select: {
        resourceId: true,
        type: true,
        order: true,
      },
      orderBy: {
        order: 'asc',
      },
    });

    // Group resource IDs by type
    const idsByType = list.reduce(
      (acc, item) => {
        const type = item.type as PinType;
        if (!acc[type]) {
          acc[type] = [];
        }
        acc[type].push(item.resourceId);
        return acc;
      },
      {} as Record<PinType, string[]>
    );

    // Fetch all resources in parallel
    const [baseList, spaceList, tableList, viewList, dashboardList, workflowList, appList] =
      await Promise.all([
        this.fetchBases(idsByType[PinType.Base]),
        this.fetchSpaces(idsByType[PinType.Space]),
        this.fetchTables(idsByType[PinType.Table]),
        this.fetchViews(idsByType[PinType.View]),
        this.fetchDashboards(idsByType[PinType.Dashboard]),
        this.fetchWorkflows(idsByType[PinType.Workflow]),
        this.fetchApps(idsByType[PinType.App]),
      ]);

    // Create lookup maps
    const resourceMaps = {
      [PinType.Base]: keyBy(baseList, 'id'),
      [PinType.Space]: keyBy(spaceList, 'id'),
      [PinType.Table]: keyBy(tableList, 'id'),
      [PinType.View]: keyBy(viewList, 'id'),
      [PinType.Dashboard]: keyBy(dashboardList, 'id'),
      [PinType.Workflow]: keyBy(workflowList, 'id'),
      [PinType.App]: keyBy(appList, 'id'),
    };

    return list
      .map((item) => {
        const { resourceId, type, order } = item;
        const resource = this.transformResource(type as PinType, resourceId, resourceMaps);
        if (!resource) {
          return undefined;
        }
        return {
          id: resourceId,
          type: type as PinType,
          order,
          ...nullsToUndefined(resource),
        };
      })
      .filter(Boolean) as IGetPinListVo;
  }

  private async fetchBases(ids?: string[]) {
    if (!ids?.length) return [];
    return this.prismaService.base.findMany({
      where: { id: { in: ids }, deletedTime: null },
      select: { id: true, name: true, icon: true },
    });
  }

  private async fetchSpaces(ids?: string[]) {
    if (!ids?.length) return [];
    return this.prismaService.space.findMany({
      where: { id: { in: ids }, deletedTime: null },
      select: { id: true, name: true },
    });
  }

  private async fetchTables(ids?: string[]) {
    if (!ids?.length) return [];
    return this.prismaService.tableMeta.findMany({
      where: { id: { in: ids }, deletedTime: null },
      select: { id: true, name: true, baseId: true, icon: true },
    });
  }

  private async fetchViews(ids?: string[]) {
    if (!ids?.length) return [];
    return this.prismaService.$queryRaw<
      {
        id: string;
        name: string;
        baseId: string;
        tableId: string;
        type: ViewType;
        options: string;
      }[]
    >(Prisma.sql`
      SELECT view.id, view.name, table_meta.base_id as "baseId", table_meta.id as "tableId", view.type, view.options
      FROM view
      LEFT JOIN table_meta ON view.table_id = table_meta.id
      WHERE view.id IN (${Prisma.join(ids)})
        AND view.deleted_time IS NULL
        AND table_meta.deleted_time IS NULL
    `);
  }

  private async fetchDashboards(ids?: string[]) {
    if (!ids?.length) return [];
    return this.prismaService.dashboard.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, baseId: true },
    });
  }

  private async fetchWorkflows(ids?: string[]) {
    if (!ids?.length) return [];
    const sql = this.knex('workflow')
      .select('id', 'name', this.knex.raw('base_id as "baseId"'))
      .whereIn('id', ids)
      .whereNull('deleted_time')
      .toQuery();
    return this.prismaService.$queryRawUnsafe<{ id: string; name: string; baseId: string }[]>(sql);
  }

  private async fetchApps(ids?: string[]) {
    if (!ids?.length) return [];
    const sql = this.knex('app')
      .select('id', 'name', this.knex.raw('base_id as "baseId"'))
      .whereIn('id', ids)
      .whereNull('deleted_time')
      .toQuery();
    return this.prismaService.$queryRawUnsafe<{ id: string; name: string; baseId: string }[]>(sql);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformResource(type: PinType, resourceId: string, resourceMaps: Record<PinType, any>) {
    const resource = resourceMaps[type]?.[resourceId];
    if (!resource) return undefined;

    switch (type) {
      case PinType.Base:
        return { name: resource.name, icon: resource.icon };
      case PinType.Space:
      case PinType.Dashboard:
      case PinType.Workflow:
      case PinType.App:
        return { name: resource.name, parentBaseId: resource.baseId };
      case PinType.Table:
        return { name: resource.name, parentBaseId: resource.baseId, icon: resource.icon };
      case PinType.View: {
        const pluginLogo = resource.options ? JSON.parse(resource.options)?.pluginLogo : undefined;
        return {
          name: resource.name,
          parentBaseId: resource.baseId,
          viewMeta: {
            tableId: resource.tableId,
            type: resource.type,
            pluginLogo: pluginLogo ? getPublicFullStorageUrl(pluginLogo) : undefined,
          },
        };
      }
      default:
        return undefined;
    }
  }

  async updateOrder(data: UpdatePinOrderRo) {
    const { id, type, position, anchorId, anchorType } = data;

    const item = await this.prismaService.pinResource
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: {
          resourceId: id,
          type,
          createdBy: this.cls.get('user.id'),
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.pin.notFound',
          },
        });
      });

    const anchorItem = await this.prismaService.pinResource
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: {
          resourceId: anchorId,
          type: anchorType,
          createdBy: this.cls.get('user.id'),
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin Anchor not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.pin.anchorNotFound',
          },
        });
      });

    await updateOrder({
      query: undefined,
      position,
      item,
      anchorItem,
      getNextItem: async (whereOrder, align) => {
        return this.prismaService.pinResource.findFirst({
          select: { order: true, id: true },
          where: {
            type: type,
            order: whereOrder,
          },
          orderBy: { order: align },
        });
      },
      update: async (_, id, data) => {
        await this.prismaService.pinResource.update({
          data: { order: data.newOrder },
          where: { id },
        });
      },
      shuffle: async () => {
        const orderKey = position === 'before' ? 'lt' : 'gt';
        const dataOrderKey = position === 'before' ? 'decrement' : 'increment';
        await this.prismaService.pinResource.updateMany({
          data: { order: { [dataOrderKey]: 1 } },
          where: {
            createdBy: this.cls.get('user.id'),
            order: {
              [orderKey]: anchorItem.order,
            },
          },
        });
      },
    });
  }

  async deletePinWithoutException(query: DeletePinRo) {
    const { id, type } = query;
    const existingPin = await this.prismaService.pinResource.findFirst({
      where: {
        resourceId: id,
        type,
      },
    });
    if (!existingPin) {
      return;
    }
    return this.prismaService.pinResource.deleteMany({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        resourceId: id,
        type,
      },
    });
  }

  @OnEvent(Events.TABLE_VIEW_DELETE, { async: true })
  @OnEvent(Events.TABLE_DELETE, { async: true })
  @OnEvent(Events.BASE_DELETE, { async: true })
  @OnEvent(Events.SPACE_DELETE, { async: true })
  @OnEvent(Events.DASHBOARD_DELETE, { async: true })
  @OnEvent(Events.WORKFLOW_DELETE, { async: true })
  @OnEvent(Events.APP_DELETE, { async: true })
  protected async resourceDeleteListener(
    listenerEvent:
      | ViewDeleteEvent
      | TableDeleteEvent
      | BaseDeleteEvent
      | SpaceDeleteEvent
      | DashboardDeleteEvent
      | WorkflowDeleteEvent
      | AppDeleteEvent
  ) {
    switch (listenerEvent.name) {
      case Events.TABLE_VIEW_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.viewId,
          type: PinType.View,
        });
        break;
      case Events.TABLE_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.tableId,
          type: PinType.Table,
        });
        break;
      case Events.BASE_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.baseId,
          type: PinType.Base,
        });
        break;
      case Events.SPACE_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.spaceId,
          type: PinType.Space,
        });
        break;
      case Events.DASHBOARD_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.dashboardId,
          type: PinType.Dashboard,
        });
        break;
      case Events.WORKFLOW_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.workflowId,
          type: PinType.Workflow,
        });
        break;
      case Events.APP_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.appId,
          type: PinType.App,
        });
        break;
    }
  }
}
