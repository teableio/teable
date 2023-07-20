import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type {
  IFullTableVo,
  IGetTableQuery,
  ISetTableNameOpContext,
  ISetTableOrderOpContext,
  ISnapshotBase,
  ITableVo,
} from '@teable-group/core';
import { FieldKeyType, OpName } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { visualTableSql } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import type { IAdapterService } from '../../share-db/interface';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { FieldService } from '../field/field.service';
import { RecordService } from '../record/record.service';
import { ViewService } from '../view/view.service';

const tableNamePrefix = 'visual';

@Injectable()
export class TableService implements IAdapterService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly attachmentService: AttachmentsTableService
  ) {}

  generateValidDbTableName(name: string) {
    const validInputName = convertNameToValidCharacter(name);
    return `${tableNamePrefix}_${validInputName}`;
  }

  private async createDBTable(
    prisma: Prisma.TransactionClient,
    snapshot: Pick<ITableVo, 'id' | 'name' | 'description' | 'order' | 'icon'>
  ) {
    const tableId = snapshot.id;
    const validDbTableName = this.generateValidDbTableName(snapshot.name);
    const dbTableName = `${validDbTableName}_${tableId}`;
    const data: Prisma.TableMetaCreateInput = {
      id: tableId,
      name: snapshot.name,
      description: snapshot.description,
      icon: snapshot.icon,
      dbTableName,
      order: snapshot.order,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
      version: 1,
    };
    const tableMeta = await prisma.tableMeta.create({
      data,
    });

    // create a real db table
    await prisma.$executeRawUnsafe(visualTableSql(dbTableName));
    return tableMeta;
  }

  async getTables(): Promise<ITableVo[]> {
    const tablesMeta = await this.prismaService.tableMeta.findMany({
      orderBy: { order: 'asc' },
      where: { deletedTime: null },
    });

    return tablesMeta.map((tableMeta) => ({
      ...tableMeta,
      description: tableMeta.description ?? undefined,
      icon: tableMeta.icon ?? undefined,
    }));
  }

  /**
   * ! dangerous function, table will be dropped, and all data will be lost
   */
  async deleteTableArbitrary(tableId: string) {
    return await this.prismaService.$transaction(async (prisma) => {
      // delete field for table
      await prisma.field.deleteMany({
        where: { tableId },
      });

      // delete view for table
      await prisma.view.deleteMany({
        where: { tableId },
      });

      // clear tableMeta
      const deleteTable = await prisma.tableMeta.delete({
        where: { id: tableId },
      });
      const dbTableName = deleteTable.dbTableName;
      console.log('Dropping: ', dbTableName);

      // drop db table
      await prisma.$executeRawUnsafe(`DROP TABLE ${dbTableName}`);
    });
  }

  async getTableMeta(tableId: string): Promise<ITableVo> {
    const tableMeta = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
    });

    if (!tableMeta) {
      throw new NotFoundException('No found');
    }

    return {
      ...tableMeta,
      description: tableMeta.description ?? undefined,
      icon: tableMeta.icon ?? undefined,
    };
  }

  private async getFullTable(
    tableId: string,
    viewId?: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<IFullTableVo> {
    const tableMeta = await this.getTableMeta(tableId);
    const fields = await this.fieldService.getFields(tableId, { viewId });
    const views = await this.viewService.getViews(tableId);
    const { records, total } = await this.recordService.getRecords(tableId, {
      viewId,
      skip: 0,
      take: 50,
      fieldKeyType,
    });

    return {
      ...tableMeta,
      description: tableMeta.description ?? undefined,
      icon: tableMeta.icon ?? undefined,
      fields,
      views,
      records,
      total,
    };
  }

  async getTable(tableId: string, query: IGetTableQuery): Promise<ITableVo> {
    const { viewId, fieldKeyType, needFullTable } = query;
    if (needFullTable) {
      return await this.getFullTable(tableId, viewId, fieldKeyType);
    }
    return await this.getTableMeta(tableId);
  }

  async getDefaultViewId(tableId: string) {
    try {
      return this.prismaService.view.findFirstOrThrow({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
    } catch (e) {
      throw new HttpException('No found', HttpStatus.NOT_FOUND);
    }
  }

  async create(prisma: Prisma.TransactionClient, _collection: string, snapshot: ITableVo) {
    await this.createDBTable(prisma, snapshot);
  }

  async del(prisma: Prisma.TransactionClient, _collection: string, tableId: string) {
    await this.attachmentService.delete(prisma, [{ tableId: tableId }]);
    await prisma.tableMeta.update({
      where: { id: tableId },
      data: { deletedTime: new Date() },
    });
  }

  async update(
    prisma: Prisma.TransactionClient,
    version: number,
    _collection: string,
    tableId: string,
    opContexts: (ISetTableNameOpContext | ISetTableOrderOpContext)[]
  ) {
    for (const opContext of opContexts) {
      switch (opContext.name) {
        case OpName.SetTableName: {
          const { newName } = opContext;
          await prisma.tableMeta.update({
            where: { id: tableId },
            data: { name: newName, version },
          });
          return;
        }
        case OpName.SetTableOrder: {
          const { newOrder } = opContext;
          await prisma.tableMeta.update({
            where: { id: tableId },
            data: { order: newOrder, version },
          });
          return;
        }
      }
      throw new Error(`Unknown context ${opContext} for table update`);
    }
  }

  async getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    _collection: string,
    ids: string[]
  ): Promise<ISnapshotBase<ITableVo>[]> {
    const tables = await prisma.tableMeta.findMany({
      where: { id: { in: ids }, deletedTime: null },
    });

    return tables
      .map((table) => {
        return {
          id: table.id,
          v: table.version,
          type: 'json0',
          data: {
            ...table,
            description: table.description ?? undefined,
            icon: table.icon ?? undefined,
            order: table.order,
          },
        };
      })
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }

  async getDocIdsByQuery(prisma: Prisma.TransactionClient, _collection: string, _query: unknown) {
    const tables = await prisma.tableMeta.findMany({
      where: { deletedTime: null },
      select: { id: true },
      orderBy: { order: 'asc' },
    });
    return { ids: tables.map((table) => table.id) };
  }
}
