import { Injectable } from '@nestjs/common';
import type { ITableSnapshot, ITableVo } from '@teable-group/core';
import { generateTableId } from '@teable-group/core';
import type { Prisma, TableMeta } from '@teable-group/db-main-prisma';
import { visualTableSql } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { FieldService } from '../field/field.service';
import { createFieldInstanceByRo } from '../field/model/factory';
import { RecordService } from '../record/record.service';
import { ViewService } from '../view/view.service';
import { DEFAULT_FIELDS, DEFAULT_RECORDS, DEFAULT_VIEW } from './constant';
import type { CreateTableRo } from './create-table.ro';

const tableNamePrefix = 'visual';

@Injectable()
export class TableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService
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
      dbTableName,
      order: snapshot.order,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
      version: 1,
    };
    const tableMeta = await prisma.tableMeta.create({
      data,
    });
    console.log('table meta create succeed: ', tableMeta);

    // create a real db table
    const dbTable = await prisma.$executeRawUnsafe(visualTableSql(dbTableName));
    console.log('dbTable create succeed: ', dbTable);
    return tableMeta;
  }

  async createTable(createTableDto: CreateTableRo): Promise<TableMeta> {
    const tableId = generateTableId();

    return await this.prisma.$transaction(async (prisma) => {
      const count = await prisma.tableMeta.count();
      return await this.addTable(prisma, {
        table: { ...createTableDto, id: tableId },
        order: count,
      });
    });
  }

  async getTable(tableId: string): Promise<ITableVo> {
    const tableMeta = await this.prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
    });

    return {
      ...tableMeta,
      description: tableMeta.description ?? undefined,
    };
  }

  async getTables(): Promise<ITableVo[]> {
    const tablesMeta = await this.prisma.tableMeta.findMany();

    return tablesMeta.map((tableMeta) => ({
      ...tableMeta,
      description: tableMeta.description ?? undefined,
    }));
  }

  /**
   * ! dangerous function, table will be dropped, and all data will be lost
   */
  async deleteTableArbitrary(tableId: string) {
    return await this.prisma.$transaction(async (prisma) => {
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
      const view = await this.prisma.view.findFirstOrThrow({
        where: { tableId },
        select: { id: true },
      });
      viewId = view.id;
    }

    const tables = await this.getTables();

    const fields = await this.fieldService.getFields(tableId, { viewId });
    const views = await this.viewService.getViews(tableId);
    const recordData = await this.recordService.getRecords(tableId, {
      viewId,
      skip: 0,
      take: 50,
    });

    return {
      tables,
      fields,
      views,
      recordData,
    };
  }

  async addTable(prisma: Prisma.TransactionClient, snapshot: ITableSnapshot) {
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
    await this.recordService.multipleCreateRecordTransaction(prisma, tableId, DEFAULT_RECORDS);

    return tableMeta;
  }

  async getTableIds(prisma: Prisma.TransactionClient) {
    const tables = await prisma.tableMeta.findMany({
      select: { id: true },
      orderBy: { order: 'asc' },
    });
    return tables.map((table) => table.id);
  }
}
