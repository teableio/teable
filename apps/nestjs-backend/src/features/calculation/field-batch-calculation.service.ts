import { Injectable } from '@nestjs/common';
import type { ILookupOptionsVo } from '@teable-group/core';
import { FieldType, Relationship } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { uniq, uniqBy } from 'lodash';
import type { IFieldInstance } from '../field/model/factory';
import type { ICellChange, IRecordRefItem, ITopoItem } from './reference.service';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ReferenceService, nameConsole } from './reference.service';

@Injectable()
export class FieldBatchCalculationService extends ReferenceService {
  private async getSelfOriginRecords(prisma: Prisma.TransactionClient, dbTableName: string) {
    const nativeSql = this.knex.queryBuilder().select('__id').from(dbTableName).toSQL().toNative();

    const results = await prisma.$queryRawUnsafe<{ __id: string }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );

    return results.map((item) => ({
      dbTableName: dbTableName,
      id: item.__id,
    }));
  }

  private async getOneManyOriginRecords(
    prisma: Prisma.TransactionClient,
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

    const results = await prisma.$queryRawUnsafe<{ __id: string }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );

    return results.map((item) => ({
      dbTableName: foreignDbTableName,
      id: item.__id,
    }));
  }

  private async getManyOneOriginRecords(
    prisma: Prisma.TransactionClient,
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

    const results = await prisma.$queryRawUnsafe<{ [key: string]: string }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );

    return uniqBy(
      results.map((item) => ({
        dbTableName: foreignDbTableName,
        id: item[dbForeignKeyName],
      })),
      'id'
    );
  }

  private async getOriginLookupRecords(
    prisma: Prisma.TransactionClient,
    tableId: string,
    tableId2DbTableName: Record<string, string>,
    field: IFieldInstance
  ) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lookupOptions = field.lookupOptions!;
    if (lookupOptions.relationship === Relationship.ManyOne) {
      return this.getManyOneOriginRecords(prisma, tableId, tableId2DbTableName, lookupOptions);
    }
    if (lookupOptions.relationship === Relationship.OneMany) {
      return this.getOneManyOriginRecords(prisma, tableId, tableId2DbTableName, lookupOptions);
    }

    throw new Error('Invalid relationship');
  }

  private async getOriginComputedRecords(
    prisma: Prisma.TransactionClient,
    tableId: string,
    tableId2DbTableName: Record<string, string>,
    field: IFieldInstance
  ): Promise<{ dbTableName: string; id: string }[]> {
    let records: { dbTableName: string; id: string }[] = [];
    if (field.lookupOptions) {
      records = records.concat(
        await this.getOriginLookupRecords(prisma, tableId, tableId2DbTableName, field)
      );

      // if nothing to lookup, we don't have to calculate this field
      if (!records.length) {
        return records;
      }
    }

    const dbTableName = tableId2DbTableName[tableId];
    records = records.concat(await this.getSelfOriginRecords(prisma, dbTableName));

    return records;
  }

  async calculateFields(prisma: Prisma.TransactionClient, tableId: string, fieldIds: string[]) {
    if (!fieldIds.length) {
      return {};
    }

    const undirectedGraph = await this.getDependentNodesCTE(prisma, fieldIds);

    // get all related field by undirected graph
    const allFieldIds = uniq(this.flatGraph(undirectedGraph).concat(fieldIds));

    // prepare all related data
    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.createAuxiliaryData(prisma, allFieldIds);

    // nameConsole('fieldIds', fieldIds, fieldMap);
    // nameConsole('allFieldIds', allFieldIds, fieldMap);
    // nameConsole('undirectedGraph', undirectedGraph, fieldMap);

    // topological sorting
    const topoOrdersByFieldId = fieldIds.reduce<{
      [fieldId: string]: ITopoItem[];
    }>((pre, fieldId) => {
      const topoOrder = this.getTopologicalOrder(fieldId, undirectedGraph);
      const firstField = fieldMap[topoOrder[0].id];
      // nameConsole('topoOrdersByFieldId', topoOrder, fieldMap);
      if (firstField.type === FieldType.Link) {
        topoOrder.shift();
        // nameConsole('topoOrdersByFieldId shifted', topoOrder, fieldMap);
      }
      pre[fieldId] = topoOrder;
      return pre;
    }, {});
    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);

    // the origin change will lead to affected record changes
    let affectedRecordItems: IRecordRefItem[] = [];
    let originRecordIdItems: { dbTableName: string; id: string }[] = [];
    for (const fieldId in topoOrdersByFieldId) {
      const topoOrders = topoOrdersByFieldId[fieldId];
      // console.log('field:', fieldMap[fieldId]);
      // console.log('topoOrders:', topoOrders);
      const linkOrders = this.getLinkOrderFromTopoOrders({
        tableId2DbTableName,
        topoOrders,
        fieldMap,
        fieldId2TableId,
      });

      if (!fieldMap[fieldId].isComputed) {
        continue;
      }

      const originItems = await this.getOriginComputedRecords(
        prisma,
        tableId,
        tableId2DbTableName,
        fieldMap[fieldId]
      );

      if (!originItems.length) {
        continue;
      }

      // nameConsole('getAffectedRecordItems:topoOrder', linkOrders, fieldMap);
      // nameConsole('getAffectedRecordItems:originRecordIdItems', originRecordIdItems, fieldMap);
      const items = await this.getAffectedRecordItems(prisma, linkOrders, originItems);
      // nameConsole('fieldId:', { fieldId }, fieldMap);
      // nameConsole('affectedRecordItems:', items, fieldMap);
      affectedRecordItems = affectedRecordItems.concat(items);
      originRecordIdItems = originRecordIdItems.concat(originItems);
    }
    // nameConsole('originRecordIdItems', originRecordIdItems, fieldMap);
    // nameConsole('affectedRecordItems', affectedRecordItems, fieldMap);

    const dependentRecordItems = await this.getDependentRecordItems(prisma, affectedRecordItems);
    // nameConsole('dependentRecordItems', dependentRecordItems, fieldMap);

    // record data source
    const dbTableName2records = await this.getRecordsBatch(prisma, {
      originRecordItems: originRecordIdItems,
      affectedRecordItems,
      dependentRecordItems,
      dbTableName2fields,
    });
    // nameConsole('dbTableName2records', dbTableName2records, fieldMap);

    const changes = Object.values(topoOrdersByFieldId).reduce<ICellChange[]>((pre, topoOrders) => {
      const orderWithRecords = this.createTopoItemWithRecords({
        topoOrders,
        fieldMap,
        tableId2DbTableName,
        fieldId2TableId,
        dbTableName2records,
        affectedRecordItems,
        dependentRecordItems,
      });
      // console.log('collectChanges:', topoOrders, orderWithRecords, fieldId2TableId);
      return pre.concat(
        this.collectChanges(orderWithRecords, fieldMap, fieldId2TableId, tableId2DbTableName, {})
      );
    }, []);

    return this.formatChangesToOps(this.mergeDuplicateChange(changes));
  }
}
