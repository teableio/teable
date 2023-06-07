import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  IAggregateQueryResult,
  IAttachment,
  IAttachmentCellValue,
  IRecordSnapshot,
  IRecordSnapshotQuery,
  ISetRecordOpContext,
  ISetRecordOrderOpContext,
  ISnapshotBase,
} from '@teable-group/core';
import { FieldType, FieldKeyType, OpName, generateRecordId, IdPrefix } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { keyBy } from 'lodash';
import { getViewOrderFieldName } from '../../../src/utils/view-order-field-name';
import { PrismaService } from '../../prisma.service';
import type { IAdapterService } from '../../share-db/interface';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import type { IVisualTableDefaultField } from '../field/constant';
import { preservedFieldName } from '../field/constant';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import type { CreateRecordsRo } from './create-records.ro';
import type { RecordsVo, RecordVo } from './open-api/record.vo';
import type { RecordsRo } from './open-api/records.ro';

type IUserFields = { id: string; dbFieldName: string }[];

@Injectable()
export class RecordService implements IAdapterService {
  private readonly knex = knex({ client: 'sqlite3' });

  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentService: AttachmentsTableService
  ) {}

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
    const sqlNative = this.knex(dbTableName).max('__auto_number').toSQL().toNative();
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
    const sqlNative = this.knex(dbTableName)
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
    const sqlNative = this.knex(dbTableName)
      .update({ [getViewOrderFieldName(viewId)]: order, __version: version })
      .where({ __id: recordId })
      .toSQL()
      .toNative();
    return await prisma.$executeRawUnsafe(sqlNative.sql, ...sqlNative.bindings);
  }

  async setRecord(
    prisma: Prisma.TransactionClient,
    version: number,
    tableId: string,
    dbTableName: string,
    recordId: string,
    contexts: { fieldId: string; newValue: unknown }[]
  ) {
    const fieldIds = Array.from(
      contexts.reduce((acc, cur) => {
        return acc.add(cur.fieldId);
      }, new Set<string>())
    );

    const fieldRaws = await prisma.field.findMany({
      where: { tableId, id: { in: fieldIds } },
    });
    const fieldInstances = fieldRaws.map((field) => createFieldInstanceByRaw(field));
    const fieldInstanceMap = keyBy(fieldInstances, 'id');

    const createAttachmentsTable = this.getCreateAttachments(fieldInstanceMap, contexts);

    await this.attachmentService.updateByRecord(prisma, tableId, recordId, createAttachmentsTable);

    const recordFieldsByDbFieldName = contexts.reduce<{ [dbFieldName: string]: unknown }>(
      (pre, ctx) => {
        const fieldInstance = fieldInstanceMap[ctx.fieldId];
        pre[fieldInstance.dbFieldName] = fieldInstance.convertCellValue2DBValue(ctx.newValue);
        return pre;
      },
      {}
    );

    const sqlNative = this.knex(dbTableName)
      .update({ ...recordFieldsByDbFieldName, __version: version })
      .where({ __id: recordId })
      .toSQL()
      .toNative();
    return await prisma.$executeRawUnsafe(sqlNative.sql, ...sqlNative.bindings);
  }

  getCreateAttachments(
    fieldMap: { [key: string]: { id: string; dbFieldName: string; type: string } },
    contexts: { fieldId: string; newValue: unknown }[]
  ) {
    return contexts.reduce<
      { attachmentId: string; name: string; token: string; fieldId: string }[]
    >((pre, ctx) => {
      const { type } = fieldMap[ctx.fieldId];

      if (type === FieldType.Attachment && Array.isArray(ctx.newValue)) {
        (ctx.newValue as IAttachmentCellValue).forEach((attachment) => {
          const { name, token, id } = attachment;
          pre.push({
            name,
            token,
            fieldId: ctx.fieldId,
            attachmentId: id,
          });
        });
      }

      return pre;
    }, []);
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

  async getRecord(
    tableId: string,
    recordId: string,
    fieldKey = FieldKeyType.Name
  ): Promise<RecordVo> {
    const recordSnapshot = await this.getSnapshotBulk(
      this.prismaService,
      tableId,
      [recordId],
      undefined,
      fieldKey
    );

    if (!recordSnapshot.length) {
      throw new HttpException('Can not get record', HttpStatus.NOT_FOUND);
    }

    return recordSnapshot[0].data;
  }

  async getRecordIdByIndex(
    prisma: Prisma.TransactionClient,
    tableId: string,
    viewId: string,
    index: number
  ) {
    const dbTableName = await this.getDbTableName(prisma, tableId);
    const sqlNative = this.knex(dbTableName)
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

    const nativeSql = this.knex(dbTableName)
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
    const fields = await prisma.field.findMany({
      where: { tableId },
      select: { id: true, type: true },
    });
    const attachmentFields = fields.filter((field) => field.type === FieldType.Attachment);

    await this.attachmentService.delete(
      prisma,
      attachmentFields.map(({ id }) => ({ tableId, recordId, fieldId: id }))
    );

    const nativeSql = this.knex(dbTableName)
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
        tableId,
        dbTableName,
        recordId,
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

  private async getFieldsByProjection(
    prisma: Prisma.TransactionClient,
    tableId: string,
    projection?: { [fieldKey: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id
  ) {
    const whereParams: { name?: { in: string[] }; id?: { in: string[] } } = {};
    if (projection) {
      const projectionFieldKeys = Object.entries(projection)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (projectionFieldKeys.length) {
        fieldKeyType === FieldKeyType.Id
          ? (whereParams.id = { in: projectionFieldKeys })
          : (whereParams.name = { in: projectionFieldKeys });
      }
    }

    const fieldIds = (
      await prisma.field.findMany({
        where: { tableId, deletedTime: null, ...whereParams },
        select: { id: true },
      })
    ).map((f) => f.id);

    const fieldRaws = await prisma.field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    return fieldRaws.map((field) => createFieldInstanceByRaw(field));
  }

  async getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    recordIds: string[],
    projection?: { [fieldKey: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id // for convince of collaboration, getSnapshotBulk use id as field key by default.
  ): Promise<ISnapshotBase<IRecordSnapshot>[]> {
    const dbTableName = await this.getDbTableName(prisma, tableId);

    const allViews = await prisma.view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });
    const fieldNameOfViewOrder = allViews.map((view) => getViewOrderFieldName(view.id));

    const fields = await this.getFieldsByProjection(prisma, tableId, projection, fieldKeyType);
    const fieldMap = keyBy(fields, fieldKeyType === FieldKeyType.Name ? 'name' : 'id');
    const fieldNames = fields
      .map((f) => f.dbFieldName)
      .concat([...preservedFieldName, ...fieldNameOfViewOrder]);

    const sqlNative = this.knex(dbTableName)
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
          const dbCellValue = record[field.dbFieldName];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cellValue = fieldMap[fieldKey].convertDBValue2CellValue(dbCellValue as any);
          if (cellValue != null) {
            acc[fieldKey] = cellValue;
          }
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

  async getAttachmentMaps(prisma: Prisma.TransactionClient, tableId: string, recordIds: string[]) {
    const attachments = await this.attachmentService.getAttachmentTableCellValueByRecordIds(
      prisma,
      { tableId, recordIds }
    );

    return attachments.reduce<{ [key: string]: IAttachment }>(
      (acc, { id, fieldId, recordId, ...reset }) => {
        acc[`${id}-${recordId}-${fieldId}`] = { id, ...reset };
        return acc;
      },
      {}
    );
  }

  transformAttachmentCellValue(
    cellValue: string[] | null,
    attachmentsMap: { [key: string]: IAttachment }
  ) {
    if (!cellValue) {
      return null;
    }
    return cellValue.map((atc) => attachmentsMap[atc]).filter(Boolean);
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
