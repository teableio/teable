import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  ILinkFieldOptions,
  ILookupOptionsVo,
  ILinkCellValue,
} from '@teable-group/core';
import { OpBuilder, Relationship, FieldType, evaluate } from '@teable-group/core';
import { Prisma } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import knex from 'knex';
import { difference, groupBy, intersectionBy, uniq } from 'lodash';
import type { IVisualTableDefaultField } from '../field/constant';
import { preservedFieldName } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByVo, createFieldInstanceByRaw } from '../field/model/factory';
import type { FieldVo } from '../field/model/field.vo';
import { isLinkCellValue } from './utils/detect-link';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, sonarjs/cognitive-complexity
function replaceFieldIdsWithNames(obj: any, fieldMap: { [fieldId: string]: { name: string } }) {
  if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      // eslint-disable-next-line no-prototype-builtins
      if (obj.hasOwnProperty(key)) {
        let newKey = key;
        if (key.startsWith('fld') && fieldMap[key]) {
          newKey = fieldMap[key].name;
        }
        obj[newKey] = replaceFieldIdsWithNames(obj[key], fieldMap);
        if (newKey !== key) delete obj[key];
      }
    }
  } else if (typeof obj === 'string' && obj.startsWith('fld') && fieldMap[obj]) {
    obj = fieldMap[obj].name;
  }
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
function nameConsole(key: string, obj: any, fieldMap: { [fieldId: string]: { name: string } }) {
  obj = JSON.parse(JSON.stringify(obj));
  console.log(key, JSON.stringify(replaceFieldIdsWithNames(obj, fieldMap), null, 2));
}

interface ITopoItem {
  id: string;
  dependencies: string[];
}

interface IRecordItem {
  record: IRecord;
  calculated?: { [fieldId: string]: boolean };
  dependencies?: IRecord | IRecord[];
}

interface IRecordData {
  id: string;
  fieldId: string;
  oldValue?: unknown;
  newValue: unknown;
}

interface IRecordDataMap {
  [tableId: string]: IRecordData[];
}

export interface ICellChange {
  tableId: string;
  recordId: string;
  fieldId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface IOpsMap {
  [tableId: string]: {
    [recordId: string]: IOtOperation[];
  };
}

export interface ITopoItemWithRecords extends ITopoItem {
  recordItems: IRecordItem[];
}

export interface IFkRecordMapByDbTableName {
  [dbTableName: string]: {
    [recordId: string]: {
      [fkField: string]: string | null;
    };
  };
}

interface ITopoLinkOrder {
  dbTableName: string;
  fieldId: string;
  foreignKeyField: string;
  relationship: Relationship;
  linkedTable: string;
}

interface IRecordRefItem {
  id: string;
  dbTableName: string;
  fieldId?: string;
  selectIn?: string;
  relationTo?: string;
}

@Injectable()
export class ReferenceService {
  private readonly knex = knex({ client: 'sqlite3' });

  /**
   * Strategy of calculation.
   * update link field in a record is a special operation for calculation.
   * when modify a link field in a record, we should update itself and the cells dependent it,
   * there are 3 kinds of scene: add delete and replace
   * 1. when delete a item we should calculate it [before] delete the foreignKey for reference retrieval.
   * 2. when add a item we should calculate it [after] add the foreignKey for reference retrieval.
   * So how do we handle replace?
   * split the replace to [delete] and [others], then do it as same as above.
   *
   * Summarize:
   * 1. calculate the delete operation
   * 2. update foreignKey
   * 3. calculate the others operation
   */
  async calculateOpsMap(
    prisma: Prisma.TransactionClient,
    opsMap: IOpsMap,
    fkRecordMap: IFkRecordMapByDbTableName
  ) {
    const { recordDataMapWithDelete, recordDataMapRemains } =
      this.splitOpsMapToRecordDataMap(opsMap);

    // console.log('recordDataMapWithDelete', JSON.stringify(recordDataMapWithDelete, null, 2));
    // console.log('recordDataMapRemains', JSON.stringify(recordDataMapRemains, null, 2));
    // console.log('updateForeignKey:', JSON.stringify(fkRecordMap, null, 2));
    const cellChangesBefore = await this.calculateRecordDataMap(
      prisma,
      recordDataMapWithDelete,
      fkRecordMap
    );
    // console.log('cellChangesBefore', cellChangesBefore);
    await this.updateForeignKey(prisma, fkRecordMap);
    const cellChangesAfter = await this.calculateRecordDataMap(
      prisma,
      recordDataMapRemains,
      fkRecordMap
    );
    // console.log('cellChangesAfter', cellChangesAfter);
    const changes = cellChangesBefore.concat(cellChangesAfter);
    return this.formatOpsByChanges(changes);
  }

  async calculate(
    prisma: Prisma.TransactionClient,
    tableId: string,
    recordData: IRecordData[],
    fkRecordMap: IFkRecordMapByDbTableName
  ) {
    if (!recordData.length) {
      return [];
    }
    const { undirectedGraph, startFieldIds, extraRecordIdItems } = await this.getUndirectedGraph(
      prisma,
      recordData
    );
    if (!undirectedGraph.length) {
      return [];
    }

    // get all related field by undirected graph
    const allFieldIds = this.flatGraph(undirectedGraph);

    // prepare all related data
    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.createAuxiliaryData(prisma, allFieldIds);

    // nameConsole('recordData', recordData, fieldMap);
    // nameConsole('allFieldIds', allFieldIds, fieldMap);
    // nameConsole('undirectedGraph', undirectedGraph, fieldMap);

    // topological sorting
    const topoOrdersByFieldId = startFieldIds.reduce<{
      [fieldId: string]: ITopoItem[];
    }>((pre, fieldId) => {
      pre[fieldId] = this.getTopologicalOrder(fieldId, undirectedGraph);
      return pre;
    }, {});
    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);

    // submitted changed records
    const originRecordItems = recordData.map((record) => ({
      dbTableName: tableId2DbTableName[tableId],
      fieldId: record.fieldId,
      newValue: record.newValue,
      id: record.id,
    }));
    // nameConsole('originRecordItems:', originRecordItems, fieldMap);

    // the origin change will lead to affected record changes
    let affectedRecordItems: IRecordRefItem[] = [];
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
      // only affected records included
      const originRecordIdItems = extraRecordIdItems
        .map((item) => ({
          dbTableName: tableId2DbTableName[item.tableId],
          id: item.id,
        }))
        .concat(originRecordItems);
      // nameConsole('getAffectedRecordItems:originRecordIdItems', originRecordIdItems, fieldMap);
      // nameConsole('getAffectedRecordItems:topoOrder', linkOrders, fieldMap);
      const items = await this.getAffectedRecordItems(prisma, originRecordIdItems, linkOrders);
      // nameConsole('fieldId:', { fieldId }, fieldMap);
      // nameConsole('affectedRecordItems:', items, fieldMap);
      affectedRecordItems = affectedRecordItems.concat(items);
    }
    // console.log('affectedRecordItems', JSON.stringify(affectedRecordItems, null, 2));

    const dependentRecordItems = await this.getDependentRecordItems(prisma, affectedRecordItems);
    // nameConsole('dependentRecordItems', dependentRecordItems, fieldMap);

    // record data source
    const dbTableName2records = await this.getRecordsBatch(prisma, {
      originRecordItems,
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
        this.collectChanges(
          orderWithRecords,
          fieldMap,
          fieldId2TableId,
          tableId2DbTableName,
          fkRecordMap
        )
      );
    }, []);

    return this.mergeDuplicateChange(changes);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private splitOpsMapToRecordDataMap(opsMap: IOpsMap) {
    const recordDataMapWithDelete: IRecordDataMap = {};
    const recordDataMapRemains: IRecordDataMap = {};
    for (const tableId in opsMap) {
      const recordDataRemains: IRecordData[] = [];
      const recordDataWithDeleteLink: IRecordData[] = [];
      for (const recordId in opsMap[tableId]) {
        opsMap[tableId][recordId].forEach((op) => {
          const ctx = OpBuilder.editor.setRecord.detect(op);
          if (!ctx) {
            throw new Error('invalid op, it should detect by OpBuilder.editor.setRecord.detect');
          }
          if (isLinkCellValue(ctx.oldValue) || isLinkCellValue(ctx.newValue)) {
            ctx.oldValue &&
              recordDataWithDeleteLink.push({
                id: recordId,
                fieldId: ctx.fieldId,
                oldValue: ctx.oldValue,
                newValue: null,
              });
            ctx.newValue &&
              recordDataRemains.push({
                id: recordId,
                fieldId: ctx.fieldId,
                newValue: ctx.newValue,
              });
          } else {
            recordDataRemains.push({
              id: recordId,
              fieldId: ctx.fieldId,
              oldValue: ctx.oldValue,
              newValue: ctx.newValue,
            });
          }
        });
      }
      recordDataMapWithDelete[tableId] = recordDataWithDeleteLink;
      recordDataMapRemains[tableId] = recordDataRemains;
    }

    return {
      recordDataMapWithDelete,
      recordDataMapRemains,
    };
  }

  private async getUndirectedGraph(prisma: Prisma.TransactionClient, recordData: IRecordData[]) {
    let startFieldIds = recordData.map((data) => data.fieldId);
    const linkedData = recordData.filter(
      (data) => isLinkCellValue(data.newValue) || isLinkCellValue(data.oldValue)
    );
    const linkFieldIds = linkedData.map((data) => data.fieldId);
    // we need add extra record id items for lookup effect dependency update when link field change
    // only need a single one id in one linkedData item
    const effectedRecordIds: string[] = linkedData.reduce<string[]>((pre, data) => {
      const linkValues = data.newValue || data.oldValue;
      if (Array.isArray(linkValues)) {
        pre.push((linkValues[0] as ILinkCellValue).id);
      } else {
        pre.push((linkValues as ILinkCellValue).id);
      }
      return pre;
    }, []);
    let foreignTableId: string | undefined;

    // when link cell change, we need to get all lookup field
    if (linkFieldIds.length) {
      const lookupFieldRaw = await prisma.field.findMany({
        where: { lookupLinkedFieldId: { in: linkFieldIds }, deletedTime: null },
        select: { id: true, lookupOptions: true },
      });
      lookupFieldRaw.forEach((field) => {
        const lookupOptions = JSON.parse(field.lookupOptions as string) as ILookupOptionsVo;
        foreignTableId = lookupOptions.foreignTableId;
        startFieldIds.push(lookupOptions.lookupFieldId);
      });
    }
    startFieldIds = uniq(startFieldIds);
    const undirectedGraph = await this.getDependentNodesCTE(prisma, startFieldIds);

    return {
      undirectedGraph,
      startFieldIds,
      extraRecordIdItems: foreignTableId
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          effectedRecordIds.map((id) => ({ id, tableId: foreignTableId! }))
        : [],
    };
  }

  private async calculateRecordDataMap(
    prisma: Prisma.TransactionClient,
    recordDataMap: IRecordDataMap,
    fkRecordMap: IFkRecordMapByDbTableName
  ) {
    const cellChanges: ICellChange[] = [];
    for (const tableId in recordDataMap) {
      const recordData = this.mergeDuplicateRecordData(recordDataMap[tableId]);
      const change = await this.calculate(prisma, tableId, recordData, fkRecordMap);
      cellChanges.push(...change);
    }
    return cellChanges;
  }

  // for lookup field, cellValues should be flat
  private flatOriginLookup(lookupValues: unknown[] | unknown) {
    if (Array.isArray(lookupValues)) {
      const filtered = lookupValues.flat().filter((value) => value != null);
      return filtered.length ? filtered : null;
    }
    return lookupValues;
  }

  private calculateComputeField(
    field: IFieldInstance,
    fieldMap: { [fieldId: string]: IFieldInstance },
    recordItem: IRecordItem,
    fieldId2TableId: { [fieldId: string]: string },
    tableId2DbTableName: { [tableId: string]: string },
    fkRecordMap: IFkRecordMapByDbTableName
  ) {
    const record = recordItem.record;
    if (field.type === FieldType.Link || field.lookupOptions) {
      if (!recordItem.dependencies) {
        throw new Error(`Dependency should not be undefined when contains a computed field`);
      }
      const lookupFieldId = field.lookupOptions
        ? field.lookupOptions.lookupFieldId
        : (field.options as ILinkFieldOptions).lookupFieldId;
      const relationship = field.lookupOptions
        ? field.lookupOptions.relationship
        : (field.options as ILinkFieldOptions).relationship;

      if (!lookupFieldId) {
        throw new Error('lookupFieldId should not be undefined');
      }

      if (!relationship) {
        throw new Error('relationship should not be undefined');
      }

      const lookupField = fieldMap[lookupFieldId];
      // nameConsole('calculateLookup:dependencies', recordItem.dependencies, fieldMap);
      const lookupValues = this.calculateLookup(
        field,
        lookupField,
        recordItem,
        fieldId2TableId,
        tableId2DbTableName,
        fkRecordMap
      );

      // console.log('calculateLookup:dependencies', recordItem.dependencies);
      // console.log('calculateLookup:lookupValues', lookupValues);

      if (field.isLookup) {
        return this.flatOriginLookup(lookupValues);
      }

      return this.calculateRollup(field, relationship, lookupField, record, lookupValues);
    }

    if (field.type === FieldType.Formula) {
      return this.calculateFormula(field, fieldMap, recordItem);
    }

    throw new Error(`Unsupported field type ${field.type}`);
  }

  private calculateFormula(
    field: IFieldInstance,
    fieldMap: { [fieldId: string]: IFieldInstance },
    recordItem: IRecordItem
  ) {
    if (field.type === FieldType.Formula) {
      const typedValue = evaluate(field.options.expression, fieldMap, recordItem.record);
      return typedValue.toPlain();
    }
  }

  /**
   * lookup values should filter by foreignKey === null
   * because fkField is delete after calculation.
   * checkout calculateOpsMap for detail logic.
   */
  private calculateLookup(
    field: IFieldInstance,
    lookupField: IFieldInstance,
    recordItem: IRecordItem,
    fieldId2TableId: { [fieldId: string]: string },
    tableId2DbTableName: { [tableId: string]: string },
    fkRecordTableMap: IFkRecordMapByDbTableName
  ) {
    const fieldId = lookupField.id;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const dependencies = recordItem.dependencies!;

    const fkFieldId = Array.isArray(dependencies) ? lookupField.id : field.id;
    const tableId = fieldId2TableId[fkFieldId];
    const dbTableName = tableId2DbTableName[tableId];
    const fkRecordMap = fkRecordTableMap[dbTableName];
    const fkFieldName = field.lookupOptions?.dbForeignKeyName || '';

    if (Array.isArray(dependencies)) {
      return dependencies
        .filter(
          (depRecord) =>
            fkRecordMap?.[depRecord.id]?.[fkFieldName] === undefined ||
            fkRecordMap?.[depRecord.id]?.[fkFieldName] === recordItem.record.id
        )
        .map((depRecord) => depRecord.fields[fieldId]);
    }

    if (fkRecordMap?.[recordItem.record.id]?.[fkFieldName] === null) {
      return null;
    }
    return dependencies.fields[fieldId] || null;
  }

  private calculateRollup(
    field: IFieldInstance,
    relationship: Relationship,
    lookupField: IFieldInstance,
    record: IRecord,
    lookupValues: unknown
  ): unknown {
    if (field.type !== FieldType.Link && field.type !== FieldType.Rollup) {
      throw new Error('rollup only support link and rollup field currently');
    }

    const fieldVo = instanceToPlain(lookupField, { excludePrefixes: ['_'] }) as FieldVo;
    const virtualField = createFieldInstanceByVo({
      ...fieldVo,
      id: 'values',
      isMultipleCellValue: fieldVo.isMultipleCellValue || relationship !== Relationship.ManyOne,
    });

    if (field.type === FieldType.Rollup) {
      // console.log('calculateRollup', field, lookupField, record, lookupValues);
      return field
        .evaluate(
          { values: virtualField },
          { ...record, fields: { ...record.fields, values: lookupValues } }
        )
        .toPlain();
    }

    if (field.type === FieldType.Link) {
      if (!record.fields[field.id]) {
        return null;
      }

      const result = evaluate(
        'TEXT_ALL({values})',
        { values: virtualField },
        { ...record, fields: { ...record.fields, values: lookupValues } }
      );

      let plain = result.toPlain();
      if (!field.isMultipleCellValue && virtualField.isMultipleCellValue) {
        plain = virtualField.cellValue2String(plain);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return field.updateCellTitle(record.fields[field.id] as any, plain);
    }
  }

  private async updateForeignKey(
    prisma: Prisma.TransactionClient,
    fkRecordMap: IFkRecordMapByDbTableName
  ) {
    for (const dbTableName in fkRecordMap) {
      for (const recordId in fkRecordMap[dbTableName]) {
        const updateParam = fkRecordMap[dbTableName][recordId];
        const nativeSql = this.knex(dbTableName)
          .update(updateParam)
          .where('__id', recordId)
          .toSQL()
          .toNative();

        await prisma.$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
      }
    }
  }

  private changeToOp(change: ICellChange) {
    const { fieldId, oldValue, newValue } = change;
    return OpBuilder.editor.setRecord.build({
      fieldId,
      oldCellValue: oldValue,
      newCellValue: newValue,
    });
  }

  formatOpsByChanges(changes: ICellChange[]) {
    return changes.reduce<{
      [tableId: string]: { [recordId: string]: IOtOperation[] };
    }>((pre, cur) => {
      const { tableId: curTableId, recordId: curRecordId } = cur;
      const op = this.changeToOp(cur);

      if (!pre[curTableId]) {
        pre[curTableId] = {};
      }
      if (!pre[curTableId][curRecordId]) {
        pre[curTableId][curRecordId] = [];
      }
      pre[curTableId][curRecordId].push(op);

      return pre;
    }, {});
  }

  private async createAuxiliaryData(prisma: Prisma.TransactionClient, allFieldIds: string[]) {
    const fieldRaws = await prisma.field.findMany({
      where: { id: { in: allFieldIds }, deletedTime: null },
    });

    const extraLinkFieldIds = difference(
      fieldRaws
        .filter((field) => field.lookupLinkedFieldId)
        .map((field) => field.lookupLinkedFieldId as string),
      allFieldIds
    );

    const extraLinkFieldRaws = await prisma.field.findMany({
      where: { id: { in: extraLinkFieldIds }, deletedTime: null },
    });

    fieldRaws.push(...extraLinkFieldRaws);

    const fieldId2TableId = fieldRaws.reduce<{ [fieldId: string]: string }>((pre, f) => {
      pre[f.id] = f.tableId;
      return pre;
    }, {});

    const tableIds = uniq(Object.values(fieldId2TableId));
    const tableMeta = await prisma.tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { id: true, dbTableName: true },
    });

    const tableId2DbTableName = tableMeta.reduce<{ [tableId: string]: string }>((pre, t) => {
      pre[t.id] = t.dbTableName;
      return pre;
    }, {});

    const fieldMap = fieldRaws.reduce<{ [fieldId: string]: IFieldInstance }>((pre, f) => {
      pre[f.id] = createFieldInstanceByRaw(f);
      return pre;
    }, {});

    const dbTableName2fields = fieldRaws.reduce<{ [fieldId: string]: IFieldInstance[] }>(
      (pre, f) => {
        const dbTableName = tableId2DbTableName[f.tableId];
        if (pre[dbTableName]) {
          pre[dbTableName].push(fieldMap[f.id]);
        } else {
          pre[dbTableName] = [fieldMap[f.id]];
        }
        return pre;
      },
      {}
    );

    return {
      fieldMap,
      fieldId2TableId,
      dbTableName2fields,
      tableId2DbTableName,
    };
  }

  private collectChanges(
    orders: ITopoItemWithRecords[],
    fieldMap: { [fieldId: string]: IFieldInstance },
    fieldId2TableId: { [fieldId: string]: string },
    tableId2DbTableName: { [tableId: string]: string },
    fkRecordMap: IFkRecordMapByDbTableName
  ) {
    // detail changes
    const changes: ICellChange[] = [];

    orders.forEach((item) => {
      item.recordItems.forEach((recordItem) => {
        const field = fieldMap[item.id];
        // console.log('collectChanges:recordItems:', field, recordItem);
        if (!field.isComputed && field.type !== FieldType.Link) {
          return;
        }
        const record = recordItem.record;
        const value = this.calculateComputeField(
          field,
          fieldMap,
          recordItem,
          fieldId2TableId,
          tableId2DbTableName,
          fkRecordMap
        );
        // console.log(`calculated: ${field.id}.${record.id}`, recordItem.record.fields, value);
        const oldValue = record.fields[field.id];
        record.fields[field.id] = value;
        if (oldValue !== value) {
          changes.push({
            tableId: fieldId2TableId[field.id],
            fieldId: field.id,
            recordId: record.id,
            oldValue,
            newValue: value,
          });
        }
      });
    });
    return changes;
  }

  private recordRaw2Record(
    fields: IFieldInstance[],
    raw: { [dbFieldName: string]: unknown } & IVisualTableDefaultField
  ) {
    const fieldsData = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
      acc[field.id] = field.convertDBValue2CellValue(raw[field.dbFieldName] as string);
      return acc;
    }, {});

    return {
      fields: fieldsData,
      id: raw.__id,
      createdTime: raw.__created_time?.toISOString(),
      lastModifiedTime: raw.__last_modified_time?.toISOString(),
      createdBy: raw.__created_by,
      lastModifiedBy: raw.__last_modified_by,
      recordOrder: {},
    };
  }

  private getLinkOrderFromTopoOrders(params: {
    fieldId2TableId: { [fieldId: string]: string };
    tableId2DbTableName: { [tableId: string]: string };
    topoOrders: ITopoItem[];
    fieldMap: { [fieldId: string]: IFieldInstance };
  }): ITopoLinkOrder[] {
    const newOrder: ITopoLinkOrder[] = [];
    const { tableId2DbTableName, fieldId2TableId, topoOrders, fieldMap } = params;
    for (const item of topoOrders) {
      const field = fieldMap[item.id];
      const tableId = fieldId2TableId[field.id];
      const dbTableName = tableId2DbTableName[tableId];
      if (field.lookupOptions) {
        const { dbForeignKeyName, relationship, foreignTableId, linkFieldId } = field.lookupOptions;
        const linkedTable = tableId2DbTableName[foreignTableId];

        newOrder.push({
          dbTableName,
          fieldId: linkFieldId,
          foreignKeyField: dbForeignKeyName,
          linkedTable,
          relationship,
        });
        continue;
      }

      if (field.type === FieldType.Link) {
        const { dbForeignKeyName, foreignTableId } = field.options;
        const linkedTable = tableId2DbTableName[foreignTableId];

        newOrder.push({
          dbTableName,
          fieldId: field.id,
          foreignKeyField: dbForeignKeyName,
          linkedTable,
          relationship: field.options.relationship,
        });
      }
    }
    return newOrder;
  }

  private async getRecordsBatch(
    prisma: Prisma.TransactionClient,
    params: {
      originRecordItems: { dbTableName: string; id: string; fieldId: string; newValue: unknown }[];
      dbTableName2fields: { [tableId: string]: IFieldInstance[] };
      affectedRecordItems: IRecordRefItem[];
      dependentRecordItems: IRecordRefItem[];
    }
  ) {
    const { originRecordItems, affectedRecordItems, dependentRecordItems, dbTableName2fields } =
      params;
    const recordIdsByTableName = groupBy(
      [...affectedRecordItems, ...dependentRecordItems, ...originRecordItems],
      'dbTableName'
    );

    const results: {
      [tableName: string]: { [fieldName: string]: unknown }[];
    } = {};
    for (const dbTableName in recordIdsByTableName) {
      // deduplication is needed
      const recordIds = uniq(recordIdsByTableName[dbTableName].map((r) => r.id));
      const fieldNames = dbTableName2fields[dbTableName]
        .map((f) => f.dbFieldName)
        .concat([...preservedFieldName]);
      const nativeSql = this.knex(dbTableName)
        .select(fieldNames)
        .whereIn('__id', recordIds)
        .toSQL()
        .toNative();
      const result = await prisma.$queryRawUnsafe<{ [fieldName: string]: unknown }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );
      results[dbTableName] = result;
    }

    const formattedResults = this.formatRecordQueryResult(results, dbTableName2fields);

    this.coverRecordData(originRecordItems, formattedResults);

    return formattedResults;
  }

  private getOneManyDependencies(params: {
    linkFieldId: string;
    record: IRecord;
    foreignTableRecords: IRecord[];
    dependentRecordItems: IRecordRefItem[];
  }): IRecord[] {
    const { linkFieldId, dependentRecordItems, record, foreignTableRecords } = params;

    return dependentRecordItems
      .filter((item) => item.relationTo === record.id && item.fieldId === linkFieldId)
      .map((item) => {
        const record = foreignTableRecords.find((r) => r.id === item.id);
        if (!record) {
          throw new Error('Can not find link record');
        }
        return record;
      });
  }

  private getMany2OneDependency(params: {
    record: IRecord;
    foreignTableRecords: IRecord[];
    affectedRecordItems: IRecordRefItem[];
  }): IRecord {
    const { record, affectedRecordItems, foreignTableRecords } = params;
    const linkRecordRef = affectedRecordItems
      .filter((item) => item.relationTo)
      .find((item) => item.id === record.id);
    if (!linkRecordRef) {
      throw new Error('Can not find link record ref');
    }

    const linkRecord = foreignTableRecords.find((r) => r.id === linkRecordRef.relationTo);
    if (!linkRecord) {
      throw new Error('Can not find link record');
    }
    return linkRecord;
  }

  private getDependencyRecordItems(params: {
    linkFieldId: string;
    relationship: Relationship;
    records: IRecord[];
    foreignTableRecords: IRecord[];
    affectedRecordItems: IRecordRefItem[];
    dependentRecordItems: IRecordRefItem[];
  }) {
    const {
      linkFieldId,
      records,
      relationship,
      foreignTableRecords,
      dependentRecordItems,
      affectedRecordItems,
    } = params;
    const dependenciesArr = records.map((record) => {
      if (relationship === Relationship.OneMany) {
        return this.getOneManyDependencies({
          record,
          linkFieldId: linkFieldId,
          foreignTableRecords,
          dependentRecordItems,
        });
      }
      if (relationship === Relationship.ManyOne) {
        return this.getMany2OneDependency({
          record,
          foreignTableRecords,
          affectedRecordItems,
        });
      }
      throw new Error('Unsupported relationship');
    });
    return records.map((record, i) => ({ record, dependencies: dependenciesArr[i] }));
  }

  private createTopoItemWithRecords(params: {
    topoOrders: ITopoItem[];
    tableId2DbTableName: { [tableId: string]: string };
    fieldId2TableId: { [fieldId: string]: string };
    fieldMap: { [fieldId: string]: IFieldInstance };
    dbTableName2records: { [tableName: string]: IRecord[] };
    affectedRecordItems: IRecordRefItem[];
    dependentRecordItems: IRecordRefItem[];
  }): ITopoItemWithRecords[] {
    const {
      topoOrders,
      fieldMap,
      tableId2DbTableName,
      fieldId2TableId,
      dbTableName2records,
      affectedRecordItems,
      dependentRecordItems,
    } = params;
    const affectedRecordItemIndexed = groupBy(affectedRecordItems, 'dbTableName');
    const dependentRecordItemIndexed = groupBy(dependentRecordItems, 'dbTableName');
    return topoOrders.map((order) => {
      const field = fieldMap[order.id];
      const tableId = fieldId2TableId[order.id];
      const dbTableName = tableId2DbTableName[tableId];
      const allRecords = dbTableName2records[dbTableName];
      const affectedRecordItems = affectedRecordItemIndexed[dbTableName];
      // only affected record need to be calculated
      const records = intersectionBy(allRecords, affectedRecordItems, 'id');

      const appendRecordItems = (
        foreignTableId: string,
        linkFieldId: string,
        relationship: Relationship
      ) => {
        const foreignTableName = tableId2DbTableName[foreignTableId];
        const foreignTableRecords = dbTableName2records[foreignTableName];
        const dependentRecordItems = dependentRecordItemIndexed[foreignTableName];
        return {
          ...order,
          recordItems: this.getDependencyRecordItems({
            linkFieldId,
            relationship,
            records,
            foreignTableRecords,
            affectedRecordItems,
            dependentRecordItems,
          }),
        };
      };

      // update cross table dependency (from lookup or link field)
      if (field.lookupOptions) {
        const { foreignTableId, linkFieldId, relationship } = field.lookupOptions;
        return appendRecordItems(foreignTableId, linkFieldId, relationship);
      }

      if (field.type === FieldType.Link) {
        const { foreignTableId, relationship } = field.options;
        return appendRecordItems(foreignTableId, field.id, relationship);
      }

      return {
        ...order,
        recordItems: records.map((record) => ({ record })),
      };
    });
  }

  private formatRecordQueryResult(
    formattedResults: {
      [tableName: string]: { [dbFiendName: string]: unknown }[];
    },
    dbTableName2fields: { [tableId: string]: IFieldInstance[] }
  ): {
    [tableName: string]: IRecord[];
  } {
    return Object.entries(formattedResults).reduce<{
      [dbTableName: string]: IRecord[];
    }>((acc, e) => {
      const [dbTableName, recordMap] = e;
      const fields = dbTableName2fields[dbTableName];
      acc[dbTableName] = recordMap.map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.recordRaw2Record(fields, r as any);
      });
      return acc;
    }, {});
  }

  // use modified record data to cover the record data from db
  private coverRecordData(
    newRecordData: { id: string; dbTableName: string; fieldId: string; newValue: unknown }[],
    allRecordByDbTableName: { [tableName: string]: IRecord[] }
  ) {
    newRecordData.forEach((cover) => {
      const records = allRecordByDbTableName[cover.dbTableName];
      const record = records.find((r) => r.id === cover.id);
      if (!record) {
        throw new Error('Can not find record in DB');
      }
      record.fields[cover.fieldId] = cover.newValue;
    });
  }

  private getTopologicalOrder(
    startNodeId: string,
    graph: { toFieldId: string; fromFieldId: string }[]
  ): ITopoItem[] {
    const visitedNodes = new Set<string>();
    const sortedNodes: ITopoItem[] = [];

    function visit(node: string) {
      if (!visitedNodes.has(node)) {
        visitedNodes.add(node);

        const incomingEdges = graph.filter((edge) => edge.toFieldId === node);
        const outgoingEdges = graph.filter((edge) => edge.fromFieldId === node);
        const dependencies: string[] = [];

        for (const edge of incomingEdges) {
          dependencies.push(edge.fromFieldId);
        }

        for (const edge of outgoingEdges) {
          visit(edge.toFieldId);
        }

        sortedNodes.push({ id: node, dependencies: uniq(dependencies) });
      }
    }

    visit(startNodeId);

    sortedNodes.pop();
    return sortedNodes.reverse();
  }

  private async getDependentNodesCTE(prisma: Prisma.TransactionClient, startFieldIds: string[]) {
    let result: { fromFieldId: string; toFieldId: string }[] = [];
    const getResult = async (startFieldId: string) => {
      const dependentNodesQuery = Prisma.sql`
        WITH RECURSIVE connected_reference(from_field_id, to_field_id) AS (
          SELECT from_field_id, to_field_id FROM reference WHERE from_field_id = ${startFieldId} OR to_field_id = ${startFieldId}
          UNION
          SELECT deps.from_field_id, deps.to_field_id
          FROM reference deps
          JOIN connected_reference cd
            ON (deps.from_field_id = cd.from_field_id AND deps.to_field_id != cd.to_field_id) 
            OR (deps.from_field_id = cd.to_field_id AND deps.to_field_id != cd.from_field_id) 
            OR (deps.to_field_id = cd.from_field_id AND deps.from_field_id != cd.to_field_id) 
            OR (deps.to_field_id = cd.to_field_id AND deps.from_field_id != cd.from_field_id)
        )
        SELECT DISTINCT from_field_id, to_field_id FROM connected_reference;
      `;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      return await prisma.$queryRaw<{ from_field_id: string; to_field_id: string }[]>(
        dependentNodesQuery
      );
    };

    for (const fieldId of startFieldIds) {
      const queryResult = await getResult(fieldId);
      result = result.concat(
        queryResult.map((row) => ({ fromFieldId: row.from_field_id, toFieldId: row.to_field_id }))
      );
    }

    return result;
  }

  /**
   * when update multi field in a record, there may be duplicate change.
   * see this case, A and B update at the same time
   * A -> C -> E
   * A -> D -> E
   * B -> D -> E
   * D will be calculated twice
   * E will be calculated twice
   * so we need to merge duplicate change to reduce update times
   */
  private mergeDuplicateChange(changes: ICellChange[]) {
    const indexCache: { [key: string]: number } = {};
    const mergedChanges: ICellChange[] = [];

    for (const change of changes) {
      const key = `${change.tableId}#${change.fieldId}#${change.recordId}`;
      if (indexCache[key] !== undefined) {
        mergedChanges[indexCache[key]].newValue = change.newValue;
      } else {
        indexCache[key] = mergedChanges.length;
        mergedChanges.push(change);
      }
    }
    return mergedChanges;
  }

  private mergeDuplicateRecordData(recordData: IRecordData[]) {
    const indexCache: { [key: string]: number } = {};
    const mergedChanges: IRecordData[] = [];

    for (const record of recordData) {
      const key = `${record.id}#${record.fieldId}`;
      if (indexCache[key] !== undefined) {
        mergedChanges[indexCache[key]] = record;
      } else {
        indexCache[key] = mergedChanges.length;
        mergedChanges.push(record);
      }
    }
    return mergedChanges;
  }

  /**
   * affected record changes need extra dependent record to calculate result
   * example: C = A + B
   * A changed, C will be affected and B is the dependent record
   */
  private async getDependentRecordItems(
    prisma: Prisma.TransactionClient,
    recordItems: IRecordRefItem[]
  ): Promise<IRecordRefItem[]> {
    if (!recordItems.length) {
      return [];
    }

    const queries = recordItems
      .filter((item) => item.selectIn)
      .map((item) => {
        const { id, fieldId, selectIn } = item;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const [dbTableName, selectField] = selectIn!.split('.');
        return this.knex
          .select([
            `${dbTableName}.__id as id`,
            `${dbTableName}.${selectField} as relationTo`,
            this.knex.raw(`'${dbTableName}' as dbTableName`),
            this.knex.raw(`'${fieldId}' as fieldId`),
          ])
          .from(dbTableName)
          .where(selectField, id);
      });
    if (!queries.length) {
      return [];
    }

    const [firstQuery, ...restQueries] = queries;
    const nativeSql = firstQuery.union(restQueries).toSQL().toNative();

    return await prisma.$queryRawUnsafe<IRecordRefItem[]>(nativeSql.sql, ...nativeSql.bindings);
  }

  private async getAffectedRecordItems(
    prisma: Prisma.TransactionClient,
    originRecordIdItems: { dbTableName: string; id: string }[],
    topoOrder: ITopoLinkOrder[]
  ): Promise<IRecordRefItem[]> {
    if (!topoOrder.length) {
      return originRecordIdItems;
    }
    // Initialize the base case for the recursive CTE)
    const initTableName = topoOrder[0].linkedTable;
    let cteQuery = `
    SELECT __id, '${initTableName}' as dbTableName, null as selectIn, null as relationTo, null as fieldId
    FROM ${initTableName} WHERE __id IN (${originRecordIdItems.map((r) => `'${r.id}'`).join(',')})`;

    // Iterate over the nodes in topological order
    for (let i = 0; i < topoOrder.length; i++) {
      const currentOrder = topoOrder[i];
      const { fieldId, foreignKeyField, dbTableName, linkedTable } = currentOrder;

      // Append the current node to the recursive CTE
      if (currentOrder.relationship === Relationship.OneMany) {
        cteQuery += `
        UNION
        SELECT ${linkedTable}.${foreignKeyField} as __id, '${dbTableName}' as dbTableName, '${linkedTable}.${foreignKeyField}' as selectIn , null as relationTo, '${fieldId}' as fieldId
        FROM ${linkedTable}
        JOIN affected_records
        ON ${linkedTable}.__id = affected_records.__id
        WHERE affected_records.dbTableName = '${linkedTable}'`;
      } else {
        cteQuery += `
        UNION
        SELECT ${dbTableName}.__id, '${dbTableName}' as dbTableName, null as selectIn, affected_records.__id as relationTo, '${fieldId}' as fieldId
        FROM ${dbTableName}
        JOIN affected_records
        ON ${dbTableName}.${foreignKeyField} = affected_records.__id
        WHERE affected_records.dbTableName = '${linkedTable}'`;
      }
    }

    // Construct the final query using the recursive CTE
    const finalQuery = `
    WITH affected_records AS (${cteQuery})
    SELECT * FROM affected_records`;

    // console.log('getAffectedRecordItems:', finalQuery);

    const results = await prisma.$queryRawUnsafe<
      {
        __id: string;
        dbTableName: string;
        selectIn?: string;
        fieldId?: string;
        relationTo?: string;
      }[]
    >(finalQuery);

    // console.log('getAffectedRecordItems:result:', results);

    if (!results.length) {
      return originRecordIdItems;
    }

    // only need to return result with relationTo or selectIn
    return results
      .filter((record) => record.__id && (record.selectIn || record.relationTo))
      .map((record) => ({
        id: record.__id,
        dbTableName: record.dbTableName,
        ...(record.relationTo ? { relationTo: record.relationTo } : {}),
        ...(record.fieldId ? { fieldId: record.fieldId } : {}),
        ...(record.selectIn ? { selectIn: record.selectIn } : {}),
      }));
  }

  private flatGraph(graph: { toFieldId: string; fromFieldId: string }[]) {
    const allNodes = new Set<string>();
    for (const edge of graph) {
      allNodes.add(edge.fromFieldId);
      allNodes.add(edge.toFieldId);
    }
    return Array.from(allNodes);
  }
}
