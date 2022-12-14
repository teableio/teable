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

  async generateCreateViewPromise(
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

    console.log('dbTableName: ', dbTableName);

    const rowIndexFieldName = this.getRowIndexFieldName(viewId);
    return [
      // create a new view in view model
      prisma.view.create({
        data,
      }),
      // add a field for maintain row order index
      prisma.$executeRawUnsafe(`
        ALTER TABLE ${dbTableName}
        ADD ${rowIndexFieldName} INT;
      `),
      // fill initial order for every record, with auto increment integer
      prisma.$executeRawUnsafe(`
        UPDATE ${dbTableName} SET ${rowIndexFieldName} = __autoNumber
      `),
      // set strick not null and unique type for safety（sqlite cannot do that)
      // prisma.$executeRawUnsafe(`
      //   ALTER TABLE ${dbTableName}
      //   CONSTRAINT COLUMN ${rowIndexFieldName} NOT NULL UNIQUE;
      // `),
    ];
  }

  async createView(tableId: string, createViewDto: CreateViewDto) {
    const prismaPromises = await this.generateCreateViewPromise(
      this.prisma,
      tableId,
      createViewDto
    );
    const [viewData] = await this.prisma.$transaction(prismaPromises);
    return viewData;
  }

  async getView(tableId: string, viewId: string) {
    return `get tableId: ${tableId} ViewId: ${viewId}`;
  }
}
