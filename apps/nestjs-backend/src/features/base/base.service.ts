import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IdPrefix, generateBaseId } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { BaseSchema } from '@teable-group/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from 'src/types/cls';
import { RecordService } from '../record/record.service';

@Injectable()
export class BaseService {
  private logger = new Logger(BaseService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async sqlQuery(tableId: string, viewId: string, sql: string) {
    this.logger.log('sqlQuery:sql: ' + sql);
    const { queryBuilder } = await this.recordService.buildQuery(tableId, {
      type: IdPrefix.Record,
      viewId,
      limit: -1,
    });
    const baseQuery = queryBuilder.toString();
    const { dbTableName } = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const combinedQuery = `
      WITH base AS (${baseQuery})
      ${sql.replace(dbTableName, 'base')};
    `;
    this.logger.log('sqlQuery:sql:combine: ' + combinedQuery);

    return this.prismaService.$queryRawUnsafe(combinedQuery);
  }

  async getBaseById(baseId: string) {
    const userId = this.cls.get('user.id');

    const base = await this.prismaService.base.findFirst({
      select: {
        id: true,
        name: true,
        order: true,
        icon: true,
        spaceId: true,
      },
      where: {
        id: baseId,
        deletedTime: null,
        createdBy: userId,
      },
    });
    if (!base) {
      throw new NotFoundException('Base not found');
    }
    return base;
  }

  async getBaseList() {
    const userId = this.cls.get('user.id');
    return this.prismaService.base.findMany({
      select: {
        id: true,
        name: true,
        order: true,
        spaceId: true,
        icon: true,
      },
      where: {
        deletedTime: null,
        createdBy: userId,
      },
    });
  }

  async createBase(createBaseRo: BaseSchema.ICreateBaseRo) {
    const userId = this.cls.get('user.id');
    const { name, spaceId } = createBaseRo;

    let order = createBaseRo.order;
    if (!order) {
      const spaceAggregate = await this.prismaService.base.aggregate({
        where: { spaceId, deletedTime: null },
        _max: { order: true },
      });
      order = (spaceAggregate._max.order || 0) + 1;
    }

    return this.prismaService.base.create({
      data: {
        id: generateBaseId(),
        name: name || 'Untitled Base',
        spaceId,
        order,
        createdBy: userId,
        lastModifiedBy: userId,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        spaceId: true,
        order: true,
      },
    });
  }

  async updateBase(baseId: string, updateBaseRo: BaseSchema.IUpdateBaseRo) {
    const userId = this.cls.get('user.id');

    return this.prismaService.base.update({
      data: {
        ...updateBaseRo,
        lastModifiedBy: userId,
      },
      select: {
        id: true,
        name: true,
        spaceId: true,
        order: true,
      },
      where: {
        id: baseId,
        deletedTime: null,
        createdBy: userId,
      },
    });
  }

  async deleteBase(baseId: string) {
    const userId = this.cls.get('user.id');

    await this.prismaService.base.update({
      data: { deletedTime: new Date(), lastModifiedBy: userId },
      where: { id: baseId, deletedTime: null },
    });
  }
}
