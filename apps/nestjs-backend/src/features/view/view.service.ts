import { Injectable } from '@nestjs/common';
import type { IColumnMeta } from '@teable-group/core';
import { generateViewId } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { ROW_ORDER_FIELD_PREFIX } from './constant';
import type { CreateViewDto } from './create-view.dto';

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
    createViewDto: CreateViewDto
  ) {
    const { name, description, type, options, sort, filter } = createViewDto;
    const viewId = generateViewId();

    const viewAggregate = await prisma.view.aggregate({
      where: { tableId },
      _max: { order: true },
    });
    const maxOrder = viewAggregate._max.order || 0;

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
      version: 1,
      order: maxOrder + 1,
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

  async createView(tableId: string, createViewDto: CreateViewDto) {
    return await this.createViewTransaction(this.prisma, tableId, createViewDto);
  }

  async getView(tableId: string, viewId: string) {
    return `get tableId: ${tableId} ViewId: ${viewId}`;
  }
}
