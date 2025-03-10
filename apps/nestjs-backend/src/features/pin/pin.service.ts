import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  PinType,
  IGetPinListVo,
  AddPinRo,
  DeletePinRo,
  UpdatePinOrderRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';

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
    return list.map((item) => ({
      id: item.resourceId,
      type: item.type as PinType,
      order: item.order,
    }));
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
}
