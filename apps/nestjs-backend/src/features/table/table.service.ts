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
import { ClsService } from 'nestjs-cls';
import type { IAdapterService } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
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
    private readonly cls: ClsService<IClsStore>,
    @InjectModel() private readonly knex: Knex
  ) {}

  generateValidDbTableName(name: string) {
    const validInputName = convertNameToValidCharacter(name);
    return `${tableNamePrefix}_${validInputName}`;
  }

  private async createDBTable(
    baseId: string,
    snapshot: Pick<ITableVo, 'id' | 'name' | 'description' | 'order' | 'icon'>
  ) {
    const userId = this.cls.get('user.id');
    const tableId = snapshot.id;
    const validDbTableName = this.generateValidDbTableName(snapshot.name);
    const dbTableName = `${validDbTableName}_${tableId}`;
    const data: Prisma.TableMetaCreateInput = {
      id: tableId,
      base: {
        connect: {
          id: baseId,
        },
      },
      name: snapshot.name,
      description: snapshot.description,
      icon: snapshot.icon,
      dbTableName,
      order: snapshot.order,
      createdBy: userId,
      lastModifiedBy: userId,
      version: 1,
    };
    const tableMeta = await this.prismaService.txClient().tableMeta.create({
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
      await this.prismaService.txClient().$executeRawUnsafe(sql.sql);
    }
    return tableMeta;
  }

  @Timing()
  private async getTableLastModifiedTime(tableIds: string[]) {
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

    const results = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ tableId: string; lastModifiedTime: Date }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );

    return tableIds.map((tableId) => {
      const item = results.find((result) => result.tableId === tableId);
      return item?.lastModifiedTime.toISOString();
    });
  }

  private async getTableDefaultViewId(tableIds: string[]) {
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

    const results = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ tableId: string; viewId: string }[]>(nativeSql.sql, ...nativeSql.bindings);

    return tableIds.map((tableId) => {
      const item = results.find((result) => result.tableId === tableId);
      return item?.viewId;
    });
  }

  async getTables(baseId: string): Promise<ITableVo[]> {
    const tablesMeta = await this.prismaService.txClient().tableMeta.findMany({
      orderBy: { order: 'asc' },
      where: { baseId, deletedTime: null },
    });
    const tableIds = tablesMeta.map((tableMeta) => tableMeta.id);
    const tableTime = await this.getTableLastModifiedTime(tableIds);
    const tableDefaultViewIds = await this.getTableDefaultViewId(tableIds);
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

  async getTableMeta(baseId: string, tableId: string): Promise<ITableVo> {
    const tableMeta = await this.prismaService.txClient().tableMeta.findFirst({
      where: { id: tableId, baseId, deletedTime: null },
    });

    if (!tableMeta) {
      throw new NotFoundException();
    }

    const tableTime = await this.getTableLastModifiedTime([tableId]);
    const tableDefaultViewIds = await this.getTableDefaultViewId([tableId]);
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
    baseId: string,
    tableId: string,
    viewId?: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<ITableFullVo> {
    const tableMeta = await this.getTableMeta(baseId, tableId);
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
  async getTable(baseId: string, tableId: string, query: IGetTableQuery): Promise<ITableVo> {
    const { viewId, fieldKeyType, includeContent } = query;
    if (includeContent) {
      return await this.getFullTable(baseId, tableId, viewId, fieldKeyType);
    }
    return await this.getTableMeta(baseId, tableId);
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

  async create(collection: string, snapshot: ITableVo) {
    await this.createDBTable(collection, snapshot);
  }

  async del(_collection: string, tableId: string) {
    const userId = this.cls.get('user.id');
    await this.attachmentService.delete([{ tableId: tableId }]);
    await this.prismaService.txClient().tableMeta.update({
      where: { id: tableId },
      data: { deletedTime: new Date(), lastModifiedBy: userId },
    });
  }

  async update(
    version: number,
    _collection: string,
    tableId: string,
    opContexts: (ISetTableNameOpContext | ISetTableOrderOpContext)[]
  ) {
    const userId = this.cls.get('user.id');

    for (const opContext of opContexts) {
      switch (opContext.name) {
        case OpName.SetTableName: {
          const { newName } = opContext;
          await this.prismaService.txClient().tableMeta.update({
            where: { id: tableId },
            data: { name: newName, version, lastModifiedBy: userId },
          });
          return;
        }
        case OpName.SetTableOrder: {
          const { newOrder } = opContext;
          await this.prismaService.txClient().tableMeta.update({
            where: { id: tableId },
            data: { order: newOrder, version, lastModifiedBy: userId },
          });
          return;
        }
      }
      throw new InternalServerErrorException(`Unknown context ${opContext} for table update`);
    }
  }

  async getSnapshotBulk(_collection: string, ids: string[]): Promise<ISnapshotBase<ITableVo>[]> {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: ids }, deletedTime: null },
    });
    const tableTime = await this.getTableLastModifiedTime(ids);
    const tableDefaultViewIds = await this.getTableDefaultViewId(ids);
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

  async getDocIdsByQuery(collection: string, _query: unknown) {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { deletedTime: null, baseId: collection },
      select: { id: true },
      orderBy: { order: 'asc' },
    });
    return { ids: tables.map((table) => table.id) };
  }
}
