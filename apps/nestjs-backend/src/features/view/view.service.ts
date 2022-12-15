import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { generateViewId } from '../../utils/id-generator';
import { ROW_INDEX_FIELD_PREFIX } from './constant';
import type { CreateViewDto } from './create-view.dto';

@Injectable()
export class ViewService {
  constructor(private readonly prisma: PrismaService) {}

  getRowIndexFieldName(viewId: string) {
    return `${ROW_INDEX_FIELD_PREFIX}_${viewId}`;
  }

  async createViewTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createViewDto: CreateViewDto
  ) {
    const { name, description, type, options, sort, filter } = createViewDto;
    const viewId = generateViewId();
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

    // 2. add a field for maintain row order index
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${dbTableName}
      ADD ${rowIndexFieldName} INT;
    `);

    // 3. fill initial order for every record, with auto increment integer
    await prisma.$executeRawUnsafe(`
      UPDATE ${dbTableName} SET ${rowIndexFieldName} = __autoNumber;
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
