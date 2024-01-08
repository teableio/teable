import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  ICreateTableRo,
  IOtOperation,
  ISetTablePropertyOpContext,
  ISnapshotBase,
  ITableFullVo,
  ITableVo,
} from '@teable-group/core';
import {
  FieldKeyType,
  generateTableId,
  getRandomString,
  getUniqName,
  IdPrefix,
  nullsToUndefined,
  tablePropertyKeySchema,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { fromZodError } from 'zod-validation-error';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IAdapterService } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { Timing } from '../../utils/timing';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { BatchService } from '../calculation/batch.service';
import { FieldService } from '../field/field.service';
import { RecordService } from '../record/record.service';
import { ViewService } from '../view/view.service';

@Injectable()
export class TableService implements IAdapterService {
  private logger = new Logger(TableService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly batchService: BatchService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly attachmentService: AttachmentsTableService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  generateValidName(name: string) {
    return convertNameToValidCharacter(name, 40);
  }

  private async createDBTable(baseId: string, tableRo: ICreateTableRo) {
    const userId = this.cls.get('user.id');
    const tableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { name: true, order: true },
    });
    const tableId = generateTableId();
    const names = tableRaws.map((table) => table.name);
    const uniqName = getUniqName(tableRo.name ?? 'New table', names);
    const order =
      tableRaws.reduce((acc, cur) => {
        return acc > cur.order ? acc : cur.order;
      }, 0) + 1;

    const validTableName = this.generateValidName(uniqName);
    let dbTableName = this.dbProvider.generateDbTableName(
      baseId,
      tableRo.dbTableName || validTableName
    );

    const existTable = await this.prismaService.txClient().tableMeta.findFirst({
      where: { dbTableName: tableRo.dbTableName },
      select: { id: true },
    });

    if (existTable) {
      if (tableRo.dbTableName) {
        throw new BadRequestException(`dbTableName ${tableRo.dbTableName} is already used`);
      } else {
        // add uniqId ensure no conflict
        dbTableName += getRandomString(10);
      }
    }

    const data: Prisma.TableMetaCreateInput = {
      id: tableId,
      base: {
        connect: {
          id: baseId,
        },
      },
      name: uniqName,
      description: tableRo.description,
      icon: tableRo.icon,
      dbTableName,
      order,
      createdBy: userId,
      lastModifiedBy: userId,
      lastModifiedTime: new Date(),
      version: 1,
    };

    const tableMeta = await this.prismaService.txClient().tableMeta.create({
      data,
    });

    const createTableSchema = this.knex.schema.createTable(dbTableName, (table) => {
      table.string('__id').unique().notNullable();
      table.increments('__auto_number').primary();
      table.dateTime('__created_time').defaultTo(this.knex.fn.now()).notNullable();
      table.dateTime('__last_modified_time');
      table.string('__created_by').notNullable();
      table.string('__last_modified_by');
      table.integer('__version').notNullable();
    });

    for (const sql of createTableSchema.toSQL()) {
      await this.prismaService.txClient().$executeRawUnsafe(sql.sql);
    }
    return tableMeta;
  }

  @Timing()
  async getTableLastModifiedTime(tableIds: string[]) {
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
      return item?.lastModifiedTime?.toISOString();
    });
  }

  async getTableDefaultViewId(tableIds: string[]) {
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

  async getFullTable(
    baseId: string,
    tableId: string,
    viewId?: string,
    queryUserId?: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<ITableFullVo> {
    const tableMeta = await this.getTableMeta(baseId, tableId);
    const fields = await this.fieldService.getFieldsByQuery(tableId, { viewId });
    const views = await this.viewService.getViews(tableId);
    const { records } = await this.recordService.getRecords(tableId, {
      viewId,
      skip: 0,
      take: 50,
      fieldKeyType,
      queryUserId,
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

  async createTable(baseId: string, snapshot: ICreateTableRo): Promise<ITableVo> {
    const tableVo = await this.createDBTable(baseId, snapshot);
    await this.batchService.saveRawOps(baseId, RawOpType.Create, IdPrefix.Table, [
      {
        docId: tableVo.id,
        version: 0,
        data: tableVo,
      },
    ]);
    return nullsToUndefined({
      ...tableVo,
      lastModifiedTime: tableVo.lastModifiedTime?.toISOString(),
    });
  }

  async deleteTable(baseId: string, tableId: string) {
    const result = await this.prismaService.txClient().tableMeta.findFirst({
      where: { id: tableId, baseId, deletedTime: null },
    });

    if (!result) {
      throw new NotFoundException('Table not found');
    }

    const { version } = result;
    await this.del(version + 1, baseId, tableId);

    await this.batchService.saveRawOps(baseId, RawOpType.Del, IdPrefix.Table, [
      { docId: tableId, version },
    ]);
  }

  async updateTable(
    baseId: string,
    tableId: string,
    input: Omit<
      Prisma.TableMetaUpdateInput,
      | 'id'
      | 'createdBy'
      | 'lastModifiedBy'
      | 'createdTime'
      | 'lastModifiedTime'
      | 'version'
      | 'base'
      | 'fields'
      | 'views'
    >
  ) {
    const select = Object.keys(input).reduce<{ [key: string]: boolean }>((acc, key) => {
      acc[key] = true;
      return acc;
    }, {});

    const tableRaw = await this.prismaService
      .txClient()
      .tableMeta.findFirstOrThrow({
        where: { id: tableId, baseId, deletedTime: null },
        select: {
          ...select,
          version: true,
          lastModifiedBy: true,
          lastModifiedTime: true,
        },
      })
      .catch(() => {
        throw new BadRequestException('Table not found');
      });

    const updateInput: Prisma.TableMetaUpdateInput = {
      ...input,
      version: tableRaw.version + 1,
      lastModifiedBy: this.cls.get('user.id'),
      lastModifiedTime: new Date(),
    };

    const ops = Object.entries(updateInput)
      .filter(([key, value]) => Boolean(value == (tableRaw as Record<string, unknown>)[key]))
      .map<IOtOperation>(([key, value]) => {
        return {
          p: [key],
          oi: value,
          od: (tableRaw as Record<string, unknown>)[key],
        };
      });

    const tableRawAfter = await this.prismaService.txClient().tableMeta.update({
      where: { id: tableId },
      data: updateInput,
    });

    await this.batchService.saveRawOps(baseId, RawOpType.Edit, IdPrefix.Table, [
      {
        docId: tableId,
        version: tableRaw.version,
        data: ops,
      },
    ]);

    return tableRawAfter;
  }

  async create(baseId: string, snapshot: ITableVo) {
    await this.createDBTable(baseId, snapshot);
  }

  async del(version: number, baseId: string, tableId: string) {
    const userId = this.cls.get('user.id');
    await this.attachmentService.deleteTable(tableId);
    await this.prismaService.txClient().tableMeta.update({
      where: { id: tableId, baseId },
      data: { version, deletedTime: new Date(), lastModifiedBy: userId },
    });
  }

  async update(
    version: number,
    baseId: string,
    tableId: string,
    opContexts: ISetTablePropertyOpContext[]
  ) {
    const userId = this.cls.get('user.id');

    for (const opContext of opContexts) {
      const { key, newValue } = opContext;
      const result = tablePropertyKeySchema.safeParse({ [key]: newValue });
      if (!result.success) {
        throw new BadRequestException(fromZodError(result.error).message);
      }

      // skip undefined value
      const parsedValue = result.data[key];
      if (parsedValue === undefined) {
        continue;
      }

      await this.prismaService.txClient().tableMeta.update({
        where: { id: tableId, baseId },
        data: { [key]: parsedValue, version, lastModifiedBy: userId },
      });
    }
  }

  async getSnapshotBulk(baseId: string, ids: string[]): Promise<ISnapshotBase<ITableVo>[]> {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId, id: { in: ids }, deletedTime: null },
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

  async getDocIdsByQuery(baseId: string, _query: unknown) {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { deletedTime: null, baseId },
      select: { id: true },
      orderBy: { order: 'asc' },
    });
    return { ids: tables.map((table) => table.id) };
  }
}
