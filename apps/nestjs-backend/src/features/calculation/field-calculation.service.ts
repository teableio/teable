import { Injectable } from '@nestjs/common';
import type { ILookupOptionsVo } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { uniq, uniqBy } from 'lodash';
import type { IRawOpMap } from '../../share-db/interface';
import { Timing } from '../../utils/timing';
import { tinyPreservedFieldName } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { BatchService } from './batch.service';
import type { IFieldMap, IRecordRefItem, ITopoItem } from './reference.service';
import { ReferenceService } from './reference.service';
import type { ICellChange } from './utils/changes';
import { formatChangesToOps, mergeDuplicateChange } from './utils/changes';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { nameConsole } from './utils/name-console';

export interface ITopoOrdersContext {
  fieldMap: IFieldMap;
  topoOrdersByFieldId: { [fieldId: string]: ITopoItem[] };
  tableId2DbTableName: { [tableId: string]: string };
  dbTableName2fields: { [dbTableName: string]: IFieldInstance[] };
  fieldId2TableId: { [fieldId: string]: string };
}

@Injectable()
export class FieldCalculationService {
  constructor(
    private readonly referenceService: ReferenceService,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService
  ) {}

  protected readonly knex = knex({ client: 'sqlite3' });

  private async getSelfOriginRecords(dbTableName: string) {
    const nativeSql = this.knex.queryBuilder().select('__id').from(dbTableName).toSQL().toNative();

    const results = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(nativeSql.sql, ...nativeSql.bindings);

    return results.map((item) => ({
      dbTableName: dbTableName,
      id: item.__id,
    }));
  }

  private async getOneManyOriginRecords(
    _tableId: string,
    tableId2DbTableName: Record<string, string>,
    lookupOptions: ILookupOptionsVo
  ) {
    const { dbForeignKeyName, foreignTableId } = lookupOptions;
    const foreignDbTableName = tableId2DbTableName[foreignTableId];

    const nativeSql = this.knex
      .queryBuilder()
      .whereNotNull(dbForeignKeyName)
      .select('__id')
      .from(foreignDbTableName)
      .toSQL()
      .toNative();

    const results = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string }[]>(nativeSql.sql, ...nativeSql.bindings);

    return results.map((item) => ({
      dbTableName: foreignDbTableName,
      id: item.__id,
    }));
  }

  private async getManyOneOriginRecords(
    tableId: string,
    tableId2DbTableName: Record<string, string>,
    lookupOptions: ILookupOptionsVo
  ) {
    const { dbForeignKeyName, foreignTableId } = lookupOptions;
    const dbTableName = tableId2DbTableName[tableId];
    const foreignDbTableName = tableId2DbTableName[foreignTableId];
    const nativeSql = this.knex
      .queryBuilder()
      .whereNotNull(dbForeignKeyName)
      .select(dbForeignKeyName)
      .from(dbTableName)
      .toSQL()
      .toNative();

    const results = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ [key: string]: string }[]>(nativeSql.sql, ...nativeSql.bindings);

    return uniqBy(
      results.map((item) => ({
        dbTableName: foreignDbTableName,
        id: item[dbForeignKeyName],
      })),
      'id'
    );
  }

  private async getOriginLookupRecords(
    tableId: string,
    tableId2DbTableName: Record<string, string>,
    field: IFieldInstance
  ) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lookupOptions = field.lookupOptions!;
    if (lookupOptions.relationship === Relationship.ManyOne) {
      return this.getManyOneOriginRecords(tableId, tableId2DbTableName, lookupOptions);
    }
    if (lookupOptions.relationship === Relationship.OneMany) {
      return this.getOneManyOriginRecords(tableId, tableId2DbTableName, lookupOptions);
    }

    throw new Error('Invalid relationship');
  }

  private async getOriginComputedRecords(
    tableId: string,
    tableId2DbTableName: Record<string, string>,
    field: IFieldInstance
  ): Promise<{ dbTableName: string; id: string }[]> {
    let records: { dbTableName: string; id: string }[] = [];
    if (field.lookupOptions) {
      records = records.concat(
        await this.getOriginLookupRecords(tableId, tableId2DbTableName, field)
      );

      // if nothing to lookup, we don't have to calculate this field
      if (!records.length) {
        return records;
      }
    }

    const dbTableName = tableId2DbTableName[tableId];
    records = records.concat(await this.getSelfOriginRecords(dbTableName));

    return records;
  }

  @Timing()
  async calculateFields(
    src: string,
    tableId: string,
    fieldIds: string[],
    reset?: boolean
  ): Promise<IRawOpMap | undefined> {
    const result = reset
      ? await this.getChangedOpsMapByReset(tableId, fieldIds)
      : await this.getChangedOpsMap(tableId, fieldIds);

    if (!result) {
      return;
    }
    const { opsMap, fieldMap, tableId2DbTableName } = result;
    return await this.batchService.save(src, opsMap, fieldMap, tableId2DbTableName);
  }

  async getTopoOrdersContext(fieldIds: string[]): Promise<ITopoOrdersContext> {
    const undirectedGraph = await this.referenceService.getDependentNodesCTE(fieldIds);

    // get all related field by undirected graph
    const allFieldIds = uniq(this.referenceService.flatGraph(undirectedGraph).concat(fieldIds));

    // prepare all related data
    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.referenceService.createAuxiliaryData(allFieldIds);

    // topological sorting
    const topoOrdersByFieldId = this.referenceService.getTopoOrdersByFieldId(
      fieldIds,
      undirectedGraph
    );
    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);

    return {
      fieldMap,
      topoOrdersByFieldId,
      tableId2DbTableName,
      dbTableName2fields,
      fieldId2TableId,
    };
  }

  private async getRecordItems(params: {
    tableId: string;
    fieldId2TableId: { [fieldId: string]: string };
    tableId2DbTableName: { [tableId: string]: string };
    topoOrdersByFieldId: { [fieldId: string]: ITopoItem[] };
    fieldMap: IFieldMap;
  }) {
    const { tableId, fieldId2TableId, tableId2DbTableName, topoOrdersByFieldId, fieldMap } = params;
    // the origin change will lead to affected record changes
    let affectedRecordItems: IRecordRefItem[] = [];
    let originRecordIdItems: { dbTableName: string; id: string }[] = [];
    for (const fieldId in topoOrdersByFieldId) {
      const topoOrders = topoOrdersByFieldId[fieldId];
      const linkOrders = this.referenceService.getLinkOrderFromTopoOrders({
        tableId2DbTableName,
        topoOrders,
        fieldMap,
        fieldId2TableId,
      });

      if (!fieldMap[fieldId].isComputed) {
        continue;
      }

      const originItems = await this.getOriginComputedRecords(
        tableId,
        tableId2DbTableName,
        fieldMap[fieldId]
      );

      if (!originItems.length) {
        continue;
      }

      // nameConsole('getAffectedRecordItems:topoOrder', linkOrders, fieldMap);
      // nameConsole('getAffectedRecordItems:originRecordIdItems', originRecordIdItems, fieldMap);
      const items = await this.referenceService.getAffectedRecordItems(linkOrders, originItems);
      // nameConsole('fieldId:', { fieldId }, fieldMap);
      // nameConsole('affectedRecordItems:', items, fieldMap);
      affectedRecordItems = affectedRecordItems.concat(items);
      originRecordIdItems = originRecordIdItems.concat(originItems);
    }
    return { affectedRecordItems, originRecordIdItems };
  }

  async getRecordsBatchByFields(dbTableName2fields: { [dbTableName: string]: IFieldInstance[] }) {
    const results: {
      [dbTableName: string]: { [dbFieldName: string]: unknown }[];
    } = {};
    for (const dbTableName in dbTableName2fields) {
      // deduplication is needed
      const dbFieldNames = dbTableName2fields[dbTableName]
        .map((f) => f.dbFieldName)
        .concat([...tinyPreservedFieldName]);
      const nativeSql = this.knex(dbTableName).select(dbFieldNames).toSQL().toNative();
      const result = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ [dbFieldName: string]: unknown }[]>(
          nativeSql.sql,
          ...nativeSql.bindings
        );
      results[dbTableName] = result;
    }

    return this.referenceService.formatRecordQueryResult(results, dbTableName2fields);
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
        .filter((record) => record.fields[fieldId])
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

  @Timing()
  async getChangedOpsMap(tableId: string, fieldIds: string[]) {
    if (!fieldIds.length) {
      return undefined;
    }

    const context = await this.getTopoOrdersContext(fieldIds);
    const { fieldMap, tableId2DbTableName } = context;
    const changes = await this.calculateChanges(tableId, context);
    if (!changes.length) {
      return;
    }

    const opsMap = formatChangesToOps(mergeDuplicateChange(changes));
    return { opsMap, fieldMap, tableId2DbTableName };
  }

  private async calculateChanges(
    tableId: string,
    context: ITopoOrdersContext,
    resetFieldIds?: string[]
  ) {
    const {
      fieldMap,
      topoOrdersByFieldId,
      dbTableName2fields,
      tableId2DbTableName,
      fieldId2TableId,
    } = context;
    const { affectedRecordItems, originRecordIdItems } = await this.getRecordItems({
      tableId,
      fieldId2TableId,
      tableId2DbTableName,
      topoOrdersByFieldId,
      fieldMap,
    });

    const dependentRecordItems = await this.referenceService.getDependentRecordItems(
      affectedRecordItems
    );

    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);
    // nameConsole('originRecordIdItems', originRecordIdItems, fieldMap);
    // nameConsole('affectedRecordItems', affectedRecordItems, fieldMap);
    // nameConsole('dependentRecordItems', dependentRecordItems, fieldMap);

    // record data source
    const dbTableName2records = await this.referenceService.getRecordsBatch({
      originRecordItems: originRecordIdItems,
      affectedRecordItems,
      dependentRecordItems,
      dbTableName2fields,
    });
    // nameConsole('dbTableName2records', dbTableName2records, fieldMap);
    // nameConsole('dbTableName2records', dbTableName2records, fieldMap);

    if (resetFieldIds) {
      Object.values(dbTableName2records).forEach((records) => {
        records.forEach((record) => {
          resetFieldIds.forEach((fieldId) => {
            record.fields[fieldId] = null;
          });
        });
      });
    }

    return Object.values(topoOrdersByFieldId).reduce<ICellChange[]>((pre, topoOrders) => {
      const orderWithRecords = this.referenceService.createTopoItemWithRecords({
        topoOrders,
        fieldMap,
        tableId2DbTableName,
        fieldId2TableId,
        dbTableName2records,
        affectedRecordItems,
        dependentRecordItems,
      });
      return pre.concat(
        this.referenceService.collectChanges(
          orderWithRecords,
          fieldMap,
          fieldId2TableId,
          tableId2DbTableName,
          {}
        )
      );
    }, []);
  }
}
