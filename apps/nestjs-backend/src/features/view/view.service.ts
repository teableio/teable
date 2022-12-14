import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { generateViewId } from '../../utils/id-generator';
import type { CreateViewDto } from './create-view.dto';

export const ROW_INDEX_FIELD_PREFIX = '__row';

@Injectable()
export class ViewService {
  constructor(private readonly prisma: PrismaService) {}

  getRowIndexFieldName(viewId: string) {
    return `${ROW_INDEX_FIELD_PREFIX}_${viewId}`;
  }

  async generateCreateViewPromise(tableId: string, createViewDto: CreateViewDto) {
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

    const { dbTableName } = await this.prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const rowIndexFieldName = this.getRowIndexFieldName(viewId);
    return [
      // create a new view in view model
      this.prisma.view.create({
        data,
      }),
      // add a field for maintain row order index
      this.prisma.$executeRawUnsafe(`
        ALTER TABLE ${dbTableName}
        ADD ${rowIndexFieldName} INT;
      `),
      // fill initial order for every record, with auto increment integer
      this.prisma.$executeRawUnsafe(`
        DECLARE @rowOrder INT = 0
        UPDATE ${dbTableName}
        SET ${rowIndexFieldName} = @rowOrder := @rowOrder + 1;
      `),
      // set strick not null and unique type for safety
      this.prisma.$executeRawUnsafe(`
        ALTER TABLE ${dbTableName}
        ALTER COLUMN ${rowIndexFieldName} NOT NULL UNIQUE;
      `),
    ];
  }

  async createView(tableId: string, createViewDto: CreateViewDto) {
    const prismaPromises = await this.generateCreateViewPromise(tableId, createViewDto);
    const [viewData] = await this.prisma.$transaction(prismaPromises);
    return viewData;
  }

  async getView(tableId: string, viewId: string) {
    return `get tableId: ${tableId} ViewId: ${viewId}`;
  }
}
