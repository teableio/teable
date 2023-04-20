import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  IAggregateQueryResult,
  IRecordSnapshot,
  IRecordSnapshotQuery,
  ISetRecordOpContext,
  ISetRecordOrderOpContext,
  ISnapshotBase,
} from '@teable-group/core';
import { FieldKeyType, OpName, generateRecordId, IdPrefix } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { keyBy } from 'lodash';
import { getViewOrderFieldName } from '../../../src/utils/view-order-field-name';
import { PrismaService } from '../../prisma.service';
import type { AdapterService } from '../../share-db/adapter-service.abstract';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import type { CreateRecordsRo } from './create-records.ro';
import type { RecordsVo } from './open-api/record.vo';
import type { RecordsRo } from './open-api/records.ro';

type IUserFields = { id: string; dbFieldName: string }[];

/* eslint-disable @typescript-eslint/naming-convention */
export interface IVisualTableDefaultField {
  __id: string;
  __version: number;
  __auto_number: number;
  __created_time: Date;
  __last_modified_time?: Date;
  __created_by: string;
  __last_modified_by?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

@Injectable()
export class RecordService implements AdapterService {
  queryBuilder: ReturnType<typeof knex>;

  constructor(private readonly prismaService: PrismaService) {
    this.queryBuilder = knex({ client: 'sqlite3' });
  }

  private async getRowOrderFieldNames(prisma: Prisma.TransactionClient, tableId: string) {
    // get rowIndexFieldName by select all views, combine field prefix and ids;
    const views = await prisma.view.findMany({
      where: {
        tableId,
        deletedTime: null,
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
    createRecordsRo: CreateRecordsRo
  ) {
    const fieldIdSet = createRecordsRo.records.reduce<Set<string>>((acc, record) => {
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

    if (userFields.length !== userFieldIds.length) {
      throw new HttpException('some fields not found', 400);
    }

    return userFields;
  }

  async getAllRecordCount(prisma: Prisma.TransactionClient, dbTableName: string) {
    const sqlNative = this.queryBuilder(dbTableName).max('__auto_number').toSQL().toNative();
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const queryResult = await prisma.$queryRawUnsafe<[{ 'max(`__auto_number`)': null | bigint }]>(
      sqlNative.sql,
      ...sqlNative.bindings
    );

    return Number(queryResult[0]['max(`__auto_number`)']);
  }

  async getDbValueMatrix(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    userFields: IUserFields,
    rowIndexFieldNames: string[],
    createRecordsRo: CreateRecordsRo
  ) {
    const rowCount = await this.getAllRecordCount(prisma, dbTableName);
    const dbValueMatrix: unknown[][] = [];
    for (let i = 0; i < createRecordsRo.records.length; i++) {
      const recordData = createRecordsRo.records[i].fields;
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

      // 3. generate id, __row_default, __created_time, __created_by, __version
      const systemValues = [generateRecordId(), rowCount + i, new Date().getTime(), 'admin', 1];

      dbValueMatrix.push([...recordValues, ...rowIndexValues, ...systemValues]);
    }
    return dbValueMatrix;
  }

  async multipleCreateRecordTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createRecordsRo: CreateRecordsRo
  ) {
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const userFields = await this.getUserFields(prisma, tableId, createRecordsRo);
    const rowOrderFieldNames = await this.getRowOrderFieldNames(prisma, tableId);

    const allDbFieldNames = [
      ...userFields.map((field) => field.dbFieldName),
      ...rowOrderFieldNames,
      ...['__id', '__row_default', '__created_time', '__created_by', '__version'],
    ];

    const dbValueMatrix = await this.getDbValueMatrix(
      prisma,
      dbTableName,
      userFields,
      rowOrderFieldNames,
      createRecordsRo
    );

    const dbFieldSQL = allDbFieldNames.join(', ');
    const dbValuesSQL = dbValueMatrix
      .map((dbValues) => `(${dbValues.map((value) => JSON.stringify(value)).join(', ')})`)
      .join(',\n');

    // console.log('allDbFieldNames: ', allDbFieldNames);
    // console.log('dbFieldSQL: ', dbFieldSQL);
    // console.log('dbValueMatrix: ', dbValueMatrix);
    // console.log('dbValuesSQL: ', dbValuesSQL);

    const result = await prisma.$executeRawUnsafe(`
      INSERT INTO ${dbTableName} (${dbFieldSQL})
      VALUES 
        ${dbValuesSQL};
    `);

    console.log('sqlExecuteResult: ', result);

    return result;
  }

  // we have to support multiple action, because users will do it in batch
  async multipleCreateRecords(tableId: string, createRecordsRo: CreateRecordsRo) {
    return await this.prismaService.$transaction(async (prisma) => {
      return this.multipleCreateRecordTransaction(prisma, tableId, createRecordsRo);
    });
  }

  async getDbTableName(prisma: Prisma.TransactionClient, tableId: string) {
    const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  async buildQuery(
    prisma: Prisma.TransactionClient,
    tableId: string,
    query: IRecordSnapshotQuery & { idOnly?: boolean; viewId: string }
  ) {
    const { viewId, where = {}, orderBy = [], offset = 0, limit = 10, idOnly } = query;

    const dbTableName = await this.getDbTableName(prisma, tableId);
    const orderFieldName = getViewOrderFieldName(viewId);
    const sqlNative = this.queryBuilder(dbTableName)
      .where(where)
      .select(idOnly ? '__id' : '*')
      .orderBy(orderBy)
      .orderBy(orderFieldName, 'asc')
      .offset(offset)
      .limit(limit)
      .toSQL()
      .toNative();

    console.log('sqlNative: ', sqlNative);
    return sqlNative;
  }

  async setRecordOrder(
    prisma: Prisma.TransactionClient,
    version: number,
    recordId: string,
    dbTableName: string,
    viewId: string,
    order: number
  ) {
    const sqlNative = this.queryBuilder(dbTableName)
      .update({ [getViewOrderFieldName(viewId)]: order, __version: version })
      .where({ __id: recordId })
      .toSQL()
      .toNative();
    return await prisma.$executeRawUnsafe(sqlNative.sql, ...sqlNative.bindings);
  }

  async setRecord(
    prisma: Prisma.TransactionClient,
    version: number,
    recordId: string,
    dbTableName: string,
    contexts: { fieldId: string; newValue: unknown }[]
  ) {
    const fieldIdsSet = contexts.reduce((acc, cur) => {
      return acc.add(cur.fieldId);
    }, new Set<string>());

    const fields = await prisma.field.findMany({
      where: { id: { in: Array.from(fieldIdsSet) } },
      select: { id: true, dbFieldName: true },
    });
    const fieldMap = keyBy(fields, 'id');

    const fieldsByDbFieldName = contexts.reduce<{ [dbFieldName: string]: unknown }>((pre, ctx) => {
      pre[fieldMap[ctx.fieldId].dbFieldName] = ctx.newValue;
      return pre;
    }, {});

    const sqlNative = this.queryBuilder(dbTableName)
      .update({ ...fieldsByDbFieldName, __version: version })
      .where({ __id: recordId })
      .toSQL()
      .toNative();
    return await prisma.$executeRawUnsafe(sqlNative.sql, ...sqlNative.bindings);
  }

  async getRowCount(prisma: Prisma.TransactionClient, tableId: string, _viewId: string) {
    const dbTableName = await this.getDbTableName(prisma, tableId);
    return await this.getAllRecordCount(prisma, dbTableName);
  }

  async getRecords(tableId: string, query: RecordsRo): Promise<RecordsVo> {
    let viewId = query.viewId;
    if (!viewId) {
      const defaultView = await this.prismaService.view.findFirstOrThrow({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
      viewId = defaultView.id;
    }

    const queryResult = await this.getDocIdsByQuery(this.prismaService, tableId, {
      type: IdPrefix.Record,
      viewId,
      offset: query.skip,
      limit: query.take,
      aggregate: {
        rowCount: true,
      },
    });

    const recordSnapshot = await this.getSnapshotBulk(
      this.prismaService,
      tableId,
      queryResult.ids,
      undefined,
      query.fieldKey
    );

    const total = queryResult.extra?.rowCount;

    if (total == undefined) {
      throw new HttpException('Can not get row count', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return {
      records: recordSnapshot.map((r) => r.data.record),
      total,
    };
  }

  async getRecordIdByIndex(
    prisma: Prisma.TransactionClient,
    tableId: string,
    viewId: string,
    index: number
  ) {
    const dbTableName = await this.getDbTableName(prisma, tableId);
    const sqlNative = this.queryBuilder(dbTableName)
      .select('__id')
      .orderBy(getViewOrderFieldName(viewId), 'asc')
      .offset(index)
      .limit(1)
      .toSQL()
      .toNative();
    const result = await prisma.$queryRawUnsafe<{ __id: string }[]>(
      sqlNative.sql,
      ...sqlNative.bindings
    );
    return result[0].__id;
  }

  async create(prisma: Prisma.TransactionClient, tableId: string, snapshot: IRecordSnapshot) {
    const dbTableName = await this.getDbTableName(prisma, tableId);

    // TODO: get row count will causes performance issus when insert lot of records
    const rowCount = await this.getAllRecordCount(prisma, dbTableName);
    const views = await prisma.view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });

    const orders = views.reduce<{ [viewId: string]: number }>((pre, cur) => {
      const viewOrderFieldName = getViewOrderFieldName(cur.id);
      if (snapshot.record.recordOrder[cur.id] !== undefined) {
        pre[viewOrderFieldName] = snapshot.record.recordOrder[cur.id];
      } else {
        pre[viewOrderFieldName] = rowCount;
      }
      return pre;
    }, {});

    const nativeSql = this.queryBuilder(dbTableName)
      .insert({
        __id: snapshot.record.id,
        __row_default: rowCount,
        __created_time: new Date().getTime(),
        __created_by: 'admin',
        __version: 1,
        ...orders,
      })
      .toSQL()
      .toNative();

    await prisma.$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
  }

  async del(prisma: Prisma.TransactionClient, tableId: string, recordId: string) {
    const dbTableName = await this.getDbTableName(prisma, tableId);

    const nativeSql = this.queryBuilder(dbTableName)
      .where({
        __id: recordId,
      })
      .del()
      .toSQL()
      .toNative();

    await prisma.$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
  }

  async update(
    prisma: Prisma.TransactionClient,
    version: number,
    tableId: string,
    recordId: string,
    opContexts: (ISetRecordOrderOpContext | ISetRecordOpContext)[]
  ) {
    const dbTableName = await this.getDbTableName(prisma, tableId);
    if (opContexts[0].name === OpName.SetRecord) {
      await this.setRecord(
        prisma,
        version,
        recordId,
        dbTableName,
        opContexts as ISetRecordOpContext[]
      );
      return;
    }

    if (opContexts[0].name === OpName.SetRecordOrder) {
      for (const opContext of opContexts as ISetRecordOrderOpContext[]) {
        const { viewId, newOrder } = opContext;
        await this.setRecordOrder(prisma, version, recordId, dbTableName, viewId, newOrder);
      }
    }
  }

  async getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    recordIds: string[],
    projection?: { [fieldKey: string]: boolean },
    fieldKeyType?: FieldKeyType
  ): Promise<ISnapshotBase<IRecordSnapshot>[]> {
    const dbTableName = await this.getDbTableName(prisma, tableId);

    const allFields = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, name: true, dbFieldName: true },
    });

    const allViews = await prisma.view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });
    const fieldNameOfViewOrder = allViews.map((view) => getViewOrderFieldName(view.id));

    const fields = projection ? allFields.filter((field) => projection[field.id]) : allFields;
    const fieldNames = fields
      .map((f) => f.dbFieldName)
      .concat([
        '__id',
        '__version',
        '__auto_number',
        '__created_time',
        '__last_modified_time',
        '__created_by',
        '__last_modified_by',
        ...fieldNameOfViewOrder,
      ]);

    const sqlNative = this.queryBuilder(dbTableName)
      .select(fieldNames)
      .whereIn('__id', recordIds)
      .toSQL()
      .toNative();

    const result = await prisma.$queryRawUnsafe<
      ({ [fieldName: string]: unknown } & IVisualTableDefaultField)[]
    >(sqlNative.sql, ...sqlNative.bindings);

    return result
      .sort((a, b) => {
        return recordIds.indexOf(a.__id) - recordIds.indexOf(b.__id);
      })
      .map((record) => {
        const fieldsData = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
          const fieldKey = fieldKeyType === FieldKeyType.Name ? field.name : field.id;
          acc[fieldKey] = record[field.dbFieldName];
          return acc;
        }, {});

        const recordOrder = fieldNameOfViewOrder.reduce<{ [viewId: string]: number }>(
          (acc, vFieldName, index) => {
            acc[allViews[index].id] = record[vFieldName] as number;
            return acc;
          },
          {}
        );

        return {
          id: record.__id,
          v: record.__version,
          type: 'json0',
          data: {
            record: {
              fields: fieldsData,
              id: record.__id,
              createdTime: record.__created_time?.getTime(),
              lastModifiedTime: record.__last_modified_time?.getTime(),
              createdBy: record.__created_by,
              lastModifiedBy: record.__last_modified_by,
              recordOrder,
            },
          },
        };
      });
  }

  async getDocIdsByQuery(
    prisma: Prisma.TransactionClient,
    tableId: string,
    query: IRecordSnapshotQuery
  ): Promise<{ ids: string[]; extra?: IAggregateQueryResult }> {
    let viewId = query.viewId;
    if (!viewId) {
      const view = await prisma.view.findFirstOrThrow({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
      viewId = view.id;
    }

    const { limit = 100 } = query;
    const idPrefix = tableId.slice(0, 3);
    if (idPrefix !== IdPrefix.Table) {
      throw new Error('query collection must be table id');
    }

    if (limit > 1000) {
      throw new Error("limit can't be greater than 1000");
    }

    const sqlNative = await this.buildQuery(prisma, tableId, {
      ...query,
      viewId,
      idOnly: true,
    });

    const result = await prisma.$queryRawUnsafe<{ __id: string }[]>(
      sqlNative.sql,
      ...sqlNative.bindings
    );
    const ids = result.map((r) => r.__id);

    if (query.aggregate?.rowCount) {
      const rowCount = await this.getRowCount(prisma, tableId, viewId);
      return { ids, extra: { rowCount } };
    }

    return { ids };
  }
}
