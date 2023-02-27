import { Injectable } from '@nestjs/common';
import type { IColumnMeta, IViewSnapshot } from '@teable-group/core';
import { generateViewId } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { ROW_ORDER_FIELD_PREFIX } from './constant';
import type { CreateViewRo } from './model/create-view.ro';
import { createViewInstanceByRaw } from './model/factory';
import type { ViewVo } from './model/view.vo';

@Injectable()
export class ViewService {
  constructor(private readonly prisma: PrismaService) {}

  getRowIndexFieldName(viewId: string) {
    return `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
  }

  private async updateColumnMeta(
    prisma: Prisma.TransactionClient,
    tableId: string,
    viewId: string
  ) {
    const fields = await prisma.field.findMany({
      where: { tableId },
      select: { id: true, columnMeta: true },
    });

    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      const columnMeta: IColumnMeta = JSON.parse(field.columnMeta);
      columnMeta[viewId] = {
        order: index,
      };

      await prisma.field.update({
        where: { id: field.id },
        data: { columnMeta: JSON.stringify(columnMeta) },
      });
    }
  }

  async createViewTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createViewRo: CreateViewRo,
    order?: number
  ) {
    const { name, description, type, options, sort, filter, group } = createViewRo;
    const viewId = generateViewId();

    if (!order) {
      const viewAggregate = await prisma.view.aggregate({
        where: { tableId },
        _max: { order: true },
      });
      order = (viewAggregate._max.order || 0) + 1;
    }

    const data: Prisma.ViewCreateInput = {
      id: viewId,
      table: {
        connect: {
          id: tableId,
        },
      },
      name,
      description,
      type,
      options: options ? JSON.stringify(options) : undefined,
      sort: sort ? JSON.stringify(sort) : undefined,
      filter: filter ? JSON.stringify(filter) : undefined,
      group: group ? JSON.stringify(group) : undefined,
      version: 1,
      order,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const rowIndexFieldName = this.getRowIndexFieldName(viewId);

    // 1. create a new view in view model
    const viewData = await prisma.view.create({
      data,
    });

    // 2. add view id to columnMeta in every field
    await this.updateColumnMeta(prisma, tableId, viewId);

    // 3. add a field for maintain row order number
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${dbTableName}
      ADD ${rowIndexFieldName} REAL;
    `);

    // 4. fill initial order for every record, with auto increment integer
    await prisma.$executeRawUnsafe(`
      UPDATE ${dbTableName} SET ${rowIndexFieldName} = __row_default;
    `);

    // set strick not null and unique type for safety（sqlite cannot do that)
    // prisma.$executeRawUnsafe(`
    //   ALTER TABLE ${dbTableName}
    //   CONSTRAINT COLUMN ${rowIndexFieldName} NOT NULL UNIQUE;
    // `),

    return viewData;
  }

  async getViewIds(prisma: Prisma.TransactionClient, tableId: string): Promise<string[]> {
    const views = await prisma.view.findMany({
      where: { tableId },
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    return views.map((v) => v.id);
  }

  async getViewById(viewId: string): Promise<ViewVo> {
    const viewRaw = await this.prisma.view.findUniqueOrThrow({
      where: { id: viewId },
    });

    return createViewInstanceByRaw(viewRaw) as ViewVo;
  }

  async getViews(tableId: string): Promise<ViewVo[]> {
    const viewRaws = await this.prisma.view.findMany({
      where: { tableId },
    });

    return viewRaws.map((viewRaw) => createViewInstanceByRaw(viewRaw) as ViewVo);
  }

  async addView(prisma: Prisma.TransactionClient, tableId: string, snapshot: IViewSnapshot) {
    const { view, order } = snapshot;
    return await this.createViewTransaction(prisma, tableId, view as CreateViewRo, order);
  }
}
