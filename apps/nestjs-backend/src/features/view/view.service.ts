import { Injectable } from '@nestjs/common';
import type { IColumn } from '@teable-group/core';
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

  async getColumnsByView(prisma: Prisma.TransactionClient, viewId: string): Promise<IColumn[]> {
    const view = await prisma.view.findUniqueOrThrow({
      where: {
        id: viewId,
      },
      select: {
        id: true,
        columns: true,
      },
    });

    return JSON.parse(view.columns);
  }

  private async getAllFields(prisma: Prisma.TransactionClient, tableId: string) {
    return await prisma.field.findMany({
      where: {
        tableId,
      },
      select: {
        id: true,
      },
    });
  }

  async createViewTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createViewDto: CreateViewDto
  ) {
    const { name, description, type, options, sort, filter } = createViewDto;
    const viewId = generateViewId();
    const columns = (await this.getAllFields(prisma, tableId)).map((field) => ({
      fieldId: field.id,
    }));

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
      columns: JSON.stringify(columns),
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

    // 2. add a field for maintain row order number
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${dbTableName}
      ADD ${rowIndexFieldName} REAL;
    `);

    // 3. fill initial order for every record, with auto increment integer
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
