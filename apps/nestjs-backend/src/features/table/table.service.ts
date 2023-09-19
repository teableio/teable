import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ITableFullVo,
  ISetTableNameOpContext,
  ISetTableOrderOpContext,
  ISnapshotBase,
  ITableVo,
  IGetTableQuery,
} from '@teable-group/core';
import { FieldKeyType, OpName } from '@teable-group/core';
import { Prisma, PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import type { IAdapterService } from '../../share-db/interface';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { Timing } from '../../utils/timing';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { FieldService } from '../field/field.service';
import { RecordService } from '../record/record.service';
import { ViewService } from '../view/view.service';

const tableNamePrefix = 'visual';

@Injectable()
export class TableService implements IAdapterService {
  private logger = new Logger(TableService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly attachmentService: AttachmentsTableService,
    @InjectModel() private readonly knex: Knex
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

    const createTableSchema = this.knex.schema.createTable(dbTableName, (table) => {
      table.text('__id').unique().notNullable();
      table.increments('__auto_number').primary();
      table.double('__row_default').notNullable();
      table.dateTime('__created_time').defaultTo(this.knex.fn.now()).notNullable();
      table.dateTime('__last_modified_time');
      table.text('__created_by').notNullable();
      table.text('__last_modified_by');
      table.integer('__version').notNullable();
    });

    for (const sql of createTableSchema.toSQL()) {
      await prisma.$executeRawUnsafe(sql.sql);
    }
    return tableMeta;
  }

  @Timing()
  private async getTableLastModifiedTime(prisma: Prisma.TransactionClient, tableIds: string[]) {
    if (!tableIds.length) return [];

    const nativeSql = this.knex
      .select({
        tableId: 'id',
        lastModifiedTime: this.knex
          .select('created_time')
          .from('ops')
          .whereRaw('ops.collection = table_meta.id')
          .orderBy('created_time', 'desc')
          .limit(1),
      })
      .from('table_meta')
      .whereIn('id', tableIds)
      .toSQL()
      .toNative();

    const results = await prisma.$queryRawUnsafe<{ tableId: string; lastModifiedTime: Date }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );

    return tableIds.map((tableId) => {
      const item = results.find((result) => result.tableId === tableId);
      return item?.lastModifiedTime.toISOString();
    });
  }

  private async getTableDefaultViewId(prisma: Prisma.TransactionClient, tableIds: string[]) {
    if (!tableIds.length) return [];

    const nativeSql = this.knex
      .select({
        tableId: 'id',
        viewId: this.knex
          .select('id')
          .from('view')
          .whereRaw('view.table_id = table_meta.id')
          .orderBy('order')
          .limit(1),
      })
      .from('table_meta')
      .whereIn('id', tableIds)
      .toSQL()
      .toNative();

    const results = await prisma.$queryRawUnsafe<{ tableId: string; viewId: string }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );

    return tableIds.map((tableId) => {
      const item = results.find((result) => result.tableId === tableId);
      return item?.viewId;
    });
  }

  async getTables(): Promise<ITableVo[]> {
    const tablesMeta = await this.prismaService.tableMeta.findMany({
      orderBy: { order: 'asc' },
      where: { deletedTime: null },
    });
    const tableIds = tablesMeta.map((tableMeta) => tableMeta.id);
    const tableTime = await this.getTableLastModifiedTime(this.prismaService, tableIds);
    const tableDefaultViewIds = await this.getTableDefaultViewId(this.prismaService, tableIds);
    return tablesMeta.map((tableMeta, i) => {
      const time = tableTime[i];
      const defaultViewId = tableDefaultViewIds[i];
      if (!defaultViewId) {
        throw new Error('defaultViewId is not found');
      }
      return {
        ...tableMeta,
        description: tableMeta.description ?? undefined,
        icon: tableMeta.icon ?? undefined,
        lastModifiedTime: time || tableMeta.lastModifiedTime.toISOString(),
        defaultViewId,
      };
    });
  }

  async getTableMeta(tableId: string): Promise<ITableVo> {
    const tableMeta = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
    });

    if (!tableMeta) {
      throw new NotFoundException();
    }

    const tableTime = await this.getTableLastModifiedTime(this.prismaService, [tableId]);
    const tableDefaultViewIds = await this.getTableDefaultViewId(this.prismaService, [tableId]);
    if (!tableDefaultViewIds[0]) {
      throw new Error('defaultViewId is not found');
    }

    return {
      ...tableMeta,
      description: tableMeta.description ?? undefined,
      icon: tableMeta.icon ?? undefined,
      lastModifiedTime: tableTime[0] || tableMeta.createdTime.toISOString(),
      defaultViewId: tableDefaultViewIds[0],
    };
  }

  private async getFullTable(
    tableId: string,
    viewId?: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<ITableFullVo> {
    const tableMeta = await this.getTableMeta(tableId);
    const fields = await this.fieldService.getFields(tableId, { viewId });
    const views = await this.viewService.getViews(tableId);
    const { records } = await this.recordService.getRecords(tableId, {
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
    };
  }
  async getTable(tableId: string, query: IGetTableQuery): Promise<ITableVo> {
    const { viewId, fieldKeyType, includeContent } = query;
    if (includeContent) {
      return await this.getFullTable(tableId, viewId, fieldKeyType);
    }
    return await this.getTableMeta(tableId);
  }

  async getDefaultViewId(tableId: string) {
    const viewRaw = await this.prismaService.view.findFirst({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });
    if (!viewRaw) {
      throw new NotFoundException('Table No found');
    }
    return viewRaw;
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
      throw new InternalServerErrorException(`Unknown context ${opContext} for table update`);
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
    const tableTime = await this.getTableLastModifiedTime(prisma, ids);
    const tableDefaultViewIds = await this.getTableDefaultViewId(prisma, ids);

    return tables
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      .map((table, i) => {
        return {
          id: table.id,
          v: table.version,
          type: 'json0',
          data: {
            ...table,
            description: table.description ?? undefined,
            icon: table.icon ?? undefined,
            order: table.order,
            lastModifiedTime: tableTime[i] || table.createdTime.toISOString(),
            defaultViewId: tableDefaultViewIds[i],
          },
        };
      });
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
