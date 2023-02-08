import { HttpException, Injectable } from '@nestjs/common';
import { generateRecordId } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Knex } from 'knex';
import knex from 'knex';
import { getViewOrderFieldName } from '../../../src/utils/view-order-field-name';
import { PrismaService } from '../../prisma.service';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import type { CreateRecordsDto } from './create-records.dto';
import type { RecordsVo } from './open-api/record.vo';
import type { RecordsRo } from './open-api/records.ro';

type IUserFields = { id: string; dbFieldName: string }[];

export interface ISnapshotQuery {
  viewId: string;
  where?: Knex.DbRecord<unknown>;
  orderBy?: {
    column: string;
    order?: 'asc' | 'desc';
    nulls?: 'first' | 'last';
  }[];
  offset?: number;
  limit?: number;
  idOnly?: boolean;
}

@Injectable()
export class RecordService {
  queryBuilder: ReturnType<typeof knex>;

  constructor(private readonly prisma: PrismaService) {
    this.queryBuilder = knex({ client: 'sqlite3' });
  }

  private async getRowOrderFieldNames(prisma: Prisma.TransactionClient, tableId: string) {
    // get rowIndexFieldName by select all views, combine field prefix and ids;
    const views = await prisma.view.findMany({
      where: {
        tableId,
      },
      select: {
        id: true,
      },
    });

    return views.map((view) => `${ROW_ORDER_FIELD_PREFIX}_${view.id}`);
  }

  // get fields create by users
  private async getUserFields(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createRecordsDto: CreateRecordsDto
  ) {
    const fieldIdSet = createRecordsDto.records.reduce<Set<string>>((acc, record) => {
      const fieldIds = Object.keys(record.fields);
      fieldIds.forEach((fieldId) => acc.add(fieldId));
      return acc;
    }, new Set());

    const userFieldIds = Array.from(fieldIdSet);

    const userFields = await prisma.field.findMany({
      where: {
        tableId,
        id: { in: userFieldIds },
      },
      select: {
        id: true,
        dbFieldName: true,
      },
    });

    console.log('userFields: ', userFields, userFieldIds);
    if (userFields.length !== userFieldIds.length) {
      throw new HttpException('some fields not found', 400);
    }

    return userFields;
  }

  async getRowCount(prisma: Prisma.TransactionClient, dbTableName: string) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const queryResult = await prisma.$queryRawUnsafe<[{ 'MAX(__auto_number)': null | bigint }]>(`
    SELECT MAX(__auto_number)
    FROM ${dbTableName};
    `);
    return Number(queryResult[0]['MAX(__auto_number)']);
  }

  async getDbValueMatrix(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    userFields: IUserFields,
    rowIndexFieldNames: string[],
    createRecordsDto: CreateRecordsDto
  ) {
    const rowCount = await this.getRowCount(prisma, dbTableName);
    const dbValueMatrix: unknown[][] = [];
    for (let i = 0; i < createRecordsDto.records.length; i++) {
      const recordData = createRecordsDto.records[i].fields;
      // 1. collect cellValues
      const recordValues = userFields.map<unknown>((field) => {
        const cellValue = recordData[field.id];
        if (cellValue == null) {
          return null;
        }
        return cellValue;
      });

      // 2. generate rowIndexValues
      const rowIndexValues = rowIndexFieldNames.map(() => rowCount + i);

      // 3. generate id, __row_default, created_time, created_by, version
      const systemValues = [generateRecordId(), rowCount + i, new Date().getTime(), 'admin', 1];

      dbValueMatrix.push([...recordValues, ...rowIndexValues, ...systemValues]);
    }
    return dbValueMatrix;
  }

  async multipleCreateRecordTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createRecordsDto: CreateRecordsDto
  ) {
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const userFields = await this.getUserFields(prisma, tableId, createRecordsDto);
    const rowOrderFieldNames = await this.getRowOrderFieldNames(prisma, tableId);

    const allDbFieldNames = [
      ...userFields.map((field) => field.dbFieldName),
      ...rowOrderFieldNames,
      ...['__id', '__row_default', '__created_time', '__created_by', '__version'],
    ];

    console.log('allDbFieldNames: ', allDbFieldNames);

    const dbValueMatrix = await this.getDbValueMatrix(
      prisma,
      dbTableName,
      userFields,
      rowOrderFieldNames,
      createRecordsDto
    );

    const dbFieldSQL = allDbFieldNames.join(', ');
    const dbValuesSQL = dbValueMatrix
      .map((dbValues) => `(${dbValues.map((value) => JSON.stringify(value)).join(', ')})`)
      .join(',\n');

    console.log('allDbFieldNames: ', allDbFieldNames);
    console.log('dbFieldSQL: ', dbFieldSQL);
    console.log('dbValueMatrix: ', dbValueMatrix);
    console.log('dbValuesSQL: ', dbValuesSQL);

    const result = await prisma.$executeRawUnsafe(`
      INSERT INTO ${dbTableName} (${dbFieldSQL})
      VALUES 
        ${dbValuesSQL};
    `);

    console.log('sqlExecuteResult: ', result);

    return result;
  }

  // we have to support multiple action, because users will do it in batch
  async multipleCreateRecords(tableId: string, createRecordsDto: CreateRecordsDto) {
    return await this.prisma.$transaction(async (prisma) => {
      return this.multipleCreateRecordTransaction(prisma, tableId, createRecordsDto);
    });
  }

  async getDbTableName(prisma: Prisma.TransactionClient, tableId: string) {
    const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  async buildQuery(prisma: Prisma.TransactionClient, tableId: string, query: ISnapshotQuery) {
    const { viewId, where = {}, orderBy = [], offset = 0, limit = 10, idOnly } = query;

    const dbTableName = await this.getDbTableName(prisma, tableId);
    const orderFieldName = getViewOrderFieldName(viewId);
    const sqlNative = this.queryBuilder(dbTableName)
      .where(where)
      .select(idOnly ? '__id' : '*')
      .orderBy(orderFieldName, 'asc')
      .orderBy(orderBy)
      .offset(offset)
      .limit(limit)
      .toSQL()
      .toNative();

    console.log('sqlNative: ', sqlNative);
    return sqlNative;
  }

  async getRecords(tableId: string, query: RecordsRo): Promise<RecordsVo> {
    let viewId = query.viewId;
    if (!viewId) {
      const defaultView = await this.prisma.view.findFirstOrThrow({
        where: { tableId },
        select: { id: true },
      });
      viewId = defaultView.id;
    }

    const sqlNative = await this.buildQuery(this.prisma, tableId, {
      viewId,
      offset: query.skip,
      limit: query.take,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = await this.prisma.$queryRawUnsafe<any[]>(sqlNative.sql, ...sqlNative.bindings);
    const dbTableName = await this.getDbTableName(this.prisma, tableId);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const countQuery = await this.prisma.$queryRawUnsafe<{ 'COUNT(*)': bigint }[]>(
      `SELECT COUNT(*) FROM ${dbTableName}`
    );
    const total = Number(countQuery[0]['COUNT(*)']);

    return {
      records,
      total,
    };
  }
}
