/* eslint-disable @typescript-eslint/naming-convention */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { nullsToUndefined, type ViewType } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import type { IGetPinListVo, AddPinRo, DeletePinRo, UpdatePinOrderRo } from '@teable/openapi';
import { PinType } from '@teable/openapi';
import { keyBy } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type {
  BaseDeleteEvent,
  SpaceDeleteEvent,
  TableDeleteEvent,
  ViewDeleteEvent,
} from '../../event-emitter/events';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';

@Injectable()
export class PinService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
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
        throw new BadRequestException('Pin already exists');
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
        throw new NotFoundException('Pin not found');
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
    const baseIds: string[] = [];
    const spaceIds: string[] = [];
    const tableIds: string[] = [];
    const viewIds: string[] = [];
    list.forEach((item) => {
      switch (item.type) {
        case PinType.Base:
          baseIds.push(item.resourceId);
          break;
        case PinType.Space:
          spaceIds.push(item.resourceId);
          break;
        case PinType.Table:
          tableIds.push(item.resourceId);
          break;
        case PinType.View:
          viewIds.push(item.resourceId);
          break;
      }
    });
    const baseList = baseIds.length
      ? await this.prismaService.base.findMany({
          where: {
            id: { in: baseIds },
            deletedTime: null,
          },
          select: {
            id: true,
            name: true,
            icon: true,
          },
        })
      : [];
    const spaceList = spaceIds.length
      ? await this.prismaService.space.findMany({
          where: { id: { in: spaceIds }, deletedTime: null },
          select: {
            id: true,
            name: true,
          },
        })
      : [];
    const tableList = tableIds.length
      ? await this.prismaService.tableMeta.findMany({
          where: { id: { in: tableIds }, deletedTime: null },
          select: {
            id: true,
            name: true,
            baseId: true,
            icon: true,
          },
        })
      : [];
    const viewList = viewIds.length
      ? await this.prismaService.$queryRaw<
          {
            id: string;
            name: string;
            base_id: string;
            table_id: string;
            type: ViewType;
            options: string;
          }[]
        >(Prisma.sql`
      SELECT view.id, view.name, table_meta.base_id as base_id, table_meta.id as table_id, view.type, view.options FROM view left join table_meta on view.table_id = table_meta.id WHERE view.id IN (${Prisma.join(viewIds)}) and view.deleted_time is null and table_meta.deleted_time is null
    `)
      : [];
    const spaceMap = keyBy(spaceList, 'id');
    const baseMap = keyBy(baseList, 'id');
    const tableMap = keyBy(tableList, 'id');
    const viewMap = keyBy(viewList, 'id');
    const getResource = (type: PinType, resourceId: string) => {
      switch (type) {
        case PinType.Base:
          return baseMap[resourceId]
            ? {
                name: baseMap[resourceId].name,
                icon: baseMap[resourceId].icon,
              }
            : undefined;
        case PinType.Space:
          return spaceMap[resourceId]
            ? {
                name: spaceMap[resourceId].name,
              }
            : undefined;
        case PinType.Table:
          return tableMap[resourceId]
            ? {
                name: tableMap[resourceId].name,
                parentBaseId: tableMap[resourceId].baseId,
                icon: tableMap[resourceId].icon,
              }
            : undefined;
        case PinType.View: {
          const view = viewMap[resourceId];
          if (!view) {
            return undefined;
          }
          const pluginLogo = view.options ? JSON.parse(view.options)?.pluginLogo : undefined;
          return {
            name: view.name,
            parentBaseId: view.base_id,
            viewMeta: {
              tableId: view.table_id,
              type: view.type,
              pluginLogo: pluginLogo ? getPublicFullStorageUrl(pluginLogo) : undefined,
            },
          };
        }
        default:
          return undefined;
      }
    };
    return list
      .map((item) => {
        const { resourceId, type, order } = item;
        const resource = getResource(type as PinType, resourceId);
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
        throw new NotFoundException('Pin not found');
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
        throw new NotFoundException('Pin Anchor not found');
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
  protected async resourceDeleteListener(
    listenerEvent: ViewDeleteEvent | TableDeleteEvent | BaseDeleteEvent | SpaceDeleteEvent
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
    }
  }
}
