import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  IAttachmentCellValue,
  ICreateRecordsRo,
  IExtraResult,
  IGetRecordsQuery,
  IMakeRequired,
  IRecord,
  IRecordsVo,
  ISetRecordOpContext,
  ISetRecordOrderOpContext,
  ISnapshotBase,
} from '@teable-group/core';
import {
  FieldKeyType,
  FieldType,
  generateRecordId,
  identify,
  IdPrefix,
  mergeWithDefaultFilter,
  mergeWithDefaultSort,
  OpName,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { getViewOrderFieldName } from '../..//utils/view-order-field-name';
import type { IAdapterService } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import type { IVisualTableDefaultField } from '../field/constant';
import { preservedFieldName } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { FilterQueryTranslator } from './translator/filter-query-translator';
import { SortQueryTranslator } from './translator/sort-query-translator';

type IUserFields = { id: string; dbFieldName: string }[];

@Injectable()
export class RecordService implements IAdapterService {
  private logger = new Logger(RecordService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentService: AttachmentsTableService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel() private readonly knex: Knex
  ) {}

  private async getRowOrderFieldNames(tableId: string) {
    // get rowIndexFieldName by select all views, combine field prefix and ids;
    const views = await this.prismaService.txClient().view.findMany({
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
  private async getUserFields(tableId: string, createRecordsRo: ICreateRecordsRo) {
    const fieldIdSet = createRecordsRo.records.reduce<Set<string>>((acc, record) => {
      const fieldIds = Object.keys(record.fields);
      fieldIds.forEach((fieldId) => acc.add(fieldId));
      return acc;
    }, new Set());

    const userFieldIds = Array.from(fieldIdSet);

    const userFields = await this.prismaService.txClient().field.findMany({
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
      throw new BadRequestException('some fields not found');
    }

    return userFields;
  }

  private dbRecord2RecordFields(
    record: IRecord['fields'],
    fields: IFieldInstance[],
    fieldMap: Record<string, IFieldInstance>,
    fieldKeyType?: FieldKeyType
  ) {
    return fields.reduce<IRecord['fields']>((acc, field) => {
      const fieldNameOrId = fieldKeyType === FieldKeyType.Name ? field.name : field.id;
      const dbCellValue = record[field.dbFieldName];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cellValue = fieldMap[fieldNameOrId].convertDBValue2CellValue(dbCellValue as any);
      if (cellValue != null) {
        acc[fieldNameOrId] = cellValue;
      }
      return acc;
    }, {});
  }

  async getAllRecordCount(dbTableName: string) {
    const sqlNative = this.knex(dbTableName).count({ count: '*' }).toSQL().toNative();

    const queryResult = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ count?: number }[]>(sqlNative.sql, ...sqlNative.bindings);
    return Number(queryResult[0]?.count ?? 0);
  }

  async getDbValueMatrix(
    dbTableName: string,
    userFields: IUserFields,
    rowIndexFieldNames: string[],
    createRecordsRo: ICreateRecordsRo
  ) {
    const rowCount = await this.getAllRecordCount(dbTableName);
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
      const systemValues = [generateRecordId(), rowCount + i, new Date().toISOString(), 'admin', 1];

      dbValueMatrix.push([...recordValues, ...rowIndexValues, ...systemValues]);
    }
    return dbValueMatrix;
  }

  async multipleCreateRecordTransaction(tableId: string, createRecordsRo: ICreateRecordsRo) {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const userFields = await this.getUserFields(tableId, createRecordsRo);
    const rowOrderFieldNames = await this.getRowOrderFieldNames(tableId);

    const allDbFieldNames = [
      ...userFields.map((field) => field.dbFieldName),
      ...rowOrderFieldNames,
      ...['__id', '__row_default', '__created_time', '__created_by', '__version'],
    ];

    const dbValueMatrix = await this.getDbValueMatrix(
      dbTableName,
      userFields,
      rowOrderFieldNames,
      createRecordsRo
    );

    const dbFieldSQL = allDbFieldNames.join(', ');
    const dbValuesSQL = dbValueMatrix
      .map((dbValues) => `(${dbValues.map((value) => JSON.stringify(value)).join(', ')})`)
      .join(',\n');

    return await this.prismaService.txClient().$executeRawUnsafe(`
      INSERT INTO ${dbTableName} (${dbFieldSQL})
      VALUES 
        ${dbValuesSQL};
    `);
  }

  // we have to support multiple action, because users will do it in batch
  async multipleCreateRecords(tableId: string, createRecordsRo: ICreateRecordsRo) {
    return await this.prismaService.$tx(async () => {
      return this.multipleCreateRecordTransaction(tableId, createRecordsRo);
    });
  }

  async getDbTableName(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  async buildQuery(
    tableId: string,
    query: IGetRecordsQuery & {
      select?: string | string[];
      viewId: string;
    }
  ) {
    const {
      viewId,
      orderBy: extraOrderBy,
      skip = 0,
      take = 10,
      select,
      filter: extraFilter,
    } = query;

    const view = await this.prismaService.txClient().view.findFirstOrThrow({
      select: { id: true, filter: true, sort: true },
      where: { tableId, id: viewId, deletedTime: null },
      orderBy: { order: 'asc' },
    });

    const filter = mergeWithDefaultFilter(view.filter, extraFilter);
    const orderBy = mergeWithDefaultSort(view.sort, extraOrderBy);

    const dbTableName = await this.getDbTableName(tableId);
    const orderFieldName = getViewOrderFieldName(viewId);

    const queryBuilder = select ? this.knex(dbTableName).select(select) : this.knex(dbTableName);

    let fieldMap;
    if (filter || orderBy.length) {
      // The field Meta is needed to construct the filter if it exists
      const fields = await this.getFieldsByProjection(tableId);
      fieldMap = fields.reduce((map, field) => {
        map[field.id] = field;
        map[field.name] = field;
        return map;
      }, {} as Record<string, IFieldInstance>);
    }

    // All `where` condition-related construction work
    const filterQueryTranslator = new FilterQueryTranslator(queryBuilder, fieldMap, filter);
    const translatedOrderby = SortQueryTranslator.translateToOrderQuery(orderBy, fieldMap);

    filterQueryTranslator
      .translateToSql()
      .orderBy(translatedOrderby)
      .orderBy(orderFieldName, 'asc')
      .offset(skip)
      .limit(take);

    return { queryBuilder };
  }

  async setRecordOrder(
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
    return this.prismaService.txClient().$executeRawUnsafe(sqlNative.sql, ...sqlNative.bindings);
  }

  async setRecord(
    version: number,
    tableId: string,
    dbTableName: string,
    recordId: string,
    contexts: { fieldId: string; newValue: unknown }[]
  ) {
    const userId = this.cls.get('user.id');

    const fieldIds = Array.from(
      contexts.reduce((acc, cur) => {
        return acc.add(cur.fieldId);
      }, new Set<string>())
    );

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: fieldIds } },
    });
    const fieldInstances = fieldRaws.map((field) => createFieldInstanceByRaw(field));
    const fieldInstanceMap = keyBy(fieldInstances, 'id');

    const createAttachmentsTable = this.getCreateAttachments(fieldInstanceMap, contexts);

    if (createAttachmentsTable.length) {
      await this.attachmentService.updateByRecord(tableId, recordId, createAttachmentsTable);
    }

    const recordFieldsByDbFieldName = contexts.reduce<{ [dbFieldName: string]: unknown }>(
      (pre, ctx) => {
        const fieldInstance = fieldInstanceMap[ctx.fieldId];
        pre[fieldInstance.dbFieldName] = fieldInstance.convertCellValue2DBValue(ctx.newValue);
        return pre;
      },
      {}
    );

    const updateRecordSql = this.knex(dbTableName)
      .update({ ...recordFieldsByDbFieldName, __last_modified_by: userId, __version: version })
      .where({ __id: recordId })
      .toQuery();
    return this.prismaService.txClient().$executeRawUnsafe(updateRecordSql);
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
        (ctx.newValue as IAttachmentCellValue)?.forEach((attachment) => {
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

  async getRowCount(
    tableId: string,
    _viewId: string,
    filterQueryBuilder?: Knex.QueryBuilder
  ): Promise<number> {
    if (filterQueryBuilder) {
      filterQueryBuilder
        .clearSelect()
        .clearCounters()
        .clearGroup()
        .clearHaving()
        .clearOrder()
        .clear('limit')
        .clear('offset');
      const sqlNative = filterQueryBuilder.count({ count: '*' }).toSQL().toNative();

      const result = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ count?: number }[]>(sqlNative.sql, ...sqlNative.bindings);
      return Number(result[0]?.count ?? 0);
    }

    const dbTableName = await this.getDbTableName(tableId);
    return await this.getAllRecordCount(dbTableName);
  }

  async getRecords(tableId: string, query: IGetRecordsQuery): Promise<IRecordsVo> {
    const defaultView = await this.prismaService.txClient().view.findFirstOrThrow({
      select: { id: true, filter: true, sort: true },
      where: {
        tableId,
        ...(query.viewId ? { id: query.viewId } : {}),
        deletedTime: null,
      },
      orderBy: { order: 'asc' },
    });
    const viewId = defaultView.id;

    const queryResult = await this.getDocIdsByQuery(tableId, {
      viewId,
      skip: query.skip,
      take: query.take,
      filter: query.filter,
      orderBy: query.orderBy,
    });

    const recordSnapshot = await this.getSnapshotBulk(
      tableId,
      queryResult.ids,
      undefined,
      query.fieldKeyType || FieldKeyType.Name
    );
    return {
      records: recordSnapshot.map((r) => r.data),
    };
  }

  async getRecord(
    tableId: string,
    recordId: string,
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType = FieldKeyType.Name
  ): Promise<IRecord> {
    const recordSnapshot = await this.getSnapshotBulk(
      tableId,
      [recordId],
      projection,
      fieldKeyType
    );

    if (!recordSnapshot.length) {
      throw new NotFoundException('Can not get record');
    }

    return recordSnapshot[0].data;
  }

  async getCellValue(tableId: string, recordId: string, fieldId: string) {
    const record = await this.getRecord(tableId, recordId, { [fieldId]: true }, FieldKeyType.Id);
    return record.fields[fieldId];
  }

  async getRecordIdByIndex(tableId: string, viewId: string, index: number) {
    const dbTableName = await this.getDbTableName(tableId);
    const sqlNative = this.knex(dbTableName)
      .select('__id')
      .orderBy(getViewOrderFieldName(viewId), 'asc')
      .offset(index)
      .limit(1)
      .toSQL()
      .toNative();
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(sqlNative.sql, ...sqlNative.bindings);
    return result[0].__id;
  }

  async create(tableId: string, snapshot: IRecord) {
    const userId = this.cls.get('user.id');
    const dbTableName = await this.getDbTableName(tableId);

    // TODO: get row count will causes performance issus when insert lot of records
    const rowCount = await this.getAllRecordCount(dbTableName);
    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });

    const orders = views.reduce<{ [viewId: string]: number }>((pre, cur) => {
      const viewOrderFieldName = getViewOrderFieldName(cur.id);
      if (snapshot.recordOrder[cur.id] !== undefined) {
        pre[viewOrderFieldName] = snapshot.recordOrder[cur.id];
      } else {
        pre[viewOrderFieldName] = rowCount;
      }
      return pre;
    }, {});

    const nativeSql = this.knex(dbTableName)
      .insert({
        __id: snapshot.id,
        __row_default: rowCount,
        __created_by: userId,
        __last_modified_by: userId,
        __version: 1,
        ...orders,
      })
      .toSQL()
      .toNative();

    await this.prismaService.txClient().$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
  }

  async del(tableId: string, recordId: string) {
    const dbTableName = await this.getDbTableName(tableId);
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId },
      select: { id: true, type: true },
    });
    const attachmentFields = fields.filter((field) => field.type === FieldType.Attachment);

    await this.attachmentService.delete(
      attachmentFields.map(({ id }) => ({ tableId, recordId, fieldId: id }))
    );

    const nativeSql = this.knex(dbTableName)
      .where({
        __id: recordId,
      })
      .del()
      .toSQL()
      .toNative();

    await this.prismaService.txClient().$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
  }

  async update(
    version: number,
    tableId: string,
    recordId: string,
    opContexts: (ISetRecordOrderOpContext | ISetRecordOpContext)[]
  ) {
    const dbTableName = await this.getDbTableName(tableId);
    if (opContexts[0].name === OpName.SetRecord) {
      await this.setRecord(
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
        await this.setRecordOrder(version, recordId, dbTableName, viewId, newOrder);
      }
    }
  }

  private async getFieldsByProjection(
    tableId: string,
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id
  ) {
    const whereParams: Prisma.FieldWhereInput = {};
    if (projection) {
      const projectionFieldKeys = Object.entries(projection)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (projectionFieldKeys.length) {
        const key = fieldKeyType === FieldKeyType.Id ? 'id' : 'name';
        whereParams[key] = { in: projectionFieldKeys };
      }
    }

    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId, ...whereParams, deletedTime: null },
    });

    return fields.map((field) => createFieldInstanceByRaw(field));
  }

  async getSnapshotBulk(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id // for convince of collaboration, getSnapshotBulk use id as field key by default.
  ): Promise<ISnapshotBase<IRecord>[]> {
    const dbTableName = await this.getDbTableName(tableId);

    const allViews = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });
    const fieldNameOfViewOrder = allViews.map((view) => getViewOrderFieldName(view.id));

    const fields = await this.getFieldsByProjection(tableId, projection, fieldKeyType);
    const fieldMap = keyBy(fields, fieldKeyType === FieldKeyType.Name ? 'name' : 'id');
    const fieldNames = fields
      .map((f) => f.dbFieldName)
      .concat([...preservedFieldName, ...fieldNameOfViewOrder]);

    const sqlNative = this.knex(dbTableName)
      .select(fieldNames)
      .whereIn('__id', recordIds)
      .toSQL()
      .toNative();
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<({ [fieldName: string]: unknown } & IVisualTableDefaultField)[]>(
        sqlNative.sql,
        ...sqlNative.bindings
      );

    const recordIdsMap = recordIds.reduce((acc, recordId, currentIndex) => {
      acc[recordId] = currentIndex;
      return acc;
    }, {} as { [recordId: string]: number });

    return result
      .sort((a, b) => {
        return recordIdsMap[a.__id] - recordIdsMap[b.__id];
      })
      .map((record) => {
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
            fields: this.dbRecord2RecordFields(record, fields, fieldMap, fieldKeyType),
            id: record.__id,
            createdTime: record.__created_time?.toISOString(),
            lastModifiedTime: record.__last_modified_time?.toISOString(),
            createdBy: record.__created_by,
            lastModifiedBy: record.__last_modified_by,
            recordOrder,
          },
        };
      });
  }

  async getDocIdsByQuery(
    tableId: string,
    query: IGetRecordsQuery
  ): Promise<{ ids: string[]; extra?: IExtraResult }> {
    const { id: viewId } = await this.prismaService.txClient().view.findFirstOrThrow({
      select: { id: true },
      where: { tableId, ...(query.viewId ? { id: query.viewId } : {}), deletedTime: null },
      orderBy: { order: 'asc' },
    });

    const { take = 100 } = query;
    if (identify(tableId) !== IdPrefix.Table) {
      throw new InternalServerErrorException('query collection must be table id');
    }

    if (take > 1000) {
      throw new BadRequestException(`limit can't be greater than ${take}`);
    }

    // If you return `queryBuilder` directly and use `await` to receive it,
    // it will perform a query DB operation, which we obviously don't want to see here
    const { queryBuilder } = await this.buildQuery(tableId, {
      ...query,
      select: '__id',
      viewId,
    });

    const sqlNative = queryBuilder.toSQL().toNative();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(sqlNative.sql, ...sqlNative.bindings);
    const ids = result.map((r) => r.__id);
    return { ids };
  }

  async getRecordsFields(
    tableId: string,
    query: IMakeRequired<IGetRecordsQuery, 'viewId'>
  ): Promise<Pick<IRecord, 'id' | 'fields'>[]> {
    if (identify(tableId) !== IdPrefix.Table) {
      throw new InternalServerErrorException('query collection must be table id');
    }

    const { skip, take, filter, orderBy, fieldKeyType, projection, viewId } = query;

    const fields = await this.getFieldsByProjection(tableId, projection, fieldKeyType);
    const fieldMap = keyBy(fields, fieldKeyType === FieldKeyType.Name ? 'name' : 'id');
    const fieldNames = fields.map((f) => f.dbFieldName);

    const { queryBuilder } = await this.buildQuery(tableId, {
      viewId: viewId,
      skip,
      take,
      filter,
      orderBy,
      select: fieldNames.concat('__id'),
    });
    const sqlNative = queryBuilder.toSQL().toNative();
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<(Pick<IRecord, 'id' | 'fields'> & Pick<IVisualTableDefaultField, '__id'>)[]>(
        sqlNative.sql,
        ...sqlNative.bindings
      );

    return result.map((record) => {
      return {
        id: record.__id,
        fields: this.dbRecord2RecordFields(record, fields, fieldMap, fieldKeyType),
      };
    });
  }
}
