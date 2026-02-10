/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type {
  CreatedByFieldCore,
  FieldCore,
  IAttachmentCellValue,
  IColumnMeta,
  IExtraResult,
  IFilter,
  IFilterItem,
  IFilterSet,
  IGridColumnMeta,
  IGroup,
  ILinkFieldOptions,
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
  StatisticsFunc,
  TableDomain,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  CreateRecordAction,
  ICreateRecordsRo,
  IGetRecordQuery,
  IGetRecordsRo,
  IGroupHeaderPoint,
  IGroupHeaderRef,
  IGroupPoint,
  IGroupPointsVo,
  IRecordGetCollaboratorsRo,
  IRecordStatusVo,
  IRecordsVo,
  UpdateRecordAction,
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
import { Events } from '../../event-emitter/events';
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
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { BatchService } from '../calculation/batch.service';
import { DataLoaderService } from '../data-loader/data-loader.service';
import type { IVisualTableDefaultField } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { UserFieldDto } from '../field/model/field-dto/user-field.dto';
import { TableIndexService } from '../table/table-index.service';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from './query-builder';
import { RecordPermissionService } from './record-permission.service';

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
    private readonly dataLoaderService: DataLoaderService,
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Get the database column name to query for a field
   * For lookup formula fields, use the standard field name
   */
  private getQueryColumnName(field: IFieldInstance): string {
    return field.dbFieldName;
  }

  private dbRecord2RecordFields(
    record: IRecord['fields'],
    fields: IFieldInstance[],
    fieldKeyType: FieldKeyType = FieldKeyType.Id,
    cellFormat: CellFormat = CellFormat.Json
  ) {
    return fields.reduce<IRecord['fields']>((acc, field) => {
      const fieldNameOrId = field[fieldKeyType];
      const queryColumnName = this.getQueryColumnName(field);
      const dbCellValue = record[queryColumnName];
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
        throw new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.table.notFound',
          },
        });
      });
    return tableMeta.dbTableName;
  }

  private async getLinkCellIds(tableId: string, field: IFieldInstance, recordId: string) {
    const prisma = this.prismaService.txClient();
    const { dbTableName } = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    const { qb: queryBuilder } = await this.recordQueryBuilder.createRecordQueryBuilder(
      dbTableName,
      {
        tableId,
        viewId: undefined,
        restrictRecordIds: [recordId],
        useQueryModel: true,
      }
    );
    const sql = queryBuilder.where('__id', recordId).toQuery();

    const result = await prisma.$queryRawUnsafe<{ id: string; [key: string]: unknown }[]>(sql);
    return result
      .map((item) => {
        return field.convertDBValue2CellValue(item[field.dbFieldName]) as
          | ILinkCellValue
          | ILinkCellValue[];
      })
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
        throw new CustomHttpException(`Field ${fieldId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.field.notFound',
          },
        });
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
    alias: string,
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
        throw new CustomHttpException(`Field ${fieldId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.field.notFound',
          },
        });
      });

    const field = createFieldInstanceByRaw(fieldRaw);

    if (field.type !== FieldType.Link) {
      throw new CustomHttpException(
        'You can only filter by link field',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.onlyLinkFieldCanBeFiltered',
          },
        }
      );
    }
    const { foreignTableId, fkHostTableName, selfKeyName, foreignKeyName } = field.options;
    if (foreignTableId !== tableId) {
      throw new CustomHttpException(
        'Field is not linked to current table',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.notLinkedToCurrentTable',
          },
        }
      );
    }

    if (fkHostTableName !== dbTableName) {
      queryBuilder.leftJoin(
        `${fkHostTableName}`,
        `${alias}.__id`,
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
      queryBuilder.where(`${alias}.${selfKeyName}`, recordId);
      return;
    }
    queryBuilder.whereNotNull(`${alias}.${selfKeyName}`);
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
        throw new CustomHttpException(`Field ${fieldId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.field.notFound',
          },
        });
      });

    const field = createFieldInstanceByRaw(fieldRaw);

    if (field.type !== FieldType.Link) {
      throw new CustomHttpException(
        'You can only filter by link field',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.onlyLinkFieldCanBeFiltered',
          },
        }
      );
    }
    const { foreignTableId, fkHostTableName, selfKeyName, foreignKeyName, relationship } =
      field.options;
    if (foreignTableId !== tableId) {
      throw new CustomHttpException(
        'Field is not linked to current table',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.notLinkedToCurrentTable',
          },
        }
      );
    }
    if (relationship === Relationship.OneMany) {
      if (this.isJunctionTable(fkHostTableName)) {
        queryBuilder.whereNotIn('__id', function () {
          this.select(foreignKeyName).from(fkHostTableName);
          if (recordId) {
            this.whereNot(selfKeyName, recordId);
          }
        });
      } else {
        queryBuilder.where(function () {
          this.whereNull(selfKeyName);
          if (recordId) {
            this.orWhere(selfKeyName, recordId);
          }
        });
      }
    }
    if (relationship === Relationship.OneOne) {
      if (selfKeyName === '__id') {
        queryBuilder.whereNotIn('__id', function () {
          this.select(foreignKeyName).from(fkHostTableName).whereNotNull(foreignKeyName);
          if (recordId) {
            this.whereNot(selfKeyName, recordId);
          }
        });
      } else {
        queryBuilder.where(function () {
          this.whereNull(selfKeyName);
          if (recordId) {
            this.orWhere(selfKeyName, recordId);
          }
        });
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
      // Always load full field metadata so filters can reference denied fields for read,
      // while projection limits applied later keep them hidden from results.
      const fields = await this.getFieldsByProjection(tableId, undefined);
      const allowedSet = projection?.length ? new Set(projection) : undefined;
      return fields.reduce(
        (map, field) => {
          if (allowedSet && !allowedSet.has(field.id)) {
            return map;
          }
          map[field.id] = field;
          map[field.name] = field;
          return map;
        },
        {} as Record<string, IFieldInstance>
      );
    }
  }

  private async sanitizeFilterByEnabledFields(
    tableId: string,
    filter: IFilter | undefined,
    enabledFieldIds?: string[]
  ): Promise<IFilter | undefined> {
    if (!filter || !enabledFieldIds?.length) {
      return filter;
    }
    const fields = await this.dataLoaderService.field.load(tableId);
    const keyToId = new Map<string, string>();
    for (const field of fields) {
      keyToId.set(field.id, field.id);
      keyToId.set(field.name, field.id);
      keyToId.set(field.dbFieldName, field.id);
    }
    const allowed = new Set(enabledFieldIds);

    const sanitize = (target: IFilter): IFilter | null => {
      if (!target) {
        return null;
      }

      const isFilterGroup = (value: unknown): value is IFilter =>
        !!value && typeof value === 'object' && 'filterSet' in value;

      const isFilterLeaf = (value: unknown): value is IFilterItem =>
        !!value && typeof value === 'object' && 'fieldId' in value;

      const sanitizedSet: NonNullable<IFilter>['filterSet'] = [];
      for (const item of target.filterSet) {
        if (isFilterGroup(item)) {
          const nested = sanitize(item);
          if (nested) {
            sanitizedSet.push(nested);
          }
          continue;
        }

        if (!isFilterLeaf(item)) {
          continue;
        }

        const candidateId = keyToId.get(item.fieldId) ?? item.fieldId;
        if (!allowed.has(candidateId)) {
          continue;
        }
        sanitizedSet.push({
          ...item,
          fieldId: candidateId,
        });
      }

      if (sanitizedSet.length === 0) {
        return null;
      }
      return {
        ...target,
        filterSet: sanitizedSet,
      };
    };

    const sanitized = sanitize(filter);
    return sanitized ?? undefined;
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
        throw new CustomHttpException(`View ${viewId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.view.notFound',
          },
        });
      });
  }

  public parseSearch(
    search: [string, string?, boolean?],
    fieldMap?: Record<string, IFieldInstance>
  ): [string, string?, boolean?] {
    const [searchValue, fieldId, hideNotMatchRow] = search;

    if (!fieldMap) {
      throw new CustomHttpException(
        'fieldMap is required when search is set',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.aggregation.fieldMapRequired',
          },
        }
      );
    }

    if (!fieldId) {
      return [searchValue, fieldId, hideNotMatchRow];
    }

    const fieldIds = fieldId?.split(',');

    fieldIds.forEach((id) => {
      const field = fieldMap[id];
      if (!field) {
        throw new CustomHttpException(`Field ${fieldId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.field.notFound',
          },
        });
      }
    });

    return [searchValue, fieldId, hideNotMatchRow];
  }

  private stringifyRawQueryDebugPayload(payload: unknown): string {
    try {
      return JSON.stringify(payload, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to stringify raw query debug payload: ${reason}`);
      return '[raw query debug payload: <unserializable>]';
    }
  }

  private handleRawQueryError(
    error: unknown,
    sql: string,
    debugContext: Record<string, unknown>
  ): never {
    const context = { sql, ...debugContext };
    const contextString = this.stringifyRawQueryDebugPayload(context);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      error.message = `${error.message}\nContext: ${contextString}`;
      Object.assign(error, context);
      this.logger.error(
        `Raw query known request error. Context: ${contextString}`,
        error.stack ?? undefined
      );
      throw error;
    }
    this.logger.error(
      `Raw query unexpected error. message: ${(error as Error)?.message}. Context: ${contextString}`,
      (error as Error)?.stack
    );
    if (error instanceof Error) {
      error.message = `${error.message}\nContext: ${contextString}`;
      Object.assign(error, context);
    }
    throw error;
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

    const view = await this.getTinyView(tableId, viewId);

    const mergedFilter = mergeWithDefaultFilter(view?.filter, extraFilter);
    const filter = await this.sanitizeFilterByEnabledFields(tableId, mergedFilter, enabledFieldIds);
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
      permissionBuilder: builder,
      dbTableName,
      viewCte,
      filter,
      search,
      orderBy,
      groupBy,
      fieldMap,
      enabledFieldIds,
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
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
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
      | 'skip'
      | 'take'
    >,
    useQueryModel = false
  ) {
    // Prepare the base query builder, filtering conditions, sorting rules, grouping rules and field mapping
    const {
      permissionBuilder,
      dbTableName,
      viewCte,
      filter,
      search,
      orderBy,
      groupBy,
      fieldMap,
      enabledFieldIds,
    } = await this.prepareQuery(tableId, query);

    const basicSortIndex = await this.getBasicOrderIndexField(dbTableName, query.viewId);

    const restrictRecordIds =
      query.selectedRecordIds && !query.filterLinkCellCandidate
        ? query.selectedRecordIds
        : undefined;

    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');
    const projectionIds = fieldMap
      ? Array.from(new Set(Object.values(fieldMap).map((f) => f.id))).filter(
          (id) => !enabledFieldIds || enabledFieldIds.includes(id)
        )
      : [];

    const { qb, alias, selectionMap } = await this.recordQueryBuilder.createRecordQueryBuilder(
      viewCte ?? dbTableName,
      {
        tableId,
        viewId: query.viewId,
        filter,
        currentUserId,
        sort: [...(groupBy ?? []), ...(orderBy ?? [])],
        // Only select fields required by filter/order/search to avoid touching unrelated columns
        projection: projectionIds,
        useQueryModel,
        limit: query.take,
        offset: query.skip,
        hasSearch: Boolean(search?.[2]),
        defaultOrderField: basicSortIndex,
        restrictRecordIds,
        builder: permissionBuilder,
      }
    );

    if (query.filterLinkCellSelected && query.filterLinkCellCandidate) {
      throw new CustomHttpException(
        'filterLinkCellSelected and filterLinkCellCandidate can not be set at the same time',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.aggregation.filterLinkCellQueryConflict',
          },
        }
      );
    }

    if (query.selectedRecordIds) {
      query.filterLinkCellCandidate
        ? qb.whereNotIn(`${alias}.__id`, query.selectedRecordIds)
        : qb.whereIn(`${alias}.__id`, query.selectedRecordIds);
    }

    if (query.filterLinkCellCandidate) {
      await this.buildLinkCandidateQuery(qb, tableId, query.filterLinkCellCandidate);
    }

    if (query.filterLinkCellSelected) {
      await this.buildLinkSelectedQuery(
        qb,
        tableId,
        dbTableName,
        alias,
        query.filterLinkCellSelected
      );
    }

    if (search && search[2] && fieldMap) {
      const searchFields = await this.getSearchFields(
        fieldMap,
        search,
        query?.viewId,
        enabledFieldIds
      );
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      qb.where((builder) => {
        this.dbProvider.searchQuery(builder, searchFields, tableIndex, search, { selectionMap });
      });
    }

    // ignore sorting when filterLinkCellSelected is set
    if (query.filterLinkCellSelected && Array.isArray(query.filterLinkCellSelected)) {
      await this.buildLinkSelectedSort(qb, alias, query.filterLinkCellSelected);
    } else {
      // view sorting added by default
      qb.orderBy(`${alias}.${basicSortIndex}`, 'asc');
    }

    // If you return `queryBuilder` directly and use `await` to receive it,
    // it will perform a query DB operation, which we obviously don't want to see here
    return { queryBuilder: qb, dbTableName, viewCte, alias };
  }

  convertProjection(fieldKeys?: string[]) {
    return fieldKeys?.reduce<Record<string, boolean>>((acc, cur) => {
      acc[cur] = true;
      return acc;
    }, {});
  }

  private async convertEnabledFieldIdsToProjection(
    tableId: string,
    enabledFieldIds?: string[],
    fieldKeyType: FieldKeyType = FieldKeyType.Id
  ) {
    if (!enabledFieldIds?.length) {
      return undefined;
    }

    if (fieldKeyType === FieldKeyType.Id) {
      return this.convertProjection(enabledFieldIds);
    }

    const fields = await this.dataLoaderService.field.load(tableId, {
      id: enabledFieldIds,
    });
    if (!fields.length) {
      return undefined;
    }

    const fieldKeys = fields
      .map((field) => field[fieldKeyType] as string | undefined)
      .filter((key): key is string => Boolean(key));

    return fieldKeys.length ? this.convertProjection(fieldKeys) : undefined;
  }

  async getRecordsById(
    tableId: string,
    recordIds: string[],
    withPermission = true,
    useQueryModel = true
  ): Promise<IRecordsVo> {
    const recordSnapshot = await this[
      withPermission ? 'getSnapshotBulkWithPermission' : 'getSnapshotBulk'
    ](tableId, recordIds, undefined, FieldKeyType.Id, undefined, useQueryModel);

    if (!recordSnapshot.length) {
      throw new CustomHttpException('Can not get record', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.record.notFound',
        },
      });
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

  async getRecords(
    tableId: string,
    query: IGetRecordsRo,
    useQueryModel = false
  ): Promise<IRecordsVo> {
    const queryResult = await this.getDocIdsByQuery(
      tableId,
      {
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
      },
      useQueryModel
    );

    const projection = query.projection
      ? this.convertProjection(query.projection)
      : await this.getViewProjection(tableId, query);

    const recordSnapshot = await this.getSnapshotBulkWithPermission(
      tableId,
      queryResult.ids,
      projection,
      query.fieldKeyType || FieldKeyType.Name,
      query.cellFormat,
      useQueryModel
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
    withPermission = true,
    useQueryModel = false
  ): Promise<IRecord> {
    const { projection, fieldKeyType = FieldKeyType.Name, cellFormat } = query;
    const recordSnapshot = await this[
      withPermission ? 'getSnapshotBulkWithPermission' : 'getSnapshotBulk'
    ](
      tableId,
      [recordId],
      this.convertProjection(projection),
      fieldKeyType,
      cellFormat,
      useQueryModel
    );

    if (!recordSnapshot.length) {
      throw new CustomHttpException('Can not get record', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.record.notFound',
        },
      });
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
      throw new CustomHttpException(
        `Some records to be deleted cannot be found, ids: ${difference(
          recordIds,
          recordRaw.map((r) => r.id)
        ).join(',')}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.record.deletedIdsNotFound',
          },
        }
      );
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

  @Timing()
  async getRecordIndexes(
    table: TableDomain,
    recordIds: string[],
    viewId?: string
  ): Promise<Record<string, number>[] | undefined> {
    const dbTableName = table.dbTableName;
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
    table: TableDomain,
    records: IRecordInnerRo[],
    fieldKeyType: FieldKeyType,
    fields: readonly FieldCore[]
  ) {
    const snapshots = await this.createBatch(table, records, fieldKeyType, fields);

    const dataList = snapshots.map((snapshot) => ({
      docId: snapshot.__id,
      version: snapshot.__version == null ? 0 : snapshot.__version - 1,
    }));

    this.batchService.saveRawOps(table.id, RawOpType.Create, IdPrefix.Record, dataList);
  }

  @Timing()
  async createRecordsOnlySql(
    table: TableDomain,
    records: {
      fields: Record<string, unknown>;
    }[]
  ) {
    const user = this.cls.get('user');
    const userId = user.id;
    await this.creditCheck(table.id);
    const dbTableName = table.dbTableName;
    const fields = await this.getFieldsByProjection(table.id);
    const auditUserValue =
      user &&
      UserFieldDto.fullAvatarUrl({
        id: user.id,
        title: user.name,
        email: user.email,
      });
    const createdByFields = fields.filter(
      (f) => f.type === FieldType.CreatedBy && f.shouldPersistAuditValue?.()
    ) as IFieldInstance[];
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
      if (auditUserValue && createdByFields.length) {
        createdByFields.forEach((field) => {
          fieldsValues[field.dbFieldName] = field.convertCellValue2DBValue({
            ...auditUserValue,
          });
        });
      }
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
      throw new CustomHttpException(
        `Exceed max row limit: ${maxRowCount}, please contact us to increase the limit`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.billing.exceedMaxRowLimit',
            context: {
              maxRowCount,
            },
          },
        }
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

  private hasPersistedLinkColumn(field: FieldCore) {
    if (field.type !== FieldType.Link) {
      return true;
    }

    const options = field.options as ILinkFieldOptions | undefined;
    if (!options) {
      return true;
    }

    const inferredForeignKeyName =
      options.foreignKeyName ??
      (options.relationship === Relationship.ManyOne || options.relationship === Relationship.OneOne
        ? field.dbFieldName
        : undefined);
    const inferredSelfKeyName =
      options.selfKeyName ??
      (options.relationship === Relationship.OneMany && options.isOneWay === false
        ? field.dbFieldName
        : undefined);

    return (
      field.dbFieldName !== inferredForeignKeyName && field.dbFieldName !== inferredSelfKeyName
    );
  }

  private async createBatch(
    table: TableDomain,
    records: IRecordInnerRo[],
    fieldKeyType: FieldKeyType,
    fields: readonly FieldCore[]
  ) {
    const userId = this.cls.get('user.id');
    await this.creditCheck(table.id);

    const { dbTableName, name: tableName } = table;
    const maxRecordOrder = await this.getMaxRecordOrder(dbTableName);

    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId: table.id, deletedTime: null },
      select: { id: true },
    });

    const allViewIndexes = await this.getAllViewIndexesField(dbTableName);

    const validationFields = fields
      .filter((f) => !f.isComputed)
      .filter((field) => field.notNull || field.unique)
      .filter((field) => this.hasPersistedLinkColumn(field));

    const user = this.cls.get('user');
    const auditUserValue =
      user &&
      UserFieldDto.fullAvatarUrl({
        id: user.id,
        title: user.name,
        email: user.email,
      });
    const createdByFields = fields.filter(
      (f) => f.type === FieldType.CreatedBy && (f as CreatedByFieldCore).shouldPersistAuditValue?.()
    );
    const cloneAuditUserValue = () => (auditUserValue ? { ...auditUserValue } : null);
    const sanitizeAuditUserValue = () => {
      const cloned = cloneAuditUserValue();
      if (cloned && typeof cloned === 'object' && 'avatarUrl' in cloned) {
        // Avatar URLs are derived; strip before persistence to keep storage lean
        delete (cloned as { avatarUrl?: string }).avatarUrl;
      }
      return cloned;
    };

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
        const auditFieldValues: Record<string, unknown> = {};

        if (auditUserValue && createdByFields.length) {
          createdByFields.forEach((field) => {
            auditFieldValues[field.dbFieldName] = sanitizeAuditUserValue();
          });
        }

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
          ...auditFieldValues,
        });
      });

    const sql = this.dbProvider.batchInsertSql(
      dbTableName,
      snapshots.map((s) => {
        return Object.entries(s).reduce(
          (acc, [key, value]) => {
            if (Array.isArray(value)) {
              acc[key] = JSON.stringify(value);
              return acc;
            }
            if (value && typeof value === 'object') {
              const isDate = (value as Date) instanceof Date;
              if (!isDate) {
                acc[key] = JSON.stringify(value);
                return acc;
              }
            }
            acc[key] = value;
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
      useQueryModel: boolean;
    }
  ): Promise<ISnapshotBase<IRecord>[]> {
    const { tableId, recordIds, projection, fieldKeyType, cellFormat } = query;
    const fields = await this.getFieldsByProjection(tableId, projection, fieldKeyType);
    const fieldIds = fields.map((f) => f.id);

    const { qb: queryBuilder } = await this.recordQueryBuilder.createRecordQueryBuilder(
      viewQueryDbTableName,
      {
        tableId,
        viewId: undefined,
        useQueryModel: query.useQueryModel,
        projection: fieldIds,
        restrictRecordIds: recordIds,
        builder,
      }
    );

    const nativeQuery = queryBuilder.whereIn('__id', recordIds).toQuery();

    this.logger.debug('getSnapshotBulkInner query %s', nativeQuery);

    let result: ({ [fieldName: string]: unknown } & IVisualTableDefaultField)[];
    try {
      result = await this.prismaService
        .txClient()
        .$queryRawUnsafe<
          ({ [fieldName: string]: unknown } & IVisualTableDefaultField)[]
        >(nativeQuery);
    } catch (error) {
      this.handleRawQueryError(error, nativeQuery, {
        tableId,
        viewQueryDbTableName,
        recordIdsCount: recordIds.length,
        recordIds: recordIds.slice(0, 20),
        projectionFieldIds: fieldIds,
        fieldKeyType,
        cellFormat,
        useQueryModel: query.useQueryModel,
      });
    }

    const recordIdsMap = recordIds.reduce(
      (acc, recordId, currentIndex) => {
        acc[recordId] = currentIndex;
        return acc;
      },
      {} as { [recordId: string]: number }
    );

    recordIds.forEach((recordId) => {
      if (!(recordId in recordIdsMap)) {
        throw new CustomHttpException(`Record ${recordId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.record.notFound',
          },
        });
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
    cellFormat = CellFormat.Json,
    useQueryModel = false
  ) {
    const dbTableName = await this.getDbTableName(tableId);
    const { viewCte, builder, enabledFieldIds } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        keepPrimaryKey: true,
      }
    );
    const viewQueryDbTableName = viewCte ?? dbTableName;
    const finalProjection =
      projection ??
      (await this.convertEnabledFieldIdsToProjection(tableId, enabledFieldIds, fieldKeyType));
    return this.getSnapshotBulkInner(builder, viewQueryDbTableName, {
      tableId,
      recordIds,
      projection: finalProjection,
      fieldKeyType,
      cellFormat,
      useQueryModel,
    });
  }

  async getSnapshotBulk(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    fieldKeyType: FieldKeyType = FieldKeyType.Id, // for convince of collaboration, getSnapshotBulk use id as field key by default.
    cellFormat = CellFormat.Json,
    useQueryModel = false
  ): Promise<ISnapshotBase<IRecord>[]> {
    const dbTableName = await this.getDbTableName(tableId);
    return this.getSnapshotBulkInner(this.knex.queryBuilder(), dbTableName, {
      tableId,
      recordIds,
      projection,
      fieldKeyType,
      cellFormat,
      useQueryModel,
    });
  }

  async getDocIdsByQuery(
    tableId: string,
    query: IGetRecordsRo,
    useQueryModel = false
  ): Promise<{ ids: string[]; extra?: IExtraResult }> {
    const { skip, take = 100, ignoreViewQuery } = query;

    if (identify(tableId) !== IdPrefix.Table) {
      throw new CustomHttpException(
        'Query collection must be table ID',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.aggregation.queryCollectionMustBeTableId',
          },
        }
      );
    }

    if (take > 1000) {
      throw new CustomHttpException(
        `The maximum search index result is 1000`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.aggregation.maxSearchIndexResult',
          },
        }
      );
    }

    const viewId = ignoreViewQuery ? undefined : query.viewId;
    const {
      groupPoints,
      allGroupHeaderRefs,
      filter: filterWithGroup,
    } = await this.getGroupRelatedData(
      tableId,
      {
        ...query,
        viewId,
      },
      useQueryModel
    );
    const { queryBuilder, dbTableName } = await this.buildFilterSortQuery(
      tableId,
      {
        ...query,
        filter: filterWithGroup,
      },
      useQueryModel
    );
    // queryBuilder.select(this.knex.ref(`${selectDbTableName}.__id`));

    skip && queryBuilder.offset(skip);
    if (take !== -1) {
      queryBuilder.limit(take);
    }

    const sqlNative = queryBuilder.toSQL().toNative();
    const sqlDebug = queryBuilder.toQuery();
    this.logger.debug('getRecordsQuery: %s', sqlDebug);
    let result: { __id: string }[];
    try {
      result = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ __id: string }[]>(sqlNative.sql, ...sqlNative.bindings);
    } catch (error) {
      this.handleRawQueryError(error, sqlNative.sql, {
        tableId,
        dbTableName,
        viewId,
        ignoreViewQuery,
        useQueryModel,
        take,
        skip,
        orderBy: query.orderBy,
        groupBy: query.groupBy,
        filter: filterWithGroup,
        search: query.search,
        filterLinkCellCandidate: query.filterLinkCellCandidate,
        filterLinkCellSelected: query.filterLinkCellSelected,
        selectedRecordIds: query.selectedRecordIds,
        bindings: sqlNative.bindings,
        sqlDebug,
      });
    }
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
            ? enabledFieldIds
              ? query.projection.filter((id) => enabledFieldIds.includes(id))
              : query.projection
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

    const searchQuery = newQuery.toQuery();

    this.logger.debug('getSearchHitIndex query: %s', searchQuery);

    const result =
      await this.prismaService.$queryRawUnsafe<{ __id: string; fieldId: string }[]>(searchQuery);

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
    query: IGetRecordsRo,
    useQueryModel = true
  ): Promise<Pick<IRecord, 'id' | 'fields'>[]> {
    if (identify(tableId) !== IdPrefix.Table) {
      throw new CustomHttpException(
        'Query collection must be table ID',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.aggregation.queryCollectionMustBeTableId',
          },
        }
      );
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

    const { filter: filterWithGroup } = await this.getGroupRelatedData(tableId, query);

    const { queryBuilder } = await this.buildFilterSortQuery(
      tableId,
      {
        viewId,
        ignoreViewQuery,
        filter: filterWithGroup,
        orderBy,
        search,
        groupBy,
        collapsedGroupIds,
        filterLinkCellCandidate,
        filterLinkCellSelected,
        skip,
        take,
      },
      useQueryModel
    );
    skip && queryBuilder.offset(skip);
    take !== -1 && take && queryBuilder.limit(take);
    const sql = queryBuilder.toQuery();

    this.logger.debug('getRecordsFields query: %s', sql);

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<(Pick<IRecord, 'fields'> & Pick<IVisualTableDefaultField, '__id'>)[]>(sql);

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
      throw new CustomHttpException(
        `Could not find primary field in table ${tableId}`,
        HttpErrorCode.NOT_FOUND,
        {
          localization: {
            i18nKey: 'httpErrors.table.notFoundPrimaryField',
          },
        }
      );
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
    const { queryBuilder, alias } = await this.buildFilterSortQuery(
      tableId,
      {
        filter,
      },
      true
    );
    queryBuilder.whereIn(`${alias}.__id`, recordIds);
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
    groupBy: IGroup | undefined,
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
    viewId?: string,
    useQueryModel = false
  ) {
    const withUserId = this.cls.get('user.id');
    const wrap = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      viewId
        ? {
            viewId,
          }
        : undefined
    );

    const { qb, selectionMap } = await this.recordQueryBuilder.createRecordAggregateBuilder(
      wrap.viewCte ?? dbTableName,
      {
        tableId,
        aggregationFields: [],
        viewId,
        filter,
        currentUserId: withUserId,
        useQueryModel,
        builder: wrap.builder,
      }
    );

    if (search && search[2]) {
      const searchFields = await this.getSearchFields(
        fieldInstanceMap,
        search,
        viewId,
        wrap.enabledFieldIds
      );
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      qb.where((builder) => {
        this.dbProvider.searchQuery(builder, searchFields, tableIndex, search, { selectionMap });
      });
    }

    const rowCountSql = qb.count({ count: '*' });
    const sql = rowCountSql.toQuery();
    this.logger.debug('getRowCountSql: %s', sql);
    const result = await this.prismaService.$queryRawUnsafe<{ count?: number }[]>(sql);
    return Number(result[0].count);
  }

  public async getGroupRelatedData(tableId: string, query?: IGetRecordsRo, useQueryModel = false) {
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
    const {
      viewCte,
      builder: permissionBuilder,
      enabledFieldIds,
    } = await this.recordPermissionService.wrapView(tableId, this.knex.queryBuilder(), {
      keepPrimaryKey: Boolean(query?.filterLinkCellSelected),
      viewId,
    });
    const fieldInstanceMap = (await this.getNecessaryFieldMap(
      tableId,
      filter,
      undefined,
      fullGroupBy,
      search,
      enabledFieldIds
    ))!;
    const enabledFieldIdSet = enabledFieldIds ? new Set(enabledFieldIds) : undefined;
    const groupBy = fullGroupBy.filter(
      (item) =>
        fieldInstanceMap[item.fieldId] &&
        (!enabledFieldIdSet || enabledFieldIdSet.has(item.fieldId))
    );

    if (!groupBy?.length) {
      return {
        groupPoints,
        filter,
        builder: permissionBuilder,
      };
    }

    const dbTableName = await this.getDbTableName(tableId);

    const filterStr = viewRaw?.filter;
    const mergedFilter = mergeWithDefaultFilter(filterStr, filter);
    const groupFieldIds = groupBy.map((item) => item.fieldId);

    const withUserId = this.cls.get('user.id');
    const shouldUseQueryModel = useQueryModel && !viewCte;
    const { qb: queryBuilder, selectionMap } =
      await this.recordQueryBuilder.createRecordAggregateBuilder(viewCte ?? dbTableName, {
        tableId,
        viewId,
        filter: mergedFilter,
        aggregationFields: [
          {
            fieldId: '*',
            statisticFunc: StatisticsFunc.Count,
            alias: '__c',
          },
        ],
        groupBy,
        currentUserId: withUserId,
        useQueryModel: shouldUseQueryModel,
        builder: permissionBuilder,
      });

    if (search && search[2]) {
      const searchFields = await this.getSearchFields(fieldInstanceMap, search, viewId);
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(builder, searchFields, tableIndex, search, { selectionMap });
      });
    }

    queryBuilder.limit(this.thresholdConfig.maxGroupPoints);

    const groupSql = queryBuilder.toQuery();
    this.logger.debug('groupSql: %s', groupSql);
    const groupFields = groupFieldIds.map((fieldId) => fieldInstanceMap[fieldId]).filter(Boolean);
    const rowCount = await this.getRowCountByFilter(
      dbTableName,
      fieldInstanceMap,
      tableId,
      mergedFilter,
      search,
      viewId,
      useQueryModel
    );

    try {
      const result =
        await this.prismaService.$queryRawUnsafe<{ [key: string]: unknown; __c: number }[]>(
          groupSql
        );
      const pointsResult = await this.groupDbCollection2GroupPoints(
        result,
        groupFields,
        groupBy,
        collapsedGroupIds,
        rowCount
      );
      groupPoints = pointsResult.groupPoints;
      allGroupHeaderRefs = pointsResult.allGroupHeaderRefs;
    } catch (error) {
      this.logger.error(`Get group points error in table ${tableId}: `, error);
    }

    const filterWithCollapsed = this.getFilterByCollapsedGroup({
      groupBy,
      groupPoints,
      fieldInstanceMap,
      collapsedGroupIds,
    });

    return {
      groupPoints,
      allGroupHeaderRefs,
      filter: mergeFilter(filter, filterWithCollapsed),
      builder: permissionBuilder,
    };
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

    const queryResult = await this.getDocIdsByQuery(
      tableId,
      {
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
      },
      true
    );
    const isVisible = queryResult.ids.includes(recordId);
    return { isDeleted, isVisible };
  }

  async emitRecordAuditLogEvent(
    action: UpdateRecordAction | CreateRecordAction,
    tableId: string,
    recordCount: number,
    appId?: string
  ) {
    this.eventEmitter.emit(Events.TABLE_RECORD_CREATE_RELATIVE, {
      action,
      resourceId: tableId,
      recordCount,
      params: {
        appId,
      },
    });
  }

  async getRecordsCollaborators(
    tableId: string,
    query: IRecordGetCollaboratorsRo & { filter?: IFilter | null }
  ) {
    const { fieldId, skip, take, search, filter } = query;
    const [fieldRaw] = await this.dataLoaderService.field.load(tableId, {
      id: [fieldId],
    });
    if (
      !fieldRaw ||
      ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(
        fieldRaw.type as FieldType
      )
    ) {
      throw new CustomHttpException(
        'field type is not user-related field',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.share.fieldNotUserRelatedField',
          },
        }
      );
    }
    const { queryBuilder } = await this.buildFilterSortQuery(
      tableId,
      {
        filter,
      },
      true
    );
    const collaboratorsQueryBuilder = this.knex.queryBuilder().with('table_records', queryBuilder);

    const { dbFieldName, isMultipleCellValue } = fieldRaw;
    collaboratorsQueryBuilder.whereNotNull(dbFieldName);
    collaboratorsQueryBuilder.from('table_records');
    this.dbProvider.shareFilterCollaboratorsQuery(
      collaboratorsQueryBuilder,
      dbFieldName,
      isMultipleCellValue
    );

    const resQuery = this.knex('users')
      .with('coll', collaboratorsQueryBuilder)
      .select('id', 'email', 'name', 'avatar')
      .from('coll')
      .leftJoin('users', 'users.id', '=', 'coll.user_id')
      .limit(take ?? 50)
      .offset(skip ?? 0);
    if (search) {
      this.dbProvider.searchBuilder(resQuery, [
        ['users.name', search],
        ['users.email', search],
      ]);
    }
    const users = await this.prismaService
      .txClient()
      // eslint-disable-next-line @typescript-eslint/naming-convention
      .$queryRawUnsafe<{ id: string; email: string; name: string; avatar: string | null }[]>(
        resQuery.toQuery()
      );

    return users.map(({ id, email, name, avatar }) => ({
      userId: id,
      email,
      userName: name,
      avatar: avatar && getPublicFullStorageUrl(avatar),
    }));
  }
}
