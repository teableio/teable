import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  ISetTableNameOpContext,
  ISetTableOrderOpContext,
  ISnapshotBase,
  ITableSnapshot,
  ITableVo,
} from '@teable-group/core';
import { OpName, generateTableId } from '@teable-group/core';
import type { Prisma, TableMeta } from '@teable-group/db-main-prisma';
import { visualTableSql } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import type { IAdapterService } from '../../share-db/interface';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { FieldService } from '../field/field.service';
import { createFieldInstanceByRo } from '../field/model/factory';
import { RecordService } from '../record/record.service';
import { ViewService } from '../view/view.service';
import { DEFAULT_FIELDS, DEFAULT_RECORD_DATA, DEFAULT_VIEW } from './constant';
import type { CreateTableRo } from './create-table.ro';

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

  private async createDBTable(prisma: Prisma.TransactionClient, snapshot: ITableSnapshot) {
    const tableId = snapshot.table.id;
    const validDbTableName = this.generateValidDbTableName(snapshot.table.name);
    const dbTableName = `${validDbTableName}_${tableId}`;
    const data: Prisma.TableMetaCreateInput = {
      id: tableId,
      name: snapshot.table.name,
      description: snapshot.table.description,
      icon: snapshot.table.icon,
      dbTableName,
      order: snapshot.table.order,
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

  async createTableByDto(createTableDto: CreateTableRo): Promise<TableMeta> {
    const tableId = generateTableId();

    return await this.prismaService.$transaction(async (prisma) => {
      const count = await prisma.tableMeta.count();
      return await this.createTable(prisma, {
        table: { ...createTableDto, id: tableId, order: count },
      });
    });
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

  async getTableSSRSnapshot() {
    const tables = await this.getTables();
    return { tables };
  }

  async getSSRSnapshot(tableId: string, viewId?: string) {
    if (!viewId) {
      try {
        const view = await this.prismaService.view.findFirstOrThrow({
          where: { tableId, deletedTime: null },
          select: { id: true },
        });
        viewId = view.id;
      } catch (e) {
        throw new HttpException('No found', HttpStatus.NOT_FOUND);
      }
    }

    const tables = await this.getTables();

    try {
      const fields = await this.fieldService.getFields(tableId, { viewId });
      const views = await this.viewService.getViews(tableId);
      const rows = await this.recordService.getRecords(tableId, {
        viewId,
        skip: 0,
        take: 50,
      });

      return {
        tables,
        fields,
        views,
        rows,
      };
    } catch (e) {
      throw new HttpException('No found', HttpStatus.NOT_FOUND);
    }
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

  private async createTable(prisma: Prisma.TransactionClient, snapshot: ITableSnapshot) {
    const tableId = snapshot.table.id;
    // 1. create db table
    const tableMeta = await this.createDBTable(prisma, snapshot);

    // 2. create field for table
    await this.fieldService.multipleCreateFieldsTransaction(
      prisma,
      tableId,
      DEFAULT_FIELDS.map(createFieldInstanceByRo)
    );

    // 3. create view for table
    await this.viewService.createViewTransaction(prisma, tableId, DEFAULT_VIEW);

    // 4. create records for table
    await this.recordService.multipleCreateRecordTransaction(prisma, tableId, DEFAULT_RECORD_DATA);

    return tableMeta;
  }

  async create(prisma: Prisma.TransactionClient, _collection: string, snapshot: ITableSnapshot) {
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
  ): Promise<ISnapshotBase<ITableSnapshot>[]> {
    const tables = await prisma.tableMeta.findMany({
      where: { id: { in: ids } },
    });

    return tables
      .map((table) => {
        return {
          id: table.id,
          v: table.version,
          type: 'json0',
          data: {
            table: {
              ...table,
              description: table.description ?? undefined,
              icon: table.icon ?? undefined,
            },
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
