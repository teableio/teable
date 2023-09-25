import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  IFieldVo,
  ILinkCellValue,
  ILinkFieldOptions,
  ILookupOptionsVo,
  IOtOperation,
  ITinyRecord,
} from '@teable-group/core';
import { evaluate, FieldType, RecordOpBuilder, Relationship } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { Knex } from 'knex';
import { difference, groupBy, intersectionBy, isEmpty, keyBy, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { IDbProvider } from '../../db-provider/interface/db.provider.interface';
import { preservedFieldName } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../field/model/factory';
import type { FormulaFieldDto } from '../field/model/field-dto/formula-field.dto';
import type { ICellChange } from './utils/changes';
import { formatChangesToOps, mergeDuplicateChange } from './utils/changes';
import { isLinkCellValue } from './utils/detect-link';

// eslint-disable-next-line @typescript-eslint/no-unused-vars

export interface ITopoItem {
  id: string;
  dependencies: string[];
}

export interface IGraphItem {
  fromFieldId: string;
  toFieldId: string;
}

export interface IFieldMap {
  [fieldId: string]: IFieldInstance;
}

export interface IRecordItem {
  record: ITinyRecord;
  dependencies?: ITinyRecord | ITinyRecord[];
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

export interface IOpsMap {
  [tableId: string]: {
    [keyId: string]: IOtOperation[];
  };
}

export interface ITopoItemWithRecords extends ITopoItem {
  recordItems: IRecordItem[];
}

export interface IFkOpMap {
  [dbTableName: string]: {
    [recordId: string]: {
      [fkField: string]: string | null;
    };
  };
}

export interface ITopoLinkOrder {
  dbTableName: string;
  fieldId: string;
  foreignKeyField: string;
  relationship: Relationship;
  linkedTable: string;
}

export interface IRecordRefItem {
  id: string;
  dbTableName: string;
  fieldId?: string;
  selectIn?: string;
  relationTo?: string;
}

@Injectable()
export class ReferenceService {
  private readonly logger = new Logger(ReferenceService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel() private readonly knex: Knex,
    @Inject('DbProvider') private dbProvider: IDbProvider
  ) {}

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
   *
   * fkOpMap is a map of foreignKey update operation. linkDerivation generate fkOpMap operation,
   * but we need it do calculation, so we have to pass origin fkOpMap it to calculateOpsMap.
   */
  async calculateOpsMap(opsMap: IOpsMap, fkOpMap: IFkOpMap = {}) {
    const { recordDataMapWithDelete, recordDataMapRemains } =
      this.splitOpsMapToRecordDataMap(opsMap);

    // console.log('recordDataMapWithDelete', JSON.stringify(recordDataMapWithDelete, null, 2));
    // console.log('recordDataMapRemains', JSON.stringify(recordDataMapRemains, null, 2));
    // console.log('updateForeignKey:', JSON.stringify(fkOpMap, null, 2));
    const resultBefore = await this.calculateRecordDataMap(recordDataMapWithDelete, fkOpMap);
    // console.log('resultBefore', resultBefore?.cellChanges);
    await this.updateForeignKey(fkOpMap);
    const resultAfter = await this.calculateRecordDataMap(recordDataMapRemains, fkOpMap);
    // console.log('resultAfter', resultAfter);
    const changes = resultBefore.cellChanges.concat(resultAfter.cellChanges);
    const fieldMap = Object.assign({}, resultBefore.fieldMap, resultAfter.fieldMap);
    const tableId2DbTableName = Object.assign(
      {},
      resultBefore.tableId2DbTableName,
      resultAfter.tableId2DbTableName
    );

    return {
      opsMap: formatChangesToOps(changes),
      fieldMap,
      tableId2DbTableName,
    };
  }

  getTopoOrdersByFieldId(fieldIds: string[], directedGraph: IGraphItem[]) {
    return fieldIds.reduce<{
      [fieldId: string]: ITopoItem[];
    }>((pre, fieldId) => {
      pre[fieldId] = this.getTopologicalOrder(fieldId, directedGraph);
      return pre;
    }, {});
  }

  /**
   * link field should not be the first item in topo order when calculate.
   */
  removeFirstLinkItem(
    fieldMap: IFieldMap,
    topoOrdersByFieldId: {
      [fieldId: string]: ITopoItem[];
    }
  ) {
    return Object.entries(topoOrdersByFieldId).reduce<{
      [fieldId: string]: ITopoItem[];
    }>((pre, [fieldId, topoOrder]) => {
      const firstField = fieldMap[topoOrder[0].id];
      if (!firstField) {
        throw new Error(`field ${topoOrder[0].id} not found`);
      }

      if (firstField.type === FieldType.Link) {
        topoOrder = topoOrder.slice(1);
      }
      pre[fieldId] = topoOrder;
      return pre;
    }, {});
  }

  async prepareCalculation(tableId: string, recordData: IRecordData[]) {
    if (!recordData.length) {
      return;
    }
    const { directedGraph, startFieldIds, extraRecordIdItems } = await this.getDirectedGraph(
      recordData
    );
    if (!directedGraph.length) {
      return;
    }

    // skip calculate when not all field in graph
    const graphSet: Set<string> = new Set(
      directedGraph.flatMap((item) => [item.fromFieldId, item.toFieldId])
    );
    for (const fieldId of startFieldIds) {
      if (!graphSet.has(fieldId)) {
        return;
      }
    }

    // get all related field by undirected graph
    const allFieldIds = this.flatGraph(directedGraph);
    // prepare all related data
    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.createAuxiliaryData(allFieldIds);

    // topological sorting
    const topoOrdersByFieldId = this.removeFirstLinkItem(
      fieldMap,
      this.getTopoOrdersByFieldId(startFieldIds, directedGraph)
    );

    if (isEmpty(topoOrdersByFieldId)) {
      return;
    }

    // nameConsole('recordData', recordData, fieldMap);
    // nameConsole('startFieldIds', startFieldIds, fieldMap);
    // nameConsole('allFieldIds', allFieldIds, fieldMap);
    // nameConsole('directedGraph', directedGraph, fieldMap);
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
    // console.log('fieldMap', fieldMap);
    let affectedRecordItems: IRecordRefItem[] = [];
    for (const fieldId in topoOrdersByFieldId) {
      const topoOrders = topoOrdersByFieldId[fieldId];
      // nameConsole('topoOrders:', topoOrders, fieldMap);
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
      const items = await this.getAffectedRecordItems(linkOrders, originRecordIdItems);
      // nameConsole('fieldId:', { fieldId }, fieldMap);
      // nameConsole('affectedRecordItems:', items, fieldMap);
      affectedRecordItems = affectedRecordItems.concat(items);
    }
    // console.log('affectedRecordItems', JSON.stringify(affectedRecordItems, null, 2));

    const dependentRecordItems = await this.getDependentRecordItems(affectedRecordItems);
    // nameConsole('dependentRecordItems', dependentRecordItems, fieldMap);

    // record data source
    const dbTableName2records = await this.getRecordsBatch({
      originRecordItems,
      affectedRecordItems,
      dependentRecordItems,
      dbTableName2fields,
    });
    // nameConsole('dbTableName2records', dbTableName2records, fieldMap);
    // nameConsole('affectedRecordItems', affectedRecordItems, fieldMap);

    const orderWithRecordsByFieldId = Object.entries(topoOrdersByFieldId).reduce<{
      [fieldId: string]: ITopoItemWithRecords[];
    }>((pre, [fieldId, topoOrders]) => {
      const orderWithRecords = this.createTopoItemWithRecords({
        topoOrders,
        fieldMap,
        tableId2DbTableName,
        fieldId2TableId,
        dbTableName2records,
        affectedRecordItems,
        dependentRecordItems,
      });
      pre[fieldId] = orderWithRecords;
      return pre;
    }, {});
    // nameConsole('orderWithRecordsByFieldId', orderWithRecordsByFieldId, fieldMap);

    return {
      fieldMap,
      fieldId2TableId,
      tableId2DbTableName,
      orderWithRecordsByFieldId,
      dbTableName2records,
    };
  }

  async calculate(tableId: string, recordData: IRecordData[], fkOpMap: IFkOpMap) {
    const result = await this.prepareCalculation(tableId, recordData);
    if (!result) {
      return;
    }

    const { orderWithRecordsByFieldId, fieldMap, fieldId2TableId, tableId2DbTableName } = result;
    const changes = Object.values(orderWithRecordsByFieldId).reduce<ICellChange[]>(
      (pre, orderWithRecords) => {
        // nameConsole('orderWithRecords:', orderWithRecords, fieldMap);
        return pre.concat(
          this.collectChanges(
            orderWithRecords,
            fieldMap,
            fieldId2TableId,
            tableId2DbTableName,
            fkOpMap
          )
        );
      },
      []
    );
    // nameConsole('changes', changes, fieldMap);

    return {
      changes: mergeDuplicateChange(changes),
      fieldMap,
      tableId2DbTableName,
    };
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
          const ctx = RecordOpBuilder.editor.setRecord.detect(op);
          if (!ctx) {
            throw new Error(
              'invalid op, it should detect by RecordOpBuilder.editor.setRecord.detect'
            );
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

  private async getDirectedGraph(recordData: IRecordData[]) {
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
      const lookupFieldRaw = await this.prismaService.txClient().field.findMany({
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
    const directedGraph = await this.getDependentNodesCTE(startFieldIds);

    return {
      directedGraph,
      startFieldIds,
      extraRecordIdItems: foreignTableId
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          effectedRecordIds.map((id) => ({ id, tableId: foreignTableId! }))
        : [],
    };
  }

  /**
   * Generate a directed graph.
   *
   * @param undirectedGraph - The elements of the undirected graph.
   * @param fieldIds - One or more field IDs to start the DFS from.
   * @returns Returns all relations related to the given fieldIds.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private filterDirectedGraph(undirectedGraph: IGraphItem[], fieldIds: string[]): IGraphItem[] {
    const result: IGraphItem[] = [];
    const visited: Set<string> = new Set();

    // Build adjacency lists for quick look-up
    const outgoingAdjList: Record<string, IGraphItem[]> = {};
    const incomingAdjList: Record<string, IGraphItem[]> = {};

    for (const item of undirectedGraph) {
      // Outgoing edges
      if (!outgoingAdjList[item.fromFieldId]) {
        outgoingAdjList[item.fromFieldId] = [];
      }
      outgoingAdjList[item.fromFieldId].push(item);

      // Incoming edges
      if (!incomingAdjList[item.toFieldId]) {
        incomingAdjList[item.toFieldId] = [];
      }
      incomingAdjList[item.toFieldId].push(item);
    }

    function dfs(currentNode: string) {
      visited.add(currentNode);

      // Add incoming edges related to currentNode
      if (incomingAdjList[currentNode]) {
        result.push(...incomingAdjList[currentNode]);
      }

      // Process outgoing edges from currentNode
      if (outgoingAdjList[currentNode]) {
        for (const item of outgoingAdjList[currentNode]) {
          if (!visited.has(item.toFieldId)) {
            result.push(item);
            dfs(item.toFieldId);
          }
        }
      }
    }

    // Run DFS for each specified fieldId
    for (const fieldId of fieldIds) {
      if (!visited.has(fieldId)) {
        dfs(fieldId);
      }
    }

    return result;
  }

  private async calculateRecordDataMap(recordDataMap: IRecordDataMap, fkOpMap: IFkOpMap) {
    const cellChanges: ICellChange[] = [];
    const allTableId2DbTableName: { [tableId: string]: string } = {};
    const allFieldMap: IFieldMap = {};
    for (const tableId in recordDataMap) {
      const recordData = this.mergeDuplicateRecordData(recordDataMap[tableId]);
      const calculateResult = await this.calculate(tableId, recordData, fkOpMap);
      if (calculateResult) {
        const { changes, fieldMap, tableId2DbTableName } = calculateResult;
        Object.assign(allTableId2DbTableName, tableId2DbTableName);
        Object.assign(allFieldMap, fieldMap);
        cellChanges.push(...changes);
      }
    }

    return {
      cellChanges,
      fieldMap: allFieldMap,
      tableId2DbTableName: allTableId2DbTableName,
    };
  }

  // for lookup field, cellValues should be flat and filter
  private flatOriginLookup(lookupValues: unknown[] | unknown) {
    if (Array.isArray(lookupValues)) {
      const flatten = lookupValues.flat().filter((value) => value != null);
      return flatten.length ? flatten : null;
    }
    return lookupValues;
  }

  // for computed field, inner array cellValues should be join to string
  private joinOriginLookup(lookupField: IFieldInstance, lookupValues: unknown[] | unknown) {
    if (Array.isArray(lookupValues)) {
      const flatten = lookupValues.map((value) => {
        if (Array.isArray(value)) {
          return lookupField.cellValue2String(value);
        }
        return value;
      });
      return flatten.length ? flatten : null;
    }
    return lookupValues;
  }

  private calculateComputeField(
    field: IFieldInstance,
    fieldMap: IFieldMap,
    recordItem: IRecordItem,
    fieldId2TableId: { [fieldId: string]: string },
    tableId2DbTableName: { [tableId: string]: string },
    fkRecordMap: IFkOpMap
  ) {
    const record = recordItem.record;
    if (field.type === FieldType.Link || field.lookupOptions) {
      if (!recordItem.dependencies) {
        throw new Error(
          `Dependency should not be undefined when contains a link/lookup/rollup field`
        );
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
      // console.log('calculateLookup:lookupValues', lookupValues, recordItem);

      if (field.isLookup) {
        return this.flatOriginLookup(lookupValues);
      }

      return this.calculateRollup(
        field,
        relationship,
        lookupField,
        record,
        this.joinOriginLookup(lookupField, lookupValues)
      );
    }

    if (field.type === FieldType.Formula) {
      return this.calculateFormula(field, fieldMap, recordItem);
    }

    throw new Error(`Unsupported field type ${field.type}`);
  }

  private calculateFormula(field: FormulaFieldDto, fieldMap: IFieldMap, recordItem: IRecordItem) {
    const typedValue = evaluate(field.options.expression, fieldMap, recordItem.record);
    return typedValue.toPlain();
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
    fkRecordTableMap: IFkOpMap
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
    return dependencies.fields[fieldId] ?? null;
  }

  private calculateRollup(
    field: IFieldInstance,
    relationship: Relationship,
    lookupField: IFieldInstance,
    record: ITinyRecord,
    lookupValues: unknown
  ): unknown {
    if (field.type !== FieldType.Link && field.type !== FieldType.Rollup) {
      throw new Error('rollup only support link and rollup field currently');
    }

    const fieldVo = instanceToPlain(lookupField, { excludePrefixes: ['_'] }) as IFieldVo;
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

  private async updateForeignKey(fkRecordMap: IFkOpMap) {
    for (const dbTableName in fkRecordMap) {
      for (const recordId in fkRecordMap[dbTableName]) {
        const updateParam = fkRecordMap[dbTableName][recordId];
        const nativeSql = this.knex(dbTableName)
          .update(updateParam)
          .where('__id', recordId)
          .toSQL()
          .toNative();

        await this.prismaService.txClient().$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
      }
    }
  }

  async createAuxiliaryData(allFieldIds: string[]) {
    const prisma = this.prismaService.txClient();
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

    const fieldMap = fieldRaws.reduce<IFieldMap>((pre, f) => {
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

  collectChanges(
    orders: ITopoItemWithRecords[],
    fieldMap: IFieldMap,
    fieldId2TableId: { [fieldId: string]: string },
    tableId2DbTableName: { [tableId: string]: string },
    fkRecordMap: IFkOpMap
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
    raw: { [dbFieldName: string]: unknown } & { __id: string }
  ) {
    const fieldsData = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
      acc[field.id] = field.convertDBValue2CellValue(raw[field.dbFieldName] as string);
      return acc;
    }, {});

    return {
      fields: fieldsData,
      id: raw.__id,
      recordOrder: {},
    };
  }

  getLinkOrderFromTopoOrders(params: {
    fieldId2TableId: { [fieldId: string]: string };
    tableId2DbTableName: { [tableId: string]: string };
    topoOrders: ITopoItem[];
    fieldMap: IFieldMap;
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

  async getRecordsBatch(params: {
    originRecordItems: {
      dbTableName: string;
      id: string;
      fieldId?: string;
      newValue?: unknown;
    }[];
    dbTableName2fields: { [tableId: string]: IFieldInstance[] };
    affectedRecordItems: IRecordRefItem[];
    dependentRecordItems: IRecordRefItem[];
  }) {
    const { originRecordItems, affectedRecordItems, dependentRecordItems, dbTableName2fields } =
      params;
    const recordIdsByTableName = groupBy(
      [...affectedRecordItems, ...dependentRecordItems, ...originRecordItems],
      'dbTableName'
    );

    const results: {
      [dbTableName: string]: { [dbFieldName: string]: unknown }[];
    } = {};
    for (const dbTableName in recordIdsByTableName) {
      // deduplication is needed
      const recordIds = uniq(recordIdsByTableName[dbTableName].map((r) => r.id));
      const dbFieldNames = dbTableName2fields[dbTableName]
        .map((f) => f.dbFieldName)
        .concat([...preservedFieldName]);
      const nativeSql = this.knex(dbTableName)
        .select(dbFieldNames)
        .whereIn('__id', recordIds)
        .toSQL()
        .toNative();
      const result = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ [dbFieldName: string]: unknown }[]>(
          nativeSql.sql,
          ...nativeSql.bindings
        );
      results[dbTableName] = result;
    }

    const formattedResults = this.formatRecordQueryResult(results, dbTableName2fields);

    this.coverRecordData(
      originRecordItems.filter((item) => item.fieldId) as {
        dbTableName: string;
        id: string;
        fieldId: string;
        newValue?: unknown;
      }[],
      formattedResults
    );

    return formattedResults;
  }

  private getOneManyDependencies(params: {
    linkFieldId: string;
    record: ITinyRecord;
    foreignTableRecords: ITinyRecord[];
    dependentRecordItems: IRecordRefItem[];
  }): ITinyRecord[] {
    const { linkFieldId, dependentRecordItems, record, foreignTableRecords } = params;
    const foreignTableRecordsIndexed = keyBy(foreignTableRecords, 'id');
    return dependentRecordItems
      .filter((item) => item.relationTo === record.id && item.fieldId === linkFieldId)
      .map((item) => {
        const record = foreignTableRecordsIndexed[item.id];
        if (!record) {
          throw new Error('Can not find link record');
        }
        return record;
      });
  }

  private getMany2OneDependency(params: {
    record: ITinyRecord;
    foreignTableRecords: ITinyRecord[];
    affectedRecordItems: IRecordRefItem[];
  }): ITinyRecord {
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
    records: ITinyRecord[];
    foreignTableRecords: ITinyRecord[];
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
    return records
      .map((record, i) => ({ record, dependencies: dependenciesArr[i] }))
      .filter((item) =>
        Array.isArray(item.dependencies) ? item.dependencies.length : item.dependencies
      );
  }

  createTopoItemWithRecords(params: {
    topoOrders: ITopoItem[];
    tableId2DbTableName: { [tableId: string]: string };
    fieldId2TableId: { [fieldId: string]: string };
    fieldMap: IFieldMap;
    dbTableName2records: { [tableName: string]: ITinyRecord[] };
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
    return topoOrders.reduce<ITopoItemWithRecords[]>((pre, order) => {
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
        if (
          !affectedRecordItems?.find((item) => item.fieldId === field.lookupOptions?.linkFieldId)
        ) {
          return pre;
        }
        const { foreignTableId, linkFieldId, relationship } = field.lookupOptions;
        pre.push(appendRecordItems(foreignTableId, linkFieldId, relationship));
        return pre;
      }

      if (field.type === FieldType.Link) {
        if (!affectedRecordItems?.find((item) => item.fieldId === field.id)) {
          return pre;
        }
        const { foreignTableId, relationship } = field.options;
        pre.push(appendRecordItems(foreignTableId, field.id, relationship));
        return pre;
      }

      pre.push({
        ...order,
        recordItems: records.map((record) => ({ record })),
      });
      return pre;
    }, []);
  }

  formatRecordQueryResult(
    formattedResults: {
      [tableName: string]: { [dbFiendName: string]: unknown }[];
    },
    dbTableName2fields: { [tableId: string]: IFieldInstance[] }
  ) {
    return Object.entries(formattedResults).reduce<{
      [dbTableName: string]: ITinyRecord[];
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
    newRecordData: { id: string; dbTableName: string; fieldId: string; newValue?: unknown }[],
    allRecordByDbTableName: { [tableName: string]: ITinyRecord[] }
  ) {
    newRecordData.forEach((cover) => {
      const records = allRecordByDbTableName[cover.dbTableName];
      const record = records.find((r) => r.id === cover.id);
      if (!record) {
        throw new Error(`Can not find record: ${cover.id} in DB`);
      }
      record.fields[cover.fieldId] = cover.newValue;
    });
  }

  /**
   * Generate a topological order based on the starting node ID.
   *
   * @param startNodeId - The ID to start the search from.
   * @param graph - The input graph.
   * @returns An array of ITopoItem representing the topological order.
   */
  private getTopologicalOrder(
    startNodeId: string,
    graph: { toFieldId: string; fromFieldId: string }[]
  ): ITopoItem[] {
    const visitedNodes = new Set<string>();
    const sortedNodes: ITopoItem[] = [];

    // Build adjacency list and reverse adjacency list
    const adjList: Record<string, string[]> = {};
    const reverseAdjList: Record<string, string[]> = {};
    for (const edge of graph) {
      if (!adjList[edge.fromFieldId]) adjList[edge.fromFieldId] = [];
      adjList[edge.fromFieldId].push(edge.toFieldId);

      if (!reverseAdjList[edge.toFieldId]) reverseAdjList[edge.toFieldId] = [];
      reverseAdjList[edge.toFieldId].push(edge.fromFieldId);
    }

    function visit(node: string) {
      if (!visitedNodes.has(node)) {
        visitedNodes.add(node);

        // Get incoming edges (dependencies)
        const dependencies = reverseAdjList[node] || [];

        // Process outgoing edges
        if (adjList[node]) {
          for (const neighbor of adjList[node]) {
            visit(neighbor);
          }
        }

        sortedNodes.push({ id: node, dependencies: dependencies });
      }
    }

    visit(startNodeId);
    return sortedNodes.reverse();
  }

  async getDependentNodesCTE(startFieldIds: string[]): Promise<IGraphItem[]> {
    let result: { fromFieldId: string; toFieldId: string }[] = [];
    const getResult = async (startFieldId: string) => {
      const _knex = this.knex;

      const nonRecursiveQuery = _knex
        .select('from_field_id', 'to_field_id')
        .from('reference')
        .where({ from_field_id: startFieldId })
        .orWhere({ to_field_id: startFieldId });
      const recursiveQuery = _knex
        .select('deps.from_field_id', 'deps.to_field_id')
        .from('reference as deps')
        .join('connected_reference as cd', function () {
          const sql = '?? = ?? AND ?? != ??';
          const depsFromField = 'deps.from_field_id';
          const depsToField = 'deps.to_field_id';
          const cdFromField = 'cd.from_field_id';
          const cdToField = 'cd.to_field_id';
          this.on(
            _knex.raw(sql, [depsFromField, cdFromField, depsToField, cdToField]).wrap('(', ')')
          );
          this.orOn(
            _knex.raw(sql, [depsFromField, cdToField, depsToField, cdFromField]).wrap('(', ')')
          );
          this.orOn(
            _knex.raw(sql, [depsToField, cdFromField, depsFromField, cdToField]).wrap('(', ')')
          );
          this.orOn(
            _knex.raw(sql, [depsToField, cdToField, depsFromField, cdFromField]).wrap('(', ')')
          );
        });
      const cteQuery = nonRecursiveQuery.union(recursiveQuery);
      const finalQuery = this.knex
        .withRecursive('connected_reference', ['from_field_id', 'to_field_id'], cteQuery)
        .distinct('from_field_id', 'to_field_id')
        .from('connected_reference');

      // this.logger.log('getDependentNodesCTE Sql: %s', finalQuery.toQuery());

      const sqlNative = finalQuery.toSQL().toNative();
      return (
        this.prismaService
          .txClient()
          // eslint-disable-next-line @typescript-eslint/naming-convention
          .$queryRawUnsafe<{ from_field_id: string; to_field_id: string }[]>(
            sqlNative.sql,
            ...sqlNative.bindings
          )
      );
    };

    for (const fieldId of startFieldIds) {
      const queryResult = await getResult(fieldId);
      result = result.concat(
        queryResult.map((row) => ({ fromFieldId: row.from_field_id, toFieldId: row.to_field_id }))
      );
    }

    return this.filterDirectedGraph(result, startFieldIds);
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
  async getDependentRecordItems(recordItems: IRecordRefItem[]): Promise<IRecordRefItem[]> {
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
          .select({
            id: '__id',
            relationTo: selectField,
            dbTableName: this.knex.raw('?', dbTableName),
            fieldId: this.knex.raw('?', fieldId ?? null),
          })
          .from(dbTableName)
          .where(selectField, id);
      });
    if (!queries.length) {
      return [];
    }

    const [firstQuery, ...restQueries] = queries;
    const nativeSql = firstQuery.union(restQueries).toSQL().toNative();

    return this.prismaService
      .txClient()
      .$queryRawUnsafe<IRecordRefItem[]>(nativeSql.sql, ...nativeSql.bindings);
  }

  async getAffectedRecordItems(
    topoOrder: ITopoLinkOrder[],
    originRecordIdItems: { dbTableName: string; id: string }[]
  ): Promise<IRecordRefItem[]> {
    if (!topoOrder.length) {
      return originRecordIdItems;
    }

    const affectedRecordItemsQuerySql = this.dbProvider.affectedRecordItemsQuerySql(
      topoOrder,
      originRecordIdItems
    );

    const results = await this.prismaService.txClient().$queryRawUnsafe<
      {
        __id: string;
        dbTableName: string;
        selectIn?: string;
        fieldId?: string;
        relationTo?: string;
      }[]
    >(affectedRecordItemsQuerySql);

    // this.logger.log({ affectedRecordItemsResult: results });

    if (!results.length) {
      return originRecordIdItems;
    }

    // only need to return result with relationTo or selectIn
    return results
      .filter((record) => record.__id)
      .map((record) => ({
        id: record.__id,
        dbTableName: record.dbTableName,
        ...(record.relationTo ? { relationTo: record.relationTo } : {}),
        ...(record.fieldId ? { fieldId: record.fieldId } : {}),
        ...(record.selectIn ? { selectIn: record.selectIn } : {}),
      }));
  }

  flatGraph(graph: { toFieldId: string; fromFieldId: string }[]) {
    const allNodes = new Set<string>();
    for (const edge of graph) {
      allNodes.add(edge.fromFieldId);
      allNodes.add(edge.toFieldId);
    }
    return Array.from(allNodes);
  }
}
