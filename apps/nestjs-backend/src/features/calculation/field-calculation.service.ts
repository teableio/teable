import { Injectable } from '@nestjs/common';
import { FieldType, type IRecord } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { type IUserInfoVo } from '@teable/openapi';
import { Knex } from 'knex';
import { groupBy, isEmpty, keyBy, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import type { Observable } from 'rxjs';
import { concatMap, from, lastValueFrom, map, range, toArray } from 'rxjs';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { Timing } from '../../utils/timing';
import { systemDbFieldNames } from '../field/constant';
import type { IFieldInstance, IFieldMap } from '../field/model/factory';
import { BatchService } from './batch.service';
import type { IGraphItem, ITopoItem } from './reference.service';
import { ReferenceService } from './reference.service';
import type { ICellChange } from './utils/changes';
import { formatChangesToOps, mergeDuplicateChange } from './utils/changes';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { nameConsole } from './utils/name-console';

export interface ITopoOrdersContext {
  fieldMap: IFieldMap;
  userMap?: { [userId: string]: IUserInfoVo };
  allFieldIds: string[];
  startFieldIds: string[];
  directedGraph: IGraphItem[];
  fieldId2DbTableName: { [fieldId: string]: string };
  topoOrdersByFieldId: { [fieldId: string]: ITopoItem[] };
  tableId2DbTableName: { [tableId: string]: string };
  dbTableName2fields: { [dbTableName: string]: IFieldInstance[] };
  fieldId2TableId: { [fieldId: string]: string };
}

@Injectable()
export class FieldCalculationService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly referenceService: ReferenceService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  @Timing()
  async resetFields(tableId: string, fieldIds: string[]) {
    const result = await this.getChangedOpsMapByReset(tableId, fieldIds);

    if (!result) {
      return;
    }
    const { opsMap, fieldMap, tableId2DbTableName } = result;
    await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
  }

  @Timing()
  async resetAndCalculateFields(tableId: string, fieldIds: string[]) {
    await this.resetFields(tableId, fieldIds);
    await this.calculateFields(tableId, fieldIds);
  }

  @Timing()
  async calculateFields(tableId: string, fieldIds: string[]) {
    const result = await this.getChangedOpsMap(tableId, fieldIds);

    if (!result) {
      return;
    }
    const { opsMap, fieldMap, tableId2DbTableName } = result;
    await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
  }

  async getUserMap(tableId: string) {
    const {
      baseId,
      base: { spaceId },
    } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: {
        baseId: true,
        base: { select: { spaceId: true } },
      },
    });

    const collaborators = await this.prismaService.collaborator.findMany({
      where: { resourceId: { in: [spaceId, baseId] } },
      select: { userId: true },
    });

    const users = await this.prismaService.user.findMany({
      where: { id: { in: collaborators.map((c) => c.userId) } },
      select: { id: true, name: true, avatar: true },
    });

    return keyBy(users, 'id');
  }

  async getTopoOrdersContext(
    fieldIds: string[],
    customGraph?: IGraphItem[]
  ): Promise<ITopoOrdersContext> {
    const directedGraph = customGraph || (await this.referenceService.getFieldGraphItems(fieldIds));

    // get all related field by undirected graph
    const allFieldIds = uniq(this.referenceService.flatGraph(directedGraph).concat(fieldIds));

    // prepare all related data
    const {
      fieldMap,
      fieldId2TableId,
      dbTableName2fields,
      fieldId2DbTableName,
      tableId2DbTableName,
    } = await this.referenceService.createAuxiliaryData(allFieldIds);

    // topological sorting
    const topoOrdersByFieldId = this.referenceService.getTopoOrdersMap(fieldIds, directedGraph);
    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);

    const computedUserFieldId = fieldIds.find(
      (fieldId) =>
        fieldMap[fieldId].type === FieldType.CreatedBy ||
        fieldMap[fieldId].type === FieldType.LastModifiedBy
    );
    const userMap = computedUserFieldId
      ? await this.getUserMap(fieldId2TableId[computedUserFieldId])
      : undefined;

    return {
      startFieldIds: fieldIds,
      allFieldIds,
      fieldMap,
      userMap,
      directedGraph,
      topoOrdersByFieldId,
      tableId2DbTableName,
      fieldId2DbTableName,
      dbTableName2fields,
      fieldId2TableId,
    };
  }

  async getRecordItems(params: {
    tableId: string;
    startFieldIds: string[];
    itemsToCalculate: string[];
    directedGraph: IGraphItem[];
    fieldMap: IFieldMap;
  }) {
    const { directedGraph, itemsToCalculate, startFieldIds, fieldMap } = params;

    const linkAdjacencyMap = this.referenceService.getLinkAdjacencyMap(fieldMap, directedGraph);

    if (!itemsToCalculate.length || isEmpty(linkAdjacencyMap)) {
      return [];
    }

    return this.referenceService.getRelatedItems(
      startFieldIds,
      fieldMap,
      linkAdjacencyMap,
      itemsToCalculate
    );
  }

  private async getRecordsByPage(
    dbTableName: string,
    dbFieldNames: string[],
    page: number,
    chunkSize: number
  ) {
    const query = this.knex(dbTableName)
      .select([...dbFieldNames, ...systemDbFieldNames])
      .where((builder) => {
        dbFieldNames.forEach((fieldNames, index) => {
          if (index === 0) {
            builder.whereNotNull(fieldNames);
          } else {
            builder.orWhereNotNull(fieldNames);
          }
        });
      })
      .orderBy('__auto_number')
      .limit(chunkSize)
      .offset(page * chunkSize)
      .toQuery();
    return this.prismaService
      .txClient()
      .$queryRawUnsafe<{ [dbFieldName: string]: unknown }[]>(query);
  }

  async getRecordsBatchByFields(dbTableName2fields: { [dbTableName: string]: IFieldInstance[] }) {
    const results: {
      [dbTableName: string]: IRecord[];
    } = {};
    const chunkSize = this.thresholdConfig.calcChunkSize;
    for (const dbTableName in dbTableName2fields) {
      // deduplication is needed
      const rowCount = await this.getRowCount(dbTableName);
      const dbFieldNames = dbTableName2fields[dbTableName].map((f) => f.dbFieldName);
      const totalPages = Math.ceil(rowCount / chunkSize);
      const fields = dbTableName2fields[dbTableName];

      const records = await lastValueFrom(
        range(0, totalPages).pipe(
          concatMap((page) => this.getRecordsByPage(dbTableName, dbFieldNames, page, chunkSize)),
          toArray(),
          map((records) => records.flat())
        )
      );

      results[dbTableName] = records.map((record) =>
        this.referenceService.recordRaw2Record(fields, record)
      );
    }
    return results;
  }

  @Timing()
  async getChangedOpsMapByReset(tableId: string, fieldIds: string[]) {
    if (!fieldIds.length) {
      return undefined;
    }

    const context = await this.getTopoOrdersContext(fieldIds);
    const {
      fieldMap,
      topoOrdersByFieldId,
      dbTableName2fields,
      tableId2DbTableName,
      fieldId2TableId,
    } = context;

    const dbTableName2records = await this.getRecordsBatchByFields(dbTableName2fields);

    const changes = Object.values(fieldIds).reduce<ICellChange[]>((cellChanges, fieldId) => {
      const tableId = fieldId2TableId[fieldId];
      const dbTableName = tableId2DbTableName[tableId];
      const records = dbTableName2records[dbTableName];
      records
        .filter((record) => record.fields[fieldId] != null)
        .forEach((record) => {
          cellChanges.push({
            tableId,
            recordId: record.id,
            fieldId,
            oldValue: record.fields[fieldId],
            newValue: null,
          });
        });
      return cellChanges;
    }, []);

    if (!changes.length) {
      return;
    }

    const remainsTopoOrders = Object.values(topoOrdersByFieldId).reduce<{
      [fieldId: string]: ITopoItem[];
    }>((pre, order) => {
      const newOrder = [...order];
      newOrder.shift();
      if (newOrder.length) {
        pre[newOrder[0].id] = newOrder;
      }
      return pre;
    }, {});

    // filter unnecessary fields
    const remainsDbTableName2fields = Object.entries(dbTableName2fields).reduce<{
      [dbTableName: string]: IFieldInstance[];
    }>((pre, [key, fields]) => {
      pre[key] = fields.filter((field) =>
        Object.values(remainsTopoOrders)
          .flat()
          .flatMap((order) => order.dependencies)
          .find((fieldId) => fieldId === field.id)
      );
      return pre;
    }, {});

    const remainsChanges = await this.calculateChanges(
      tableId,
      {
        ...context,
        dbTableName2fields: remainsDbTableName2fields,
        topoOrdersByFieldId: remainsTopoOrders,
      },
      fieldIds
    );

    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);
    // nameConsole('remainsTopoOrders', remainsTopoOrders, fieldMap);

    const opsMap = formatChangesToOps(mergeDuplicateChange(changes.concat(remainsChanges)));
    return { opsMap, fieldMap, tableId2DbTableName };
  }

  async getChangedOpsMap(tableId: string, fieldIds: string[], recordIds?: string[]) {
    if (!fieldIds.length) {
      return undefined;
    }

    const context = await this.getTopoOrdersContext(fieldIds);
    const { fieldMap, tableId2DbTableName } = context;
    const changes = await this.calculateChanges(tableId, context, [], recordIds);
    if (!changes.length) {
      return;
    }

    const opsMap = formatChangesToOps(mergeDuplicateChange(changes));
    return { opsMap, fieldMap, tableId2DbTableName };
  }

  @Timing()
  private async calculateChangesTask(
    tableId: string,
    context: ITopoOrdersContext,
    resetFieldIds: string[],
    recordIds: string[]
  ) {
    const {
      fieldMap,
      userMap,
      startFieldIds,
      directedGraph,
      topoOrdersByFieldId,
      fieldId2DbTableName,
      dbTableName2fields,
      tableId2DbTableName,
      fieldId2TableId,
    } = context;

    const dbTableName = tableId2DbTableName[tableId];

    const relatedRecordItems = await this.getRecordItems({
      tableId,
      itemsToCalculate: recordIds,
      startFieldIds,
      directedGraph,
      fieldMap,
    });

    // record data source
    const dbTableName2recordMap = await this.referenceService.getRecordMapBatch({
      fieldMap,
      fieldId2DbTableName,
      dbTableName2fields,
      initialRecordIdMap: { [dbTableName]: new Set(recordIds) },
      modifiedRecords: [],
      relatedRecordItems,
    });

    if (resetFieldIds.length) {
      Object.values(dbTableName2recordMap).forEach((records) => {
        Object.values(records).forEach((record) => {
          resetFieldIds.forEach((fieldId) => {
            record.fields[fieldId] = null;
          });
        });
      });
    }
    const relatedRecordItemsIndexed = groupBy(relatedRecordItems, 'fieldId');
    return Object.values(topoOrdersByFieldId).reduce<ICellChange[]>((pre, topoOrders) => {
      const orderWithRecords = this.referenceService.createTopoItemWithRecords({
        topoOrders,
        fieldMap,
        tableId2DbTableName,
        fieldId2TableId,
        dbTableName2recordMap,
        relatedRecordItemsIndexed,
      });
      return pre.concat(
        this.referenceService.collectChanges(orderWithRecords, fieldMap, fieldId2TableId, userMap)
      );
    }, []);
  }

  private processRecordIds(
    recordIds$: Observable<string[]>,
    taskFunction: (recordIds: string[]) => Promise<ICellChange[]>
  ): Promise<ICellChange[]> {
    return lastValueFrom(
      recordIds$.pipe(
        concatMap((ids) => from(taskFunction(ids))),
        toArray(),
        map((computedRecords) => computedRecords.flat())
      )
    );
  }

  @Timing()
  async getRowCount(dbTableName: string) {
    const query = this.knex.count('*', { as: 'count' }).from(dbTableName).toQuery();
    const [{ count }] = await this.prismaService.$queryRawUnsafe<{ count: bigint }[]>(query);
    return Number(count);
  }

  private async getRecordIds(dbTableName: string, page: number, chunkSize: number) {
    const query = this.knex(dbTableName)
      .select({ id: '__id' })
      .orderBy('__auto_number')
      .limit(chunkSize)
      .offset(page * chunkSize)
      .toQuery();
    const result = await this.prismaService.$queryRawUnsafe<{ id: string }[]>(query);
    return result.map((item) => item.id);
  }

  @Timing()
  private async calculateChanges(
    tableId: string,
    context: ITopoOrdersContext,
    resetFieldIds: string[],
    recordIds?: string[]
  ) {
    const dbTableName = context.tableId2DbTableName[tableId];
    const chunkSize = this.thresholdConfig.calcChunkSize;

    const taskFunction = async (ids: string[]) =>
      this.calculateChangesTask(tableId, context, resetFieldIds, ids);

    if (recordIds && recordIds.length > 0) {
      return this.processRecordIds(from([recordIds]), taskFunction);
    } else {
      const rowCount = await this.getRowCount(dbTableName);

      const totalPages = Math.ceil(rowCount / chunkSize);

      const recordIds$ = range(0, totalPages).pipe(
        concatMap((page) => this.getRecordIds(dbTableName, page, chunkSize))
      );

      return this.processRecordIds(recordIds$, taskFunction);
    }
  }

  async calculateFieldsByRecordIds(tableId: string, recordIds: string[]) {
    const fieldRaws = await this.prismaService.field.findMany({
      where: { tableId, isComputed: true, deletedTime: null, hasError: null },
      select: { id: true },
    });

    const computedFieldIds = fieldRaws.map((fieldRaw) => fieldRaw.id);

    // calculate by origin ops and link derivation
    const result = await this.getChangedOpsMap(tableId, computedFieldIds, recordIds);

    if (result) {
      const { opsMap, fieldMap, tableId2DbTableName } = result;

      await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
    }
  }
}
