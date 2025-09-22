/* eslint-disable @typescript-eslint/naming-convention */
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  IAttachmentCellValue,
  IColumnMeta,
  IExtraResult,
  IFilter,
  IFilterSet,
  IGridColumnMeta,
  IGroup,
  ILinkCellValue,
  IRecord,
  ISnapshotBase,
  ISortItem,
} from '@teable/core';
import {
  and,
  CellFormat,
  CellValueType,
  DbFieldType,
  FieldKeyType,
  FieldType,
  generateRecordId,
  HttpErrorCode,
  identify,
  IdPrefix,
  mergeFilter,
  mergeWithDefaultFilter,
  mergeWithDefaultSort,
  or,
  parseGroup,
  Relationship,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateRecordsRo,
  IGetRecordQuery,
  IGetRecordsRo,
  IGroupHeaderPoint,
  IGroupHeaderRef,
  IGroupPoint,
  IGroupPointsVo,
  IRecordStatusVo,
  IRecordsVo,
} from '@teable/openapi';
import { DEFAULT_MAX_SEARCH_FIELD_COUNT, GroupPointType, UploadType } from '@teable/openapi';
import { Knex } from 'knex';
import { get, difference, keyBy, orderBy, uniqBy, toNumber } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { convertValueToStringify, string2Hash } from '../../utils';
import { handleDBValidationErrors } from '../../utils/db-validation-error';
import { generateFilterItem } from '../../utils/filter';
import {
  generateTableThumbnailPath,
  getTableThumbnailToken,
} from '../../utils/generate-thumbnail-path';
import { Timing } from '../../utils/timing';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { BatchService } from '../calculation/batch.service';
import { DataLoaderService } from '../data-loader/data-loader.service';
import type { IVisualTableDefaultField } from '../field/constant';
import { preservedDbFieldNames } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { TableIndexService } from '../table/table-index.service';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { RecordPermissionService } from './record-permission.service';
import { IFieldRaws } from './type';

type IUserFields = { id: string; dbFieldName: string }[];

function removeUndefined<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined)) as T;
}

export interface IRecordInnerRo {
  id: string;
  fields: Record<string, unknown>;
  createdBy?: string;
  lastModifiedBy?: string;
  createdTime?: string;
  lastModifiedTime?: string;
  autoNumber?: number;
  order?: Record<string, number>; // viewId: index
}

@Injectable()
export class RecordService {
  private logger = new Logger(RecordService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly batchService: BatchService,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService,
    private readonly attachmentStorageService: AttachmentsStorageService,
    private readonly recordPermissionService: RecordPermissionService,
    private readonly tableIndexService: TableIndexService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly dataLoaderService: DataLoaderService
  ) {}

  private dbRecord2RecordFields(
    record: IRecord['fields'],
    fields: IFieldInstance[],
    fieldKeyType: FieldKeyType = FieldKeyType.Id,
    cellFormat: CellFormat = CellFormat.Json
  ) {
    return fields.reduce<IRecord['fields']>((acc, field) => {
      const fieldNameOrId = field[fieldKeyType];
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

  private async getLinkCellIds(tableId: string, field: IFieldInstance, recordId: string) {
    const prisma = this.prismaService.txClient();
    const dbTableName = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    const linkCellQuery = this.knex(dbTableName)
      .select({
        id: '__id',
        linkField: field.dbFieldName,
      })
      .where('__id', recordId)
      .toQuery();

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

  private async buildLinkSelectedSort(
    queryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    filterLinkCellSelected: [string, string]
  ) {
    const prisma = this.prismaService.txClient();
    const [fieldId, recordId] = filterLinkCellSelected;
    const fieldRaw = await prisma.field
      .findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Field ${fieldId} not found`);
      });
    const field = createFieldInstanceByRaw(fieldRaw);
    if (!field.isMultipleCellValue) {
      return;
    }

    const ids = await this.getLinkCellIds(fieldRaw.tableId, field, recordId);
    if (!ids.length) {
      return;
    }

    // sql capable for sqlite
    const valuesQuery = ids
      .map((id, index) => `SELECT ${index + 1} AS sort_order, '${id}' AS id`)
      .join(' UNION ALL ');

    queryBuilder
      .with('ordered_ids', this.knex.raw(`${valuesQuery}`))
      .leftJoin('ordered_ids', function () {
        this.on(`${dbTableName}.__id`, '=', 'ordered_ids.id');
      })
      .orderBy('ordered_ids.sort_order');
  }

  private isJunctionTable(dbTableName: string) {
    if (dbTableName.includes('.')) {
      return dbTableName.split('.')[1].startsWith('junction');
    }
    return dbTableName.split('_')[1].startsWith('junction');
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async buildLinkSelectedQuery(
    queryBuilder: Knex.QueryBuilder,
    tableId: string,
    dbTableName: string,
    filterLinkCellSelected: [string, string] | string
  ) {
    const prisma = this.prismaService.txClient();
    const fieldId = Array.isArray(filterLinkCellSelected)
      ? filterLinkCellSelected[0]
      : filterLinkCellSelected;
    const recordId = Array.isArray(filterLinkCellSelected) ? filterLinkCellSelected[1] : undefined;

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
    const { foreignTableId, fkHostTableName, selfKeyName, foreignKeyName } = field.options;
    if (foreignTableId !== tableId) {
      throw new BadRequestException('Field is not linked to current table');
    }

    if (fkHostTableName !== dbTableName) {
      queryBuilder.leftJoin(
        `${fkHostTableName}`,
        `${dbTableName}.__id`,
        '=',
        `${fkHostTableName}.${foreignKeyName}`
      );
      if (recordId) {
        queryBuilder.where(`${fkHostTableName}.${selfKeyName}`, recordId);
        return;
      }
      queryBuilder.whereNotNull(`${fkHostTableName}.${foreignKeyName}`);
      return;
    }

    if (recordId) {
      queryBuilder.where(`${dbTableName}.${selfKeyName}`, recordId);
      return;
    }
    queryBuilder.whereNotNull(`${dbTableName}.${selfKeyName}`);
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
      const linkIds = await this.getLinkCellIds(fieldRaw.tableId, field, recordId);
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
    search?: [string, string?, boolean?],
    projection?: string[]
  ) {
    if (filter || orderBy?.length || groupBy?.length || search) {
      // The field Meta is needed to construct the filter if it exists
      const fields = await this.getFieldsByProjection(tableId, this.convertProjection(projection));
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
        select: { id: true, type: true, filter: true, sort: true, group: true, columnMeta: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`View ${viewId} not found`);
      });
  }

  public parseSearch(
    search: [string, string?, boolean?],
    fieldMap?: Record<string, IFieldInstance>
  ): [string, string?, boolean?] {
    const [searchValue, fieldId, hideNotMatchRow] = search;

    if (!fieldMap) {
      throw new Error('fieldMap is required when search is set');
    }

    if (!fieldId) {
      return [searchValue, fieldId, hideNotMatchRow];
    }

    const fieldIds = fieldId?.split(',');

    fieldIds.forEach((id) => {
      const field = fieldMap[id];
      if (!field) {
        throw new NotFoundException(`Field ${id} not found`);
      }
    });

    return [searchValue, fieldId, hideNotMatchRow];
  }

  async prepareQuery(
    tableId: string,
    query: Pick<
      IGetRecordsRo,
      | 'viewId'
      | 'orderBy'
      | 'groupBy'
      | 'filter'
      | 'search'
      | 'filterLinkCellSelected'
      | 'ignoreViewQuery'
    >
  ) {
    const viewId = query.ignoreViewQuery ? undefined : query.viewId;
    const {
      orderBy: extraOrderBy,
      groupBy: extraGroupBy,
      filter: extraFilter,
      search: originSearch,
    } = query;
    const dbTableName = await this.getDbTableName(tableId);
    const { viewCte, builder, enabledFieldIds } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        viewId: query.viewId,
        keepPrimaryKey: Boolean(query.filterLinkCellSelected),
      }
    );

    const queryBuilder = builder.from(viewCte ?? dbTableName);

    const view = await this.getTinyView(tableId, viewId);

    const filter = mergeWithDefaultFilter(view?.filter, extraFilter);
    const orderBy = mergeWithDefaultSort(view?.sort, extraOrderBy);
    const groupBy = parseGroup(extraGroupBy);
    const fieldMap = await this.getNecessaryFieldMap(
      tableId,
      filter,
      orderBy,
      groupBy,
      originSearch,
      enabledFieldIds
    );

    const search = originSearch ? this.parseSearch(originSearch, fieldMap) : undefined;

    return {
      queryBuilder,
      dbTableName,
      viewCte,
      filter,
      search,
      orderBy,
      groupBy,
      fieldMap,
    };
  }

  async getBasicOrderIndexField(dbTableName: string, viewId: string | undefined) {
    if (!viewId) {
      return '__auto_number';
    }
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
      | 'viewId'
      | 'ignoreViewQuery'
      | 'orderBy'
      | 'groupBy'
      | 'filter'
      | 'search'
      | 'filterLinkCellCandidate'
      | 'filterLinkCellSelected'
      | 'collapsedGroupIds'
      | 'selectedRecordIds'
    >
  ) {
    // Prepare the base query builder, filtering conditions, sorting rules, grouping rules and field mapping
    const { dbTableName, queryBuilder, viewCte, filter, search, orderBy, groupBy, fieldMap } =
      await this.prepareQuery(tableId, query);

    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');

    const viewQueryDbTableName = viewCte ?? dbTableName;

    if (query.filterLinkCellSelected && query.filterLinkCellCandidate) {
      throw new BadRequestException(
        'filterLinkCellSelected and filterLinkCellCandidate can not be set at the same time'
      );
    }

    if (query.selectedRecordIds) {
      query.filterLinkCellCandidate
        ? queryBuilder.whereNotIn(`${viewQueryDbTableName}.__id`, query.selectedRecordIds)
        : queryBuilder.whereIn(`${viewQueryDbTableName}.__id`, query.selectedRecordIds);
    }

    if (query.filterLinkCellCandidate) {
      await this.buildLinkCandidateQuery(queryBuilder, tableId, query.filterLinkCellCandidate);
    }

    if (query.filterLinkCellSelected) {
      await this.buildLinkSelectedQuery(
        queryBuilder,
        tableId,
        viewQueryDbTableName,
        query.filterLinkCellSelected
      );
    }

    // Add filtering conditions to the query builder
    this.dbProvider
      .filterQuery(queryBuilder, fieldMap, filter, { withUserId: currentUserId })
      .appendQueryBuilder();
    // Add sorting rules to the query builder
    this.dbProvider
      .sortQuery(queryBuilder, fieldMap, [...(groupBy ?? []), ...orderBy])
      .appendSortBuilder();

    if (search && search[2] && fieldMap) {
      const searchFields = await this.getSearchFields(fieldMap, search, query?.viewId);
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(
          builder,
          viewQueryDbTableName,
          searchFields,
          tableIndex,
          search
        );
      });
    }

    // ignore sorting when filterLinkCellSelected is set
    if (query.filterLinkCellSelected && Array.isArray(query.filterLinkCellSelected)) {
      await this.buildLinkSelectedSort(
        queryBuilder,
        viewQueryDbTableName,
        query.filterLinkCellSelected
      );
    } else {
      const basicSortIndex = await this.getBasicOrderIndexField(dbTableName, query.viewId);
      // view sorting added by default
      queryBuilder.orderBy(`${viewQueryDbTableName}.${basicSortIndex}`, 'asc');
    }

    this.logger.debug('buildFilterSortQuery: %s', queryBuilder.toQuery());
    // If you return `queryBuilder` directly and use `await` to receive it,
    // it will perform a query DB operation, which we obviously don't want to see here
    return { queryBuilder, dbTableName, viewCte };
  }

  convertProjection(fieldKeys?: string[]) {
    return fieldKeys?.reduce<Record<string, boolean>>((acc, cur) => {
      acc[cur] = true;
      return acc;
    }, {});
  }

  async getRecordsById(
    tableId: string,
    recordIds: string[],
    withPermission = true
  ): Promise<IRecordsVo> {
    const recordSnapshot = await this[
      withPermission ? 'getSnapshotBulkWithPermission' : 'getSnapshotBulk'
    ](tableId, recordIds, undefined, FieldKeyType.Id);

    if (!recordSnapshot.length) {
      throw new NotFoundException('Can not get records');
    }

    return {
      records: recordSnapshot.map((r) => r.data),
    };
  }

  private async getViewProjection(
    tableId: string,
    query: IGetRecordsRo
  ): Promise<Record<string, boolean> | undefined> {
    const viewId = query.viewId;
    if (!viewId) {
      return;
    }

    const fieldKeyType = query.fieldKeyType || FieldKeyType.Name;
    const view = await this.prismaService.txClient().view.findFirstOrThrow({
      where: { id: viewId, deletedTime: null },
      select: { id: true, columnMeta: true },
    });

    const columnMeta = JSON.parse(view.columnMeta) as IColumnMeta;

    const useVisible = Object.values(columnMeta).some((column) => 'visible' in column);
    const useHidden = Object.values(columnMeta).some((column) => 'hidden' in column);

    if (!useVisible && !useHidden) {
      return;
    }

    const fieldRaws = await this.dataLoaderService.field.load(tableId);

    const fieldMap = keyBy(fieldRaws, 'id');

    const projection = Object.entries(columnMeta).reduce<Record<string, boolean>>(
      (acc, [fieldId, column]) => {
        const field = fieldMap[fieldId];
        if (!field) return acc;

        const fieldKey = field[fieldKeyType];

        if (useVisible) {
          if ('visible' in column && column.visible) {
            acc[fieldKey] = true;
          }
        } else if (useHidden) {
          if (!('hidden' in column) || !column.hidden) {
            acc[fieldKey] = true;
          }
        } else {
          acc[fieldKey] = true;
        }

        return acc;
      },
      {}
    );

    return Object.keys(projection).length > 0 ? projection : undefined;
  }

  async getRecords(tableId: string, query: IGetRecordsRo): Promise<IRecordsVo> {
    const queryResult = await this.getDocIdsByQuery(tableId, {
      ignoreViewQuery: query.ignoreViewQuery ?? false,
      viewId: query.viewId,
      skip: query.skip,
      take: query.take,
      filter: query.filter,
      orderBy: query.orderBy,
      search: query.search,
      groupBy: query.groupBy,
      filterLinkCellCandidate: query.filterLinkCellCandidate,
      filterLinkCellSelected: query.filterLinkCellSelected,
      selectedRecordIds: query.selectedRecordIds,
    });

    const projection = query.projection
      ? this.convertProjection(query.projection)
      : await this.getViewProjection(tableId, query);

    const recordSnapshot = await this.getSnapshotBulkWithPermission(
      tableId,
      queryResult.ids,
      projection,
      query.fieldKeyType || FieldKeyType.Name,
      query.cellFormat
    );

    return {
      records: recordSnapshot.map((r) => r.data),
      extra: queryResult.extra,
    };
  }

  async getRecord(
    tableId: string,
    recordId: string,
    query: IGetRecordQuery,
    withPermission = true
  ): Promise<IRecord> {
    const { projection, fieldKeyType = FieldKeyType.Name, cellFormat } = query;
    const recordSnapshot = await this[
      withPermission ? 'getSnapshotBulkWithPermission' : 'getSnapshotBulk'
    ](tableId, [recordId], this.convertProjection(projection), fieldKeyType, cellFormat);

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

  private async getViewIndexColumns(dbTableName: string) {
    const columnInfoQuery = this.dbProvider.columnInfo(dbTableName);
    const columns = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);
    return columns
      .filter((column) => column.name.startsWith(ROW_ORDER_FIELD_PREFIX))
      .map((column) => column.name);
  }

  async getRecordIndexes(
    tableId: string,
    recordIds: string[],
    viewId?: string
  ): Promise<Record<string, number>[] | undefined> {
    const dbTableName = await this.getDbTableName(tableId);
    const allViewIndexColumns = await this.getViewIndexColumns(dbTableName);
    const viewIndexColumns = viewId
      ? (() => {
          const viewIndexColumns = allViewIndexColumns.filter((column) => column.endsWith(viewId));
          return viewIndexColumns.length === 0 ? ['__auto_number'] : viewIndexColumns;
        })()
      : allViewIndexColumns;

    if (!viewIndexColumns.length) {
      return;
    }

    // get all viewIndexColumns value for __id in recordIds
    const indexQuery = this.knex(dbTableName)
      .select(
        viewIndexColumns.reduce<Record<string, string>>((acc, columnName) => {
          if (columnName === '__auto_number') {
            acc[viewId as string] = '__auto_number';
            return acc;
          }
          const theViewId = columnName.substring(ROW_ORDER_FIELD_PREFIX.length + 1);
          acc[theViewId] = columnName;
          return acc;
        }, {})
      )
      .select('__id')
      .whereIn('__id', recordIds)
      .toQuery();
    const indexValues = await this.prismaService
      .txClient()
      .$queryRawUnsafe<Record<string, number>[]>(indexQuery);

    const indexMap = indexValues.reduce<Record<string, Record<string, number>>>((map, cur) => {
      const id = cur.__id;
      delete cur.__id;
      map[id] = cur;
      return map;
    }, {});

    return recordIds.map((recordId) => indexMap[recordId]);
  }

  async updateRecordIndexes(
    tableId: string,
    recordsWithOrder: {
      id: string;
      order?: Record<string, number>;
    }[]
  ) {
    const dbTableName = await this.getDbTableName(tableId);
    const viewIndexColumns = await this.getViewIndexColumns(dbTableName);
    if (!viewIndexColumns.length) {
      return;
    }

    const updateRecordSqls = recordsWithOrder
      .map((record) => {
        const order = record.order;
        const orderFields = viewIndexColumns.reduce<Record<string, number>>((acc, columnName) => {
          const viewId = columnName.substring(ROW_ORDER_FIELD_PREFIX.length + 1);
          const index = order?.[viewId];
          if (index != null) {
            acc[columnName] = index;
          }
          return acc;
        }, {});

        if (!order || Object.keys(orderFields).length === 0) {
          return;
        }

        return this.knex(dbTableName).update(orderFields).where('__id', record.id).toQuery();
      })
      .filter(Boolean) as string[];

    for (const sql of updateRecordSqls) {
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
  }

  @Timing()
  async batchCreateRecords(
    tableId: string,
    records: IRecordInnerRo[],
    fieldKeyType: FieldKeyType,
    fieldRaws: IFieldRaws
  ) {
    const snapshots = await this.createBatch(tableId, records, fieldKeyType, fieldRaws);

    const dataList = snapshots.map((snapshot) => ({
      docId: snapshot.__id,
      version: snapshot.__version == null ? 0 : snapshot.__version - 1,
    }));

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.Record, dataList);
  }

  @Timing()
  async createRecordsOnlySql(
    tableId: string,
    records: {
      fields: Record<string, unknown>;
    }[]
  ) {
    const userId = this.cls.get('user.id');
    await this.creditCheck(tableId);
    const dbTableName = await this.getDbTableName(tableId);
    const fields = await this.getFieldsByProjection(tableId);
    const fieldInstanceMap = fields.reduce(
      (map, curField) => {
        map[curField.id] = curField;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );

    const newRecords = records.map((record) => {
      const fieldsValues: Record<string, unknown> = {};
      Object.entries(record.fields).forEach(([fieldId, value]) => {
        const fieldInstance = fieldInstanceMap[fieldId];
        fieldsValues[fieldInstance.dbFieldName] = fieldInstance.convertCellValue2DBValue(value);
      });
      return {
        __id: generateRecordId(),
        __created_by: userId,
        __version: 1,
        ...fieldsValues,
      };
    });
    const sql = this.dbProvider.batchInsertSql(dbTableName, newRecords);
    await this.prismaService.txClient().$executeRawUnsafe(sql);
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
    records: IRecordInnerRo[],
    fieldKeyType: FieldKeyType,
    fieldRaws: IFieldRaws
  ) {
    const userId = this.cls.get('user.id');
    await this.creditCheck(tableId);

    const { dbTableName, name: tableName } = await this.prismaService
      .txClient()
      .tableMeta.findUniqueOrThrow({
        where: { id: tableId },
        select: { dbTableName: true, name: true },
      })
      .catch(() => {
        throw new NotFoundException(`Table ${tableId} not found`);
      });

    const maxRecordOrder = await this.getMaxRecordOrder(dbTableName);

    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });

    const allViewIndexes = await this.getAllViewIndexesField(dbTableName);

    const validationFields = fieldRaws.filter((field) => field.notNull || field.unique);

    const snapshots = records
      .map((record, i) =>
        views.reduce<{ [viewIndexFieldName: string]: number }>((pre, cur) => {
          const viewIndexFieldName = allViewIndexes[cur.id];
          const recordViewIndex = record.order?.[cur.id];
          if (!viewIndexFieldName) {
            return pre;
          }
          if (recordViewIndex) {
            pre[viewIndexFieldName] = recordViewIndex;
          } else {
            pre[viewIndexFieldName] = maxRecordOrder + i;
          }
          return pre;
        }, {})
      )
      .map((order, i) => {
        const snapshot = records[i];
        const fields = snapshot.fields;

        const dbFieldValueMap = validationFields.reduce(
          (map, field) => {
            const dbFieldName = field.dbFieldName;
            const fieldKey = field[fieldKeyType];
            const cellValue = fields[fieldKey];

            map[dbFieldName] = cellValue;
            return map;
          },
          {} as Record<string, unknown>
        );

        return removeUndefined({
          __id: snapshot.id,
          __created_by: snapshot.createdBy || userId,
          __last_modified_by: snapshot.lastModifiedBy || undefined,
          __created_time: snapshot.createdTime || undefined,
          __last_modified_time: snapshot.lastModifiedTime || undefined,
          __auto_number: snapshot.autoNumber == null ? undefined : snapshot.autoNumber,
          __version: 1,
          ...order,
          ...dbFieldValueMap,
        });
      });

    const sql = this.dbProvider.batchInsertSql(
      dbTableName,
      snapshots.map((s) => {
        return Object.entries(s).reduce(
          (acc, [key, value]) => {
            acc[key] = Array.isArray(value) ? JSON.stringify(value) : value;
            return acc;
          },
          {} as Record<string, unknown>
        );
      })
    );

    await handleDBValidationErrors({
      fn: () => this.prismaService.txClient().$executeRawUnsafe(sql),
      handleUniqueError: () => {
        throw new CustomHttpException(
          `Fields ${validationFields.map((f) => f.id).join(', ')} unique validation failed`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.custom.fieldValueDuplicate',
              context: {
                tableName,
                fieldName: validationFields.map((f) => f.name).join(', '),
              },
            },
          }
        );
      },
      handleNotNullError: () => {
        throw new CustomHttpException(
          `Fields ${validationFields.map((f) => f.id).join(', ')} not null validation failed`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.custom.fieldValueNotNull',
              context: {
                tableName,
                fieldName: validationFields.map((f) => f.name).join(', '),
              },
            },
          }
        );
      },
    });

    return snapshots;
  }

  private async batchDel(tableId: string, recordIds: string[]) {
    const dbTableName = await this.getDbTableName(tableId);

    const nativeQuery = this.knex(dbTableName).whereIn('__id', recordIds).del().toQuery();
    await this.prismaService.txClient().$executeRawUnsafe(nativeQuery);
  }

  public async getFieldsByProjection(
    tableId: string,
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id
  ) {
    let fields = await this.dataLoaderService.field.load(tableId);
    if (projection) {
      const projectionFieldKeys = Object.entries(projection)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (projectionFieldKeys.length) {
        fields = fields.filter((field) => projectionFieldKeys.includes(field[fieldKeyType]));
      }
    }

    return fields.map((field) => createFieldInstanceByRaw(field));
  }

  private async getCachePreviewUrlTokenMap(
    records: ISnapshotBase<IRecord>[],
    fields: IFieldInstance[],
    fieldKeyType: FieldKeyType
  ) {
    const previewToken: string[] = [];
    for (const field of fields) {
      if (field.type === FieldType.Attachment) {
        const fieldKey = field[fieldKeyType];
        for (const record of records) {
          const cellValue = record.data.fields[fieldKey];
          if (cellValue == null) continue;
          (cellValue as IAttachmentCellValue).forEach((item) => {
            if (item.mimetype.startsWith('image/') && item.width && item.height) {
              const { smThumbnailPath, lgThumbnailPath } = generateTableThumbnailPath(item.path);
              previewToken.push(getTableThumbnailToken(smThumbnailPath));
              previewToken.push(getTableThumbnailToken(lgThumbnailPath));
            }
            previewToken.push(item.token);
          });
        }
      }
    }
    // limit 1000 one handle
    const tokenMap: Record<string, string> = {};
    for (let i = 0; i < previewToken.length; i += 1000) {
      const tokenBatch = previewToken.slice(i, i + 1000);
      const previewUrls = await this.cacheService.getMany(
        tokenBatch.map((token) => `attachment:preview:${token}` as const)
      );
      previewUrls.forEach((url, index) => {
        if (url) {
          tokenMap[previewToken[i + index]] = url.url;
        }
      });
    }
    return tokenMap;
  }

  private async getThumbnailPathTokenMap(
    records: ISnapshotBase<IRecord>[],
    fields: IFieldInstance[],
    fieldKeyType: FieldKeyType
  ) {
    const thumbnailTokens: string[] = [];
    for (const field of fields) {
      if (field.type === FieldType.Attachment) {
        const fieldKey = field[fieldKeyType];
        for (const record of records) {
          const cellValue = record.data.fields[fieldKey];
          if (cellValue == null) continue;
          (cellValue as IAttachmentCellValue).forEach((item) => {
            if (item.mimetype.startsWith('image/') && item.width && item.height) {
              thumbnailTokens.push(getTableThumbnailToken(item.token));
            }
          });
        }
      }
    }
    if (thumbnailTokens.length === 0) {
      return {};
    }
    const attachments = await this.prismaService.txClient().attachments.findMany({
      where: { token: { in: thumbnailTokens } },
      select: { token: true, thumbnailPath: true },
    });
    return attachments.reduce<
      Record<
        string,
        | {
            sm?: string;
            lg?: string;
          }
        | undefined
      >
    >((acc, cur) => {
      acc[cur.token] = cur.thumbnailPath ? JSON.parse(cur.thumbnailPath) : undefined;
      return acc;
    }, {});
  }

  @Timing()
  private async recordsPresignedUrl(
    records: ISnapshotBase<IRecord>[],
    fields: IFieldInstance[],
    fieldKeyType: FieldKeyType
  ) {
    if (records.length === 0 || fields.findIndex((f) => f.type === FieldType.Attachment) === -1) {
      return records;
    }
    const cacheTokenUrlMap = await this.getCachePreviewUrlTokenMap(records, fields, fieldKeyType);
    const thumbnailPathTokenMap = await this.getThumbnailPathTokenMap(
      records,
      fields,
      fieldKeyType
    );
    for (const field of fields) {
      if (field.type === FieldType.Attachment) {
        const fieldKey = field[fieldKeyType];
        for (const record of records) {
          const cellValue = record.data.fields[fieldKey];
          const presignedCellValue = await this.getAttachmentPresignedCellValue(
            cellValue as IAttachmentCellValue,
            cacheTokenUrlMap,
            thumbnailPathTokenMap
          );
          if (presignedCellValue == null) continue;

          record.data.fields[fieldKey] = presignedCellValue;
        }
      }
    }
    return records;
  }

  async getAttachmentPresignedCellValue(
    cellValue: IAttachmentCellValue | null,
    cacheTokenUrlMap?: Record<string, string>,
    thumbnailPathTokenMap?: Record<string, { sm?: string; lg?: string } | undefined>
  ) {
    if (cellValue == null) {
      return null;
    }

    return await Promise.all(
      cellValue.map(async (item) => {
        const { path, mimetype, token } = item;
        const presignedUrl =
          cacheTokenUrlMap?.[token] ??
          (await this.attachmentStorageService.getPreviewUrlByPath(
            StorageAdapter.getBucket(UploadType.Table),
            path,
            token,
            undefined,
            {
              'Content-Type': mimetype,
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
            }
          ));
        let smThumbnailUrl: string | undefined;
        let lgThumbnailUrl: string | undefined;
        if (thumbnailPathTokenMap && thumbnailPathTokenMap[token]) {
          const { sm: smThumbnailPath, lg: lgThumbnailPath } = thumbnailPathTokenMap[token]!;
          if (smThumbnailPath) {
            smThumbnailUrl =
              cacheTokenUrlMap?.[getTableThumbnailToken(smThumbnailPath)] ??
              (await this.attachmentStorageService.getTableThumbnailUrl(smThumbnailPath, mimetype));
          }
          if (lgThumbnailPath) {
            lgThumbnailUrl =
              cacheTokenUrlMap?.[getTableThumbnailToken(lgThumbnailPath)] ??
              (await this.attachmentStorageService.getTableThumbnailUrl(lgThumbnailPath, mimetype));
          }
        }
        const isImage = mimetype.startsWith('image/');
        return {
          ...item,
          presignedUrl,
          smThumbnailUrl: isImage ? smThumbnailUrl || presignedUrl : undefined,
          lgThumbnailUrl: isImage ? lgThumbnailUrl || presignedUrl : undefined,
        };
      })
    );
  }

  private async getSnapshotBulkInner(
    builder: Knex.QueryBuilder,
    viewQueryDbTableName: string,
    query: {
      tableId: string;
      recordIds: string[];
      projection?: { [fieldNameOrId: string]: boolean };
      fieldKeyType: FieldKeyType;
      cellFormat: CellFormat;
    }
  ): Promise<ISnapshotBase<IRecord>[]> {
    const { tableId, recordIds, projection, fieldKeyType, cellFormat } = query;
    const fields = await this.getFieldsByProjection(tableId, projection, fieldKeyType);
    const fieldNames = fields.map((f) => f.dbFieldName).concat(Array.from(preservedDbFieldNames));
    const nativeQuery = builder
      .from(viewQueryDbTableName)
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

    const primaryField = await this.getPrimaryField(tableId);

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

  async getSnapshotBulkWithPermission(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id, // for convince of collaboration, getSnapshotBulk use id as field key by default.
    cellFormat = CellFormat.Json
  ) {
    const dbTableName = await this.getDbTableName(tableId);
    const { viewCte, builder } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        keepPrimaryKey: true,
      }
    );
    const viewQueryDbTableName = viewCte ?? dbTableName;
    return this.getSnapshotBulkInner(builder, viewQueryDbTableName, {
      tableId,
      recordIds,
      projection,
      fieldKeyType,
      cellFormat,
    });
  }

  async getSnapshotBulk(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id, // for convince of collaboration, getSnapshotBulk use id as field key by default.
    cellFormat = CellFormat.Json
  ): Promise<ISnapshotBase<IRecord>[]> {
    const dbTableName = await this.getDbTableName(tableId);
    return this.getSnapshotBulkInner(this.knex.queryBuilder(), dbTableName, {
      tableId,
      recordIds,
      projection,
      fieldKeyType,
      cellFormat,
    });
  }

  async getDocIdsByQuery(
    tableId: string,
    query: IGetRecordsRo
  ): Promise<{ ids: string[]; extra?: IExtraResult }> {
    const { skip, take = 100, ignoreViewQuery } = query;

    if (identify(tableId) !== IdPrefix.Table) {
      throw new InternalServerErrorException('query collection must be table id');
    }

    if (take > 1000) {
      throw new BadRequestException(`limit can't be greater than ${take}`);
    }

    const viewId = ignoreViewQuery ? undefined : query.viewId;
    const {
      groupPoints,
      allGroupHeaderRefs,
      filter: filterWithGroup,
    } = await this.getGroupRelatedData(tableId, {
      ...query,
      viewId,
    });
    const { queryBuilder, dbTableName, viewCte } = await this.buildFilterSortQuery(tableId, {
      ...query,
      filter: filterWithGroup,
    });
    const selectDbTableName = viewCte ?? dbTableName;

    queryBuilder.select(this.knex.ref(`${selectDbTableName}.__id`));

    skip && queryBuilder.offset(skip);
    if (take !== -1) {
      queryBuilder.limit(take);
    }

    this.logger.debug('getRecordsQuery: %s', queryBuilder.toQuery());
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(queryBuilder.toQuery());
    const ids = result.map((r) => r.__id);

    const {
      builder: searchWrapBuilder,
      viewCte: searchViewCte,
      enabledFieldIds,
    } = await this.recordPermissionService.wrapView(tableId, this.knex.queryBuilder(), {
      keepPrimaryKey: Boolean(query.filterLinkCellSelected),
      viewId,
    });
    // this search step should not abort the query
    const searchBuilder = searchViewCte
      ? searchWrapBuilder.from(searchViewCte)
      : this.knex(dbTableName);
    try {
      const searchHitIndex = await this.getSearchHitIndex(
        tableId,
        {
          ...query,
          projection: query.projection
            ? query.projection.filter((id) => enabledFieldIds?.includes(id))
            : enabledFieldIds,
          viewId,
        },
        searchBuilder.whereIn('__id', ids),
        enabledFieldIds
      );
      return { ids, extra: { groupPoints, searchHitIndex, allGroupHeaderRefs } };
    } catch (e) {
      this.logger.error(`Get search index error: ${(e as Error).message}`, (e as Error)?.stack);
    }

    return { ids, extra: { groupPoints, allGroupHeaderRefs } };
  }

  async getSearchFields(
    originFieldInstanceMap: Record<string, IFieldInstance>,
    search?: [string, string?, boolean?],
    viewId?: string,
    projection?: string[]
  ) {
    const maxSearchFieldCount = process.env.MAX_SEARCH_FIELD_COUNT
      ? toNumber(process.env.MAX_SEARCH_FIELD_COUNT)
      : DEFAULT_MAX_SEARCH_FIELD_COUNT;
    let viewColumnMeta: IGridColumnMeta | null = null;
    const fieldInstanceMap = projection?.length === 0 ? {} : { ...originFieldInstanceMap };
    if (!search) {
      return [] as IFieldInstance[];
    }

    const isSearchAllFields = !search?.[1];

    if (viewId) {
      const { columnMeta: viewColumnRawMeta } =
        (await this.prismaService.view.findUnique({
          where: { id: viewId, deletedTime: null },
          select: { columnMeta: true },
        })) || {};

      viewColumnMeta = viewColumnRawMeta ? JSON.parse(viewColumnRawMeta) : null;

      if (viewColumnMeta) {
        Object.entries(viewColumnMeta).forEach(([key, value]) => {
          if (get(value, ['hidden'])) {
            delete fieldInstanceMap[key];
          }
        });
      }
    }

    if (projection?.length) {
      Object.keys(fieldInstanceMap).forEach((fieldId) => {
        if (!projection.includes(fieldId)) {
          delete fieldInstanceMap[fieldId];
        }
      });
    }

    return uniqBy(
      orderBy(
        Object.values(fieldInstanceMap)
          .map((field) => ({
            ...field,
            isStructuredCellValue: field.isStructuredCellValue,
          }))
          .filter((field) => {
            if (!viewColumnMeta) {
              return true;
            }
            return !viewColumnMeta?.[field.id]?.hidden;
          })
          .filter((field) => {
            if (!projection) {
              return true;
            }
            return projection.includes(field.id);
          })
          .filter((field) => {
            if (isSearchAllFields) {
              return true;
            }

            const searchArr = search?.[1]?.split(',') || [];
            return searchArr.includes(field.id);
          })
          .filter((field) => {
            if (
              [CellValueType.Boolean, CellValueType.DateTime].includes(field.cellValueType) &&
              isSearchAllFields
            ) {
              return false;
            }
            if (field.cellValueType === CellValueType.Boolean) {
              return false;
            }
            return true;
          })
          .filter((field) => {
            if (field.type === FieldType.Button) {
              return false;
            }
            return true;
          })
          .map((field) => {
            return {
              ...field,
              order: viewColumnMeta?.[field.id]?.order ?? Number.MIN_SAFE_INTEGER,
            };
          }),
        ['order', 'createTime']
      ),
      'id'
    ).slice(0, maxSearchFieldCount) as unknown as IFieldInstance[];
  }

  private async getSearchHitIndex(
    tableId: string,
    query: IGetRecordsRo,
    builder: Knex.QueryBuilder,
    enabledFieldIds?: string[]
  ) {
    const { search, viewId, projection, ignoreViewQuery } = query;

    if (!search) {
      return null;
    }

    const fieldsRaw = await this.dataLoaderService.field.load(tableId, {
      id: enabledFieldIds,
    });

    const fieldInstances = fieldsRaw.map((field) => createFieldInstanceByRaw(field));
    const fieldInstanceMap = fieldInstances.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );
    const searchFields = await this.getSearchFields(
      fieldInstanceMap,
      search,
      ignoreViewQuery ? undefined : viewId,
      projection
    );

    const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);

    if (searchFields.length === 0) {
      return null;
    }

    const newQuery = this.knex
      .with('current_page_records', builder)
      .with('search_index', (qb) => {
        this.dbProvider.searchIndexQuery(
          qb,
          'current_page_records',
          searchFields,
          {
            search,
          },
          tableIndex,
          undefined,
          undefined,
          undefined
        );
      })
      .from('search_index');
    const result = await this.prismaService.$queryRawUnsafe<{ __id: string; fieldId: string }[]>(
      newQuery.toQuery()
    );

    if (!result.length) {
      return null;
    }

    return result.map((res) => ({
      fieldId: res.fieldId,
      recordId: res.__id,
    }));
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
      orderBy,
      search,
      groupBy,
      collapsedGroupIds,
      fieldKeyType,
      cellFormat,
      projection,
      viewId,
      ignoreViewQuery,
      filterLinkCellCandidate,
      filterLinkCellSelected,
    } = query;

    const fields = await this.getFieldsByProjection(
      tableId,
      this.convertProjection(projection),
      fieldKeyType
    );
    const fieldNames = fields.map((f) => f.dbFieldName);

    const { filter: filterWithGroup } = await this.getGroupRelatedData(tableId, query);

    const { queryBuilder } = await this.buildFilterSortQuery(tableId, {
      viewId,
      ignoreViewQuery,
      filter: filterWithGroup,
      orderBy,
      search,
      groupBy,
      collapsedGroupIds,
      filterLinkCellCandidate,
      filterLinkCellSelected,
    });
    queryBuilder.select(fieldNames.concat('__id'));
    skip && queryBuilder.offset(skip);
    take !== -1 && take && queryBuilder.limit(take);

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

  private async getPrimaryField(tableId: string) {
    const field = await this.dataLoaderService.field.load(tableId, {
      isPrimary: [true],
    });
    if (!field.length) {
      throw new BadRequestException(`Could not find primary index ${tableId}`);
    }
    return createFieldInstanceByRaw(field[0]);
  }

  async getRecordsHeadWithTitles(tableId: string, titles: string[]) {
    const dbTableName = await this.getDbTableName(tableId);
    const field = await this.getPrimaryField(tableId);

    // only text field support type cast to title
    if (field.dbFieldType !== DbFieldType.Text) {
      return [];
    }

    const queryBuilder = this.knex(dbTableName)
      .select({ title: field.dbFieldName, id: '__id' })
      .whereIn(field.dbFieldName, titles);

    const querySql = queryBuilder.toQuery();

    return this.prismaService.txClient().$queryRawUnsafe<{ id: string; title: string }[]>(querySql);
  }

  async getRecordsHeadWithIds(tableId: string, recordIds: string[]) {
    const dbTableName = await this.getDbTableName(tableId);
    const field = await this.getPrimaryField(tableId);

    const queryBuilder = this.knex(dbTableName)
      .select({ title: field.dbFieldName, id: '__id' })
      .whereIn('__id', recordIds);

    const querySql = queryBuilder.toQuery();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id: string; title: unknown }[]>(querySql);

    return result.map((r) => ({
      id: r.id,
      title: field.cellValue2String(r.title),
    }));
  }

  async filterRecordIdsByFilter(
    tableId: string,
    recordIds: string[],
    filter?: IFilter | null
  ): Promise<string[]> {
    const { queryBuilder, dbTableName, viewCte } = await this.buildFilterSortQuery(tableId, {
      filter,
    });
    const dbName = viewCte ?? dbTableName;
    queryBuilder.whereIn(`${dbName}.__id`, recordIds);
    queryBuilder.select(this.knex.ref(`${dbName}.__id`));
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(queryBuilder.toQuery());
    return result.map((r) => r.__id);
  }

  async getDiffIdsByIdAndFilter(tableId: string, recordIds: string[], filter?: IFilter | null) {
    const ids = await this.filterRecordIdsByFilter(tableId, recordIds, filter);
    return difference(recordIds, ids);
  }

  @Timing()
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async groupDbCollection2GroupPoints(
    groupResult: { [key: string]: unknown; __c: number }[],
    groupFields: IFieldInstance[],
    collapsedGroupIds: string[] | undefined,
    rowCount: number
  ) {
    const groupPoints: IGroupPoint[] = [];
    const allGroupHeaderRefs: IGroupHeaderRef[] = [];
    const collapsedGroupIdsSet = new Set(collapsedGroupIds);
    let fieldValues: unknown[] = [Symbol(), Symbol(), Symbol()];
    let curRowCount = 0;
    let collapsedDepth = Number.MAX_SAFE_INTEGER;

    for (let i = 0; i < groupResult.length; i++) {
      const item = groupResult[i];
      const { __c: count } = item;

      for (let index = 0; index < groupFields.length; index++) {
        const field = groupFields[index];
        const { id, dbFieldName } = field;
        const fieldValue = convertValueToStringify(item[dbFieldName]);

        if (fieldValues[index] === fieldValue) continue;

        const flagString = `${id}_${[...fieldValues.slice(0, index), fieldValue].join('_')}`;
        const groupId = String(string2Hash(flagString));

        allGroupHeaderRefs.push({ id: groupId, depth: index });

        if (index > collapsedDepth) break;

        // Reset the collapsedDepth when encountering the next peer grouping
        collapsedDepth = Number.MAX_SAFE_INTEGER;

        fieldValues[index] = fieldValue;
        fieldValues = fieldValues.map((value, idx) => (idx > index ? Symbol() : value));

        const isCollapsedInner = collapsedGroupIdsSet.has(groupId) ?? false;
        let value = field.convertDBValue2CellValue(fieldValue);

        if (field.type === FieldType.Attachment) {
          value = await this.getAttachmentPresignedCellValue(value as IAttachmentCellValue);
        }

        groupPoints.push({
          id: groupId,
          type: GroupPointType.Header,
          depth: index,
          value,
          isCollapsed: isCollapsedInner,
        });

        if (isCollapsedInner) {
          collapsedDepth = index;
        }
      }

      curRowCount += Number(count);
      if (collapsedDepth !== Number.MAX_SAFE_INTEGER) continue;
      groupPoints.push({ type: GroupPointType.Row, count: Number(count) });
    }

    if (curRowCount < rowCount) {
      groupPoints.push(
        {
          id: 'unknown',
          type: GroupPointType.Header,
          depth: 0,
          value: 'Unknown',
          isCollapsed: false,
        },
        { type: GroupPointType.Row, count: rowCount - curRowCount }
      );
    }

    return {
      groupPoints,
      allGroupHeaderRefs,
    };
  }

  private getFilterByCollapsedGroup({
    groupBy,
    groupPoints,
    fieldInstanceMap,
    collapsedGroupIds,
  }: {
    groupBy: IGroup;
    groupPoints: IGroupPointsVo;
    fieldInstanceMap: Record<string, IFieldInstance>;
    collapsedGroupIds?: string[];
  }) {
    if (!groupBy?.length || groupPoints == null || collapsedGroupIds == null) return null;
    const groupIds: string[] = [];
    const groupId2DataMap = groupPoints.reduce(
      (prev, cur) => {
        if (cur.type !== GroupPointType.Header) {
          return prev;
        }
        const { id, depth } = cur;

        groupIds[depth] = id;
        prev[id] = { ...cur, path: groupIds.slice(0, depth + 1) };
        return prev;
      },
      {} as Record<string, IGroupHeaderPoint & { path: string[] }>
    );

    const filterQuery: IFilter = {
      conjunction: and.value,
      filterSet: [],
    };

    for (const groupId of collapsedGroupIds) {
      const groupData = groupId2DataMap[groupId];

      if (groupData == null) continue;

      const { path } = groupData;
      const innerFilterSet: IFilterSet = {
        conjunction: or.value,
        filterSet: [],
      };

      path.forEach((pathGroupId) => {
        const pathGroupData = groupId2DataMap[pathGroupId];

        if (pathGroupData == null) return;

        const { depth } = pathGroupData;
        const curGroup = groupBy[depth];

        if (curGroup == null) return;

        const { fieldId } = curGroup;
        const field = fieldInstanceMap[fieldId];

        if (field == null) return;

        const filterItem = generateFilterItem(field, pathGroupData.value);
        innerFilterSet.filterSet.push(filterItem);
      });

      filterQuery.filterSet.push(innerFilterSet);
    }

    return filterQuery;
  }

  async getRowCountByFilter(
    dbTableName: string,
    fieldInstanceMap: Record<string, IFieldInstance>,
    tableId: string,
    filter?: IFilter,
    search?: [string, string?, boolean?],
    viewId?: string
  ) {
    const withUserId = this.cls.get('user.id');
    const queryBuilder = this.knex(dbTableName);

    if (filter) {
      this.dbProvider
        .filterQuery(queryBuilder, fieldInstanceMap, filter, { withUserId })
        .appendQueryBuilder();
    }

    if (search && search[2]) {
      const searchFields = await this.getSearchFields(fieldInstanceMap, search, viewId);
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(builder, dbTableName, searchFields, tableIndex, search);
      });
    }

    const rowCountSql = queryBuilder.count({ count: '*' });
    const result = await this.prismaService.$queryRawUnsafe<{ count?: number }[]>(
      rowCountSql.toQuery()
    );
    return Number(result[0].count);
  }

  public async getGroupRelatedData(tableId: string, query?: IGetRecordsRo) {
    const { groupBy: extraGroupBy, filter, search, ignoreViewQuery, queryId } = query || {};
    let groupPoints: IGroupPoint[] = [];
    let allGroupHeaderRefs: IGroupHeaderRef[] = [];
    let collapsedGroupIds = query?.collapsedGroupIds;

    if (queryId) {
      const cacheKey = `query-params:${queryId}` as const;
      const cache = await this.cacheService.get(cacheKey);
      if (cache) {
        collapsedGroupIds = (cache.queryParams as IGetRecordsRo)?.collapsedGroupIds;
      }
    }

    const fullGroupBy = parseGroup(extraGroupBy);

    if (!fullGroupBy?.length) {
      return {
        groupPoints,
        filter,
      };
    }

    const viewId = ignoreViewQuery ? undefined : query?.viewId;
    const viewRaw = await this.getTinyView(tableId, viewId);
    const { viewCte, builder, enabledFieldIds } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        keepPrimaryKey: Boolean(query?.filterLinkCellSelected),
        viewId,
      }
    );
    const fieldInstanceMap = (await this.getNecessaryFieldMap(
      tableId,
      filter,
      undefined,
      fullGroupBy,
      search,
      enabledFieldIds
    ))!;
    const groupBy = fullGroupBy.filter((item) => fieldInstanceMap[item.fieldId]);

    if (!groupBy?.length) {
      return {
        groupPoints,
        filter,
      };
    }

    const dbTableName = await this.getDbTableName(tableId);

    const filterStr = viewRaw?.filter;
    const mergedFilter = mergeWithDefaultFilter(filterStr, filter);
    const groupFieldIds = groupBy.map((item) => item.fieldId);

    const viewQueryDbTableName = viewCte ?? dbTableName;
    const queryBuilder = builder.from(viewQueryDbTableName);

    if (mergedFilter) {
      const withUserId = this.cls.get('user.id');
      this.dbProvider
        .filterQuery(queryBuilder, fieldInstanceMap, mergedFilter, { withUserId })
        .appendQueryBuilder();
    }

    if (search && search[2]) {
      const searchFields = await this.getSearchFields(fieldInstanceMap, search, viewId);
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(
          builder,
          viewQueryDbTableName,
          searchFields,
          tableIndex,
          search
        );
      });
    }

    this.dbProvider.sortQuery(queryBuilder, fieldInstanceMap, groupBy).appendSortBuilder();
    this.dbProvider.groupQuery(queryBuilder, fieldInstanceMap, groupFieldIds).appendGroupBuilder();

    queryBuilder.count({ __c: '*' }).limit(this.thresholdConfig.maxGroupPoints);

    const groupSql = queryBuilder.toQuery();
    const groupFields = groupFieldIds.map((fieldId) => fieldInstanceMap[fieldId]).filter(Boolean);
    const rowCount = await this.getRowCountByFilter(
      dbTableName,
      fieldInstanceMap,
      tableId,
      mergedFilter,
      search,
      viewId
    );

    try {
      const result =
        await this.prismaService.$queryRawUnsafe<{ [key: string]: unknown; __c: number }[]>(
          groupSql
        );
      const pointsResult = await this.groupDbCollection2GroupPoints(
        result,
        groupFields,
        collapsedGroupIds,
        rowCount
      );
      groupPoints = pointsResult.groupPoints;
      allGroupHeaderRefs = pointsResult.allGroupHeaderRefs;
    } catch (error) {
      console.log(`Get group points error in table ${tableId}: `, error);
    }

    const filterWithCollapsed = this.getFilterByCollapsedGroup({
      groupBy,
      groupPoints,
      fieldInstanceMap,
      collapsedGroupIds,
    });

    return { groupPoints, allGroupHeaderRefs, filter: mergeFilter(filter, filterWithCollapsed) };
  }

  async getRecordStatus(
    tableId: string,
    recordId: string,
    query: IGetRecordsRo
  ): Promise<IRecordStatusVo> {
    const dbTableName = await this.getDbTableName(tableId);
    const queryBuilder = this.knex(dbTableName).select('__id').where('__id', recordId).limit(1);

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(queryBuilder.toQuery());

    const isDeleted = result.length === 0;

    if (isDeleted) {
      return { isDeleted, isVisible: false };
    }

    const queryResult = await this.getDocIdsByQuery(tableId, {
      ignoreViewQuery: query.ignoreViewQuery ?? false,
      viewId: query.viewId,
      skip: query.skip,
      take: query.take,
      filter: query.filter,
      orderBy: query.orderBy,
      search: query.search,
      groupBy: query.groupBy,
      filterLinkCellCandidate: query.filterLinkCellCandidate,
      filterLinkCellSelected: query.filterLinkCellSelected,
      selectedRecordIds: query.selectedRecordIds,
    });
    const isVisible = queryResult.ids.includes(recordId);
    return { isDeleted, isVisible };
  }
}
