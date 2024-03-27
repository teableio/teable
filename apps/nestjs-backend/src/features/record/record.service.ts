import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  IAttachmentCellValue,
  IExtraResult,
  IFilter,
  IGroup,
  ILinkCellValue,
  IRecord,
  ISetRecordOpContext,
  IShareViewMeta,
  ISnapshotBase,
  ISortItem,
} from '@teable/core';
import {
  CellFormat,
  FieldKeyType,
  FieldType,
  generateRecordId,
  identify,
  IdPrefix,
  mergeWithDefaultFilter,
  mergeWithDefaultSort,
  OpName,
  parseGroup,
  Relationship,
} from '@teable/core';
import type { Field, Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateRecordsRo, IGetRecordQuery, IGetRecordsRo, IRecordsVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IAdapterService } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { Timing } from '../../utils/timing';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { BatchService } from '../calculation/batch.service';
import type { IVisualTableDefaultField } from '../field/constant';
import { preservedDbFieldNames } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';

type IUserFields = { id: string; dbFieldName: string }[];

@Injectable()
export class RecordService implements IAdapterService {
  private logger = new Logger(RecordService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly batchService: BatchService,
    private readonly attachmentStorageService: AttachmentsStorageService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private dbRecord2RecordFields(
    record: IRecord['fields'],
    fields: IFieldInstance[],
    fieldKeyType?: FieldKeyType,
    cellFormat: CellFormat = CellFormat.Json
  ) {
    return fields.reduce<IRecord['fields']>((acc, field) => {
      const fieldNameOrId = fieldKeyType === FieldKeyType.Name ? field.name : field.id;
      const dbCellValue = record[field.dbFieldName];
      const cellValue = field.convertDBValue2CellValue(dbCellValue);
      if (cellValue != null) {
        acc[fieldNameOrId] =
          cellFormat === CellFormat.Text ? field.cellValue2String(cellValue) : cellValue;
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

      // 3. generate id, __created_time, __created_by, __version
      const systemValues = [generateRecordId(), new Date().toISOString(), 'admin', 1];

      dbValueMatrix.push([...recordValues, ...rowIndexValues, ...systemValues]);
    }
    return dbValueMatrix;
  }

  async getDbTableName(tableId: string) {
    const tableMeta = await this.prismaService
      .txClient()
      .tableMeta.findUniqueOrThrow({
        where: { id: tableId },
        select: { dbTableName: true },
      })
      .catch(() => {
        throw new NotFoundException(`Table ${tableId} not found`);
      });
    return tableMeta.dbTableName;
  }

  private async getLinkCellIds(fieldRaw: Field, recordId: string) {
    const prisma = this.prismaService.txClient();
    const dbTableName = await prisma.tableMeta.findFirstOrThrow({
      where: { id: fieldRaw.tableId },
      select: { dbTableName: true },
    });
    const linkCellQuery = this.knex(dbTableName)
      .select({
        id: '__id',
        linkField: fieldRaw.dbFieldName,
      })
      .where('__id', recordId)
      .toQuery();
    const field = createFieldInstanceByRaw(fieldRaw);
    const result = await prisma.$queryRawUnsafe<
      {
        id: string;
        linkField: string | null;
      }[]
    >(linkCellQuery);
    return result
      .map(
        (item) =>
          field.convertDBValue2CellValue(item.linkField) as ILinkCellValue | ILinkCellValue[]
      )
      .filter(Boolean)
      .flat()
      .map((item) => item.id);
  }

  async getLinkSelectedRecordIds(
    filterLinkCellSelected: [string, string] | string
  ): Promise<{ ids: string[] }> {
    const fieldId = Array.isArray(filterLinkCellSelected)
      ? filterLinkCellSelected[0]
      : filterLinkCellSelected;
    const recordId = Array.isArray(filterLinkCellSelected) ? filterLinkCellSelected[1] : undefined;

    if (!fieldId) {
      throw new BadRequestException(
        'filterByLinkFieldId is required when filterByLinkRecordId is set'
      );
    }

    const prisma = this.prismaService.txClient();
    const fieldRaw = await prisma.field
      .findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Field ${fieldId} not found`);
      });

    if (fieldRaw.type !== FieldType.Link) {
      throw new BadRequestException('You can only filter by link field');
    }

    return {
      ids: recordId ? await this.getLinkCellIds(fieldRaw, recordId) : [],
    };
  }

  private isJunctionTable(dbTableName: string) {
    if (dbTableName.includes('.')) {
      return dbTableName.split('.')[1].startsWith('junction');
    }
    return dbTableName.split('_')[1].startsWith('junction');
  }

  async buildLinkCandidateQuery(
    queryBuilder: Knex.QueryBuilder,
    tableId: string,
    filterLinkCellCandidate: [string, string] | string
  ) {
    const prisma = this.prismaService.txClient();
    const fieldId = Array.isArray(filterLinkCellCandidate)
      ? filterLinkCellCandidate[0]
      : filterLinkCellCandidate;
    const recordId = Array.isArray(filterLinkCellCandidate)
      ? filterLinkCellCandidate[1]
      : undefined;

    const fieldRaw = await prisma.field
      .findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Field ${fieldId} not found`);
      });

    const field = createFieldInstanceByRaw(fieldRaw);

    if (field.type !== FieldType.Link) {
      throw new BadRequestException('You can only filter by link field');
    }
    const { foreignTableId, fkHostTableName, selfKeyName, foreignKeyName, relationship } =
      field.options;
    if (foreignTableId !== tableId) {
      throw new BadRequestException('Field is not linked to current table');
    }
    if (relationship === Relationship.OneMany) {
      if (this.isJunctionTable(fkHostTableName)) {
        queryBuilder.whereNotIn('__id', function () {
          this.select(foreignKeyName).from(fkHostTableName);
        });
      } else {
        queryBuilder.where(selfKeyName, null);
      }
    }
    if (relationship === Relationship.OneOne) {
      if (selfKeyName === '__id') {
        queryBuilder.whereNotIn('__id', function () {
          this.select(foreignKeyName).from(fkHostTableName).whereNotNull(foreignKeyName);
        });
      } else {
        queryBuilder.where(selfKeyName, null);
      }
    }
    if (recordId) {
      const linkIds = await this.getLinkCellIds(fieldRaw, recordId);
      if (linkIds.length) {
        queryBuilder.whereNotIn('__id', linkIds);
      }
    }
  }

  private async getNecessaryFieldMap(
    tableId: string,
    filter?: IFilter,
    orderBy?: ISortItem[],
    groupBy?: IGroup,
    search?: string[]
  ) {
    if (filter || orderBy?.length || groupBy?.length || search) {
      // The field Meta is needed to construct the filter if it exists
      const fields = await this.getFieldsByProjection(tableId);
      return fields.reduce(
        (map, field) => {
          map[field.id] = field;
          map[field.name] = field;
          return map;
        },
        {} as Record<string, IFieldInstance>
      );
    }
  }

  private async getTinyView(tableId: string, viewId?: string) {
    if (!viewId) {
      return;
    }

    return this.prismaService
      .txClient()
      .view.findFirstOrThrow({
        select: { id: true, type: true, filter: true, sort: true, group: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`View ${viewId} not found`);
      });
  }

  private privateParseSearch(search: string[], fieldMap?: Record<string, IFieldInstance>) {
    const [fieldIdOrName, searchValue] = search;
    if (!fieldMap) {
      throw new Error('fieldMap is required when search is set');
    }
    const field = fieldMap[fieldIdOrName];
    if (!field) {
      throw new NotFoundException(`Field ${fieldIdOrName} not found`);
    }
    return [field.id, searchValue];
  }

  async prepareQuery(
    tableId: string,
    query: Pick<IGetRecordsRo, 'viewId' | 'orderBy' | 'groupBy' | 'filter' | 'search'>
  ) {
    const {
      viewId,
      orderBy: extraOrderBy,
      groupBy: extraGroupBy,
      filter: extraFilter,
      search: originSearch,
    } = query;

    const dbTableName = await this.getDbTableName(tableId);

    const queryBuilder = this.knex(dbTableName);

    const view = await this.getTinyView(tableId, viewId);

    const filter = mergeWithDefaultFilter(view?.filter, extraFilter);
    const orderBy = mergeWithDefaultSort(view?.sort, extraOrderBy);
    const groupBy = parseGroup(extraGroupBy);
    const fieldMap = await this.getNecessaryFieldMap(
      tableId,
      filter,
      orderBy,
      groupBy,
      originSearch
    );
    const search = originSearch ? this.privateParseSearch(originSearch, fieldMap) : undefined;

    return {
      queryBuilder,
      dbTableName,
      filter,
      search,
      orderBy,
      groupBy,
      fieldMap,
    };
  }

  async getBasicOrderIndexField(dbTableName: string, viewId: string | undefined) {
    const columnName = `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
    const exists = await this.dbProvider.checkColumnExist(
      dbTableName,
      columnName,
      this.prismaService.txClient()
    );

    if (exists) {
      return columnName;
    }
    return '__auto_number';
  }

  /**
   * Builds a query based on filtering and sorting criteria.
   *
   * This method creates a `Knex` query builder that constructs SQL queries based on the provided
   * filtering and sorting parameters. It also takes into account the context of the current user,
   * which is crucial for ensuring the security and relevance of data access.
   *
   * @param {string} tableId - The unique identifier of the table to determine the target of the query.
   * @param {Pick<IGetRecordsRo, 'viewId' | 'orderBy' | 'filter' | 'filterLinkCellCandidate'>} query - An object of query parameters, including view ID, sorting rules, filtering conditions, etc.
   * @returns {Promise<Knex.QueryBuilder>} Returns an instance of the Knex query builder encapsulating the constructed SQL query.
   */
  async buildFilterSortQuery(
    tableId: string,
    query: Pick<
      IGetRecordsRo,
      'viewId' | 'orderBy' | 'groupBy' | 'filter' | 'search' | 'filterLinkCellCandidate'
    >
  ): Promise<Knex.QueryBuilder> {
    // Prepare the base query builder, filtering conditions, sorting rules, grouping rules and field mapping
    const { dbTableName, queryBuilder, filter, search, orderBy, groupBy, fieldMap } =
      await this.prepareQuery(tableId, query);

    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');

    if (query.filterLinkCellCandidate) {
      await this.buildLinkCandidateQuery(queryBuilder, tableId, query.filterLinkCellCandidate);
    }

    // Add filtering conditions to the query builder
    this.dbProvider
      .filterQuery(queryBuilder, fieldMap, filter, { withUserId: currentUserId })
      .appendQueryBuilder();

    // Add sorting rules to the query builder
    this.dbProvider
      .sortQuery(queryBuilder, fieldMap, [...(groupBy ?? []), ...orderBy])
      .appendSortBuilder();

    // add search rules to the query builder
    this.dbProvider.searchQuery(queryBuilder, fieldMap, search);

    const basicSortIndex = await this.getBasicOrderIndexField(dbTableName, query.viewId);

    // view sorting added by default
    queryBuilder.orderBy(basicSortIndex, 'asc');

    this.logger.debug('buildFilterSortQuery: %s', queryBuilder.toQuery());
    // If you return `queryBuilder` directly and use `await` to receive it,
    // it will perform a query DB operation, which we obviously don't want to see here
    return { queryBuilder };
  }

  async setRecord(
    version: number,
    tableId: string,
    dbTableName: string,
    recordId: string,
    contexts: { fieldId: string; newCellValue: unknown }[]
  ) {
    const userId = this.cls.get('user.id');
    const timeStr = this.cls.get('tx.timeStr') ?? new Date().toISOString();

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

    const recordFieldsByDbFieldName = contexts.reduce<{ [dbFieldName: string]: unknown }>(
      (pre, ctx) => {
        const fieldInstance = fieldInstanceMap[ctx.fieldId];
        pre[fieldInstance.dbFieldName] = fieldInstance.convertCellValue2DBValue(ctx.newCellValue);
        return pre;
      },
      {}
    );

    const updateRecordSql = this.knex(dbTableName)
      .update({
        ...recordFieldsByDbFieldName,
        __last_modified_by: userId,
        __last_modified_time: timeStr,
        __version: version,
      })
      .where({ __id: recordId })
      .toQuery();
    return this.prismaService.txClient().$executeRawUnsafe(updateRecordSql);
  }

  private convertProjection(fieldKeys?: string[]) {
    return fieldKeys?.reduce<Record<string, boolean>>((acc, cur) => {
      acc[cur] = true;
      return acc;
    }, {});
  }

  async getRecords(tableId: string, query: IGetRecordsRo): Promise<IRecordsVo> {
    const queryResult = await this.getDocIdsByQuery(tableId, {
      viewId: query.viewId,
      skip: query.skip,
      take: query.take,
      filter: query.filter,
      orderBy: query.orderBy,
      search: query.search,
      groupBy: query.groupBy,
      filterLinkCellCandidate: query.filterLinkCellCandidate,
      filterLinkCellSelected: query.filterLinkCellSelected,
    });

    const recordSnapshot = await this.getSnapshotBulk(
      tableId,
      queryResult.ids,
      this.convertProjection(query.projection),
      query.fieldKeyType || FieldKeyType.Name,
      query.cellFormat
    );
    return {
      records: recordSnapshot.map((r) => r.data),
    };
  }

  async getRecord(tableId: string, recordId: string, query: IGetRecordQuery): Promise<IRecord> {
    const { projection, fieldKeyType = FieldKeyType.Name, cellFormat } = query;
    const recordSnapshot = await this.getSnapshotBulk(
      tableId,
      [recordId],
      this.convertProjection(projection),
      fieldKeyType,
      cellFormat
    );

    if (!recordSnapshot.length) {
      throw new NotFoundException('Can not get record');
    }

    return recordSnapshot[0].data;
  }

  async getCellValue(tableId: string, recordId: string, fieldId: string) {
    const record = await this.getRecord(tableId, recordId, {
      projection: [fieldId],
      fieldKeyType: FieldKeyType.Id,
    });
    return record.fields[fieldId];
  }

  async getMaxRecordOrder(dbTableName: string) {
    const sqlNative = this.knex(dbTableName).max('__auto_number', { as: 'max' }).toSQL().toNative();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ max?: number }[]>(sqlNative.sql, ...sqlNative.bindings);

    return Number(result[0]?.max ?? 0) + 1;
  }

  async batchDeleteRecords(tableId: string, recordIds: string[]) {
    const dbTableName = await this.getDbTableName(tableId);
    // get version by recordIds, __id as id, __version as version
    const nativeQuery = this.knex(dbTableName)
      .select('__id as id', '__version as version')
      .whereIn('__id', recordIds)
      .toQuery();
    const recordRaw = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id: string; version: number }[]>(nativeQuery);

    if (recordIds.length !== recordRaw.length) {
      throw new BadRequestException('delete record not found');
    }

    const recordRawMap = keyBy(recordRaw, 'id');

    const dataList = recordIds.map((recordId) => ({
      docId: recordId,
      version: recordRawMap[recordId].version,
    }));

    await this.batchService.saveRawOps(tableId, RawOpType.Del, IdPrefix.Record, dataList);

    await this.batchDel(tableId, recordIds);
  }

  @Timing()
  async batchCreateRecords(
    tableId: string,
    records: IRecord[],
    orderIndex?: { viewId: string; indexes: number[] }
  ) {
    const snapshots = await this.createBatch(tableId, records, orderIndex);

    const dataList = snapshots.map((snapshot) => ({
      docId: snapshot.__id,
      version: 0,
    }));

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.Record, dataList);
  }

  async create(tableId: string, snapshot: IRecord) {
    await this.createBatch(tableId, [snapshot]);
  }

  async creditCheck(tableId: string) {
    if (!this.thresholdConfig.maxFreeRowLimit) {
      return;
    }

    const table = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true, base: { select: { space: { select: { credit: true } } } } },
    });

    const rowCount = await this.getAllRecordCount(table.dbTableName);

    const maxRowCount =
      table.base.space.credit == null
        ? this.thresholdConfig.maxFreeRowLimit
        : table.base.space.credit;

    if (rowCount >= maxRowCount) {
      this.logger.log(`Exceed row count: ${maxRowCount}`, 'creditCheck');
      throw new BadRequestException(
        `Exceed max row limit: ${maxRowCount}, please contact us to increase the limit`
      );
    }
  }

  private async getAllViewIndexesField(dbTableName: string) {
    const query = this.dbProvider.columnInfo(dbTableName);
    const columns = await this.prismaService.txClient().$queryRawUnsafe<{ name: string }[]>(query);
    return columns
      .filter((column) => column.name.startsWith(ROW_ORDER_FIELD_PREFIX))
      .map((column) => column.name)
      .reduce<{ [viewId: string]: string }>((acc, cur) => {
        const viewId = cur.substring(ROW_ORDER_FIELD_PREFIX.length + 1);
        acc[viewId] = cur;
        return acc;
      }, {});
  }

  private async createBatch(
    tableId: string,
    records: IRecord[],
    orderIndex?: { viewId: string; indexes: number[] }
  ) {
    const userId = this.cls.get('user.id');
    await this.creditCheck(tableId);
    const dbTableName = await this.getDbTableName(tableId);

    const maxRecordOrder = await this.getMaxRecordOrder(dbTableName);

    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });

    const allViewIndexes = await this.getAllViewIndexesField(dbTableName);

    const snapshots = records
      .map((_, i) =>
        views.reduce<{ [viewIndexFieldName: string]: number }>((pre, cur) => {
          const viewIndexFieldName = allViewIndexes[cur.id];
          if (cur.id === orderIndex?.viewId) {
            pre[viewIndexFieldName] = orderIndex.indexes[i];
          } else if (viewIndexFieldName) {
            pre[viewIndexFieldName] = maxRecordOrder + i;
          }
          return pre;
        }, {})
      )
      .map((order, i) => {
        const snapshot = records[i];
        return {
          __id: snapshot.id,
          __created_by: userId,
          __version: 1,
          ...order,
        };
      });

    const sql = this.dbProvider.batchInsertSql(dbTableName, snapshots);

    await this.prismaService.txClient().$executeRawUnsafe(sql);

    return snapshots;
  }

  private async batchDel(tableId: string, recordIds: string[]) {
    const dbTableName = await this.getDbTableName(tableId);

    const nativeQuery = this.knex(dbTableName).whereIn('__id', recordIds).del().toQuery();

    await this.prismaService.txClient().$executeRawUnsafe(nativeQuery);
  }

  async del(_version: number, tableId: string, recordId: string) {
    await this.batchDel(tableId, [recordId]);
  }

  async update(
    version: number,
    tableId: string,
    recordId: string,
    opContexts: ISetRecordOpContext[]
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

  async projectionFormPermission(
    tableId: string,
    fieldKeyType: FieldKeyType,
    projection?: { [fieldNameOrId: string]: boolean }
  ) {
    const shareId = this.cls.get('shareViewId');
    const projectionInner = projection || {};
    if (shareId) {
      const rawView = await this.prismaService.txClient().view.findFirst({
        where: { shareId: shareId, enableShare: true, deletedTime: null },
        select: { id: true, shareMeta: true, columnMeta: true },
      });
      const view = {
        ...rawView,
        columnMeta: rawView?.columnMeta ? JSON.parse(rawView.columnMeta) : {},
      };
      if (!view) {
        throw new NotFoundException();
      }
      const fieldsPlain = await this.prismaService.txClient().field.findMany({
        where: { tableId, deletedTime: null },
        select: {
          id: true,
          name: true,
        },
      });

      const fields = fieldsPlain.map((field) => {
        return {
          ...field,
        };
      });

      if (!(view.shareMeta as IShareViewMeta)?.includeHiddenField) {
        fields
          .filter((field) => !view.columnMeta[field.id].hidden)
          .forEach((field) => (projectionInner[field[fieldKeyType]] = true));
      }
    }
    return Object.keys(projectionInner).length ? projectionInner : undefined;
  }

  private async recordsPresignedUrl(
    records: ISnapshotBase<IRecord>[],
    fields: IFieldInstance[],
    fieldKeyType: FieldKeyType
  ) {
    for (const field of fields) {
      if (field.type === FieldType.Attachment) {
        const fieldKey = fieldKeyType === FieldKeyType.Id ? field.id : field.name;
        for (const record of records) {
          let cellValue = record.data.fields[fieldKey];
          if (cellValue == null) {
            continue;
          }
          const attachmentCellValue = cellValue as IAttachmentCellValue;
          cellValue = await Promise.all(
            attachmentCellValue.map(async (item) => {
              const { path, mimetype, token } = item;
              const presignedUrl = await this.attachmentStorageService.getPreviewUrlByPath(
                StorageAdapter.getBucket(UploadType.Table),
                path,
                token,
                undefined,
                {
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'Content-Type': mimetype,
                }
              );
              return {
                ...item,
                presignedUrl,
              };
            })
          );
          record.data.fields[fieldKey] = cellValue;
        }
      }
    }
    return records;
  }

  async getSnapshotBulk(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id, // for convince of collaboration, getSnapshotBulk use id as field key by default.
    cellFormat = CellFormat.Json
  ): Promise<ISnapshotBase<IRecord>[]> {
    const projectionInner = await this.projectionFormPermission(tableId, fieldKeyType, projection);
    const dbTableName = await this.getDbTableName(tableId);

    const fields = await this.getFieldsByProjection(tableId, projectionInner, fieldKeyType);
    const fieldNames = fields.map((f) => f.dbFieldName).concat(Array.from(preservedDbFieldNames));

    const nativeQuery = this.knex(dbTableName)
      .select(fieldNames)
      .whereIn('__id', recordIds)
      .toQuery();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        ({ [fieldName: string]: unknown } & IVisualTableDefaultField)[]
      >(nativeQuery);

    const recordIdsMap = recordIds.reduce(
      (acc, recordId, currentIndex) => {
        acc[recordId] = currentIndex;
        return acc;
      },
      {} as { [recordId: string]: number }
    );

    recordIds.forEach((recordId) => {
      if (!(recordId in recordIdsMap)) {
        throw new NotFoundException(`Record ${recordId} not found`);
      }
    });

    const primaryFieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { tableId, isPrimary: true, deletedTime: null },
    });

    const primaryField = createFieldInstanceByRaw(primaryFieldRaw);

    const snapshots = result
      .sort((a, b) => {
        return recordIdsMap[a.__id] - recordIdsMap[b.__id];
      })
      .map((record) => {
        const recordFields = this.dbRecord2RecordFields(record, fields, fieldKeyType, cellFormat);
        const name = recordFields[primaryField[fieldKeyType]];
        return {
          id: record.__id,
          v: record.__version,
          type: 'json0',
          data: {
            fields: recordFields,
            name:
              cellFormat === CellFormat.Text
                ? (name as string)
                : primaryField.cellValue2String(name),
            id: record.__id,
            autoNumber: record.__auto_number,
            createdTime: record.__created_time?.toISOString(),
            lastModifiedTime: record.__last_modified_time?.toISOString(),
            createdBy: record.__created_by,
            lastModifiedBy: record.__last_modified_by || undefined,
          },
        };
      });
    if (cellFormat === CellFormat.Json) {
      return await this.recordsPresignedUrl(snapshots, fields, fieldKeyType);
    }
    return snapshots;
  }

  async shareWithViewId(tableId: string, viewId?: string) {
    const shareId = this.cls.get('shareViewId');
    if (!shareId) {
      return viewId;
    }
    const view = await this.prismaService.txClient().view.findFirst({
      select: { id: true },
      where: {
        tableId,
        shareId,
        ...(viewId ? { id: viewId } : {}),
        enableShare: true,
        deletedTime: null,
      },
    });
    if (!view) {
      throw new BadRequestException('error shareId');
    }
    return view.id;
  }

  async getDocIdsByQuery(
    tableId: string,
    query: IGetRecordsRo
  ): Promise<{ ids: string[]; extra?: IExtraResult }> {
    const viewId = await this.shareWithViewId(tableId, query.viewId);

    const { skip, take = 100 } = query;
    if (identify(tableId) !== IdPrefix.Table) {
      throw new InternalServerErrorException('query collection must be table id');
    }

    if (take > 1000) {
      throw new BadRequestException(`limit can't be greater than ${take}`);
    }

    if (query.filterLinkCellSelected) {
      return this.getLinkSelectedRecordIds(query.filterLinkCellSelected);
    }

    const { queryBuilder } = await this.buildFilterSortQuery(tableId, {
      ...query,
      viewId,
    });

    queryBuilder.select('__id');

    queryBuilder.offset(skip);
    if (take !== -1) {
      queryBuilder.limit(take);
    }

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(queryBuilder.toQuery());
    const ids = result.map((r) => r.__id);
    return { ids };
  }

  async getRecordsFields(
    tableId: string,
    query: IGetRecordsRo
  ): Promise<Pick<IRecord, 'id' | 'fields'>[]> {
    if (identify(tableId) !== IdPrefix.Table) {
      throw new InternalServerErrorException('query collection must be table id');
    }

    const {
      skip,
      take,
      filter,
      orderBy,
      search,
      groupBy,
      fieldKeyType,
      cellFormat,
      projection,
      viewId,
      filterLinkCellCandidate,
    } = query;

    const fields = await this.getFieldsByProjection(
      tableId,
      this.convertProjection(projection),
      fieldKeyType
    );
    const fieldNames = fields.map((f) => f.dbFieldName);

    const { queryBuilder } = await this.buildFilterSortQuery(tableId, {
      viewId,
      filterLinkCellCandidate,
      filter,
      orderBy,
      search,
      groupBy,
    });
    queryBuilder.select(fieldNames.concat('__id'));
    queryBuilder.offset(skip);
    if (take !== -1) {
      queryBuilder.limit(take);
    }

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        (Pick<IRecord, 'fields'> & Pick<IVisualTableDefaultField, '__id'>)[]
      >(queryBuilder.toQuery());

    return result.map((record) => {
      return {
        id: record.__id,
        fields: this.dbRecord2RecordFields(record, fields, fieldKeyType, cellFormat),
      };
    });
  }

  async getRecordsWithPrimary(tableId: string, titles: string[]) {
    const dbTableName = await this.getDbTableName(tableId);
    const field = await this.prismaService.txClient().field.findFirst({
      where: { tableId, isPrimary: true, deletedTime: null },
    });
    if (!field) {
      throw new BadRequestException(`Could not find primary index ${tableId}`);
    }

    const queryBuilder = this.knex(dbTableName)
      .select({ title: field.dbFieldName, id: '__id' })
      .whereIn(field.dbFieldName, titles);

    const querySql = queryBuilder.toQuery();

    return this.prismaService.txClient().$queryRawUnsafe<{ id: string; title: string }[]>(querySql);
  }
}
