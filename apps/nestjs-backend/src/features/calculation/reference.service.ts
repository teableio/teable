import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type {
  IFieldVo,
  ILinkCellValue,
  ILinkFieldOptions,
  IOtOperation,
  IRecord,
} from '@teable/core';
import { evaluate, FieldType, isMultiValueLink, RecordOpBuilder, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IUserInfoVo } from '@teable/openapi';
import { instanceToPlain } from 'class-transformer';
import { Knex } from 'knex';
import { cloneDeep, difference, groupBy, isEmpty, keyBy, unionWith, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { preservedDbFieldNames } from '../field/constant';
import type { IFieldInstance, IFieldMap } from '../field/model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../field/model/factory';
import type { AutoNumberFieldDto } from '../field/model/field-dto/auto-number-field.dto';
import type { CreatedTimeFieldDto } from '../field/model/field-dto/created-time-field.dto';
import type { FormulaFieldDto } from '../field/model/field-dto/formula-field.dto';
import type { LastModifiedTimeFieldDto } from '../field/model/field-dto/last-modified-time-field.dto';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import type { ICellChange } from './utils/changes';
import { formatChangesToOps, mergeDuplicateChange } from './utils/changes';
import { isLinkCellValue } from './utils/detect-link';
import type { IAdjacencyMap } from './utils/dfs';
import {
  buildCompressedAdjacencyMap,
  filterDirectedGraph,
  topoOrderWithDepends,
} from './utils/dfs';

// topo item is for field level reference, all id stands for fieldId;
export interface ITopoItem {
  id: string;
  dependencies: string[];
}

export interface IGraphItem {
  fromFieldId: string;
  toFieldId: string;
}

export interface IRecordMap {
  [recordId: string]: IRecord;
}

export interface IRecordItem {
  record: IRecord;
  dependencies?: IRecord[];
}

export interface IRecordData {
  id: string;
  fieldId: string;
  oldValue?: unknown;
  newValue: unknown;
}

export interface IRelatedRecordItem {
  fieldId: string;
  toId: string;
  fromId: string;
}

export interface IOpsMap {
  [tableId: string]: {
    [keyId: string]: IOtOperation[];
  };
}

export interface ITopoItemWithRecords extends ITopoItem {
  recordItemMap?: Record<string, IRecordItem>;
}

export interface ITopoLinkOrder {
  fieldId: string;
  relationship: Relationship;
  fkHostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
}

@Injectable()
export class ReferenceService {
  private readonly logger = new Logger(ReferenceService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
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
   * saveForeignKeyToDb a method of foreignKey update operation. we should call it after delete operation.
   */
  async calculateOpsMap(opsMap: IOpsMap, saveForeignKeyToDb?: () => Promise<void>) {
    const { recordDataDelete, recordDataRemains } = this.splitOpsMap(opsMap);
    // console.log('recordDataDelete', JSON.stringify(recordDataDelete, null, 2));
    const resultBefore = await this.calculate(this.mergeDuplicateRecordData(recordDataDelete));
    // console.log('resultBefore', JSON.stringify(resultBefore?.changes, null, 2));

    saveForeignKeyToDb && (await saveForeignKeyToDb());

    // console.log('recordDataRemains', JSON.stringify(recordDataRemains, null, 2));
    const resultAfter = await this.calculate(this.mergeDuplicateRecordData(recordDataRemains));
    // console.log('resultAfter', JSON.stringify(resultAfter?.changes, null, 2));

    const changes = [resultBefore?.changes, resultAfter?.changes]
      .filter(Boolean)
      .flat() as ICellChange[];

    const fieldMap = Object.assign({}, resultBefore?.fieldMap, resultAfter?.fieldMap);

    const tableId2DbTableName = Object.assign(
      {},
      resultBefore?.tableId2DbTableName,
      resultAfter?.tableId2DbTableName
    );

    return {
      opsMap: formatChangesToOps(changes),
      fieldMap,
      tableId2DbTableName,
    };
  }

  getTopoOrdersMap(fieldIds: string[], directedGraph: IGraphItem[]) {
    return fieldIds.reduce<{
      [fieldId: string]: ITopoItem[];
    }>((pre, fieldId) => {
      try {
        pre[fieldId] = topoOrderWithDepends(fieldId, directedGraph);
      } catch (e) {
        throw new BadRequestException((e as { message: string }).message);
      }
      return pre;
    }, {});
  }

  getLinkAdjacencyMap(fieldMap: IFieldMap, directedGraph: IGraphItem[]) {
    const linkIdSet = Object.values(fieldMap).reduce((pre, field) => {
      if (field.lookupOptions || field.type === FieldType.Link) {
        pre.add(field.id);
      }
      return pre;
    }, new Set<string>());
    if (linkIdSet.size === 0) {
      return {};
    }
    return buildCompressedAdjacencyMap(directedGraph, linkIdSet);
  }

  async prepareCalculation(recordData: IRecordData[]) {
    if (!recordData.length) {
      return;
    }
    const { directedGraph, startFieldIds, startRecordIds } =
      await this.getDirectedGraph(recordData);
    if (!directedGraph.length) {
      return;
    }

    // get all related field by undirected graph
    const allFieldIds = uniq(this.flatGraph(directedGraph).concat(startFieldIds));
    // prepare all related data
    const {
      fieldMap,
      fieldId2TableId,
      dbTableName2fields,
      tableId2DbTableName,
      fieldId2DbTableName,
    } = await this.createAuxiliaryData(allFieldIds);

    const topoOrdersMap = this.getTopoOrdersMap(startFieldIds, directedGraph);

    const linkAdjacencyMap = this.getLinkAdjacencyMap(fieldMap, directedGraph);

    if (isEmpty(topoOrdersMap)) {
      return;
    }

    const relatedRecordItems = await this.getRelatedItems(
      startFieldIds,
      fieldMap,
      linkAdjacencyMap,
      startRecordIds
    );

    // record data source
    const dbTableName2recordMap = await this.getRecordMapBatch({
      fieldMap,
      fieldId2DbTableName,
      dbTableName2fields,
      modifiedRecords: recordData,
      relatedRecordItems,
    });

    const relatedRecordItemsIndexed = groupBy(relatedRecordItems, 'fieldId');
    // console.log('fieldMap', JSON.stringify(fieldMap, null, 2));
    const orderWithRecordsByFieldId = Object.entries(topoOrdersMap).reduce<{
      [fieldId: string]: ITopoItemWithRecords[];
    }>((pre, [fieldId, topoOrders]) => {
      const orderWithRecords = this.createTopoItemWithRecords({
        topoOrders,
        fieldMap,
        tableId2DbTableName,
        fieldId2TableId,
        dbTableName2recordMap,
        relatedRecordItemsIndexed,
      });
      pre[fieldId] = orderWithRecords;
      return pre;
    }, {});

    return {
      fieldMap,
      fieldId2TableId,
      tableId2DbTableName,
      orderWithRecordsByFieldId,
      dbTableName2recordMap,
    };
  }

  async calculate(recordData: IRecordData[]) {
    const result = await this.prepareCalculation(recordData);
    if (!result) {
      return;
    }

    const { orderWithRecordsByFieldId, fieldMap, fieldId2TableId, tableId2DbTableName } = result;
    const changes = Object.values(orderWithRecordsByFieldId).reduce<ICellChange[]>(
      (pre, orderWithRecords) => {
        // nameConsole('orderWithRecords:', orderWithRecords, fieldMap);
        return pre.concat(this.collectChanges(orderWithRecords, fieldMap, fieldId2TableId));
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

  private splitOpsMap(opsMap: IOpsMap) {
    const recordDataDelete: IRecordData[] = [];
    const recordDataRemains: IRecordData[] = [];
    for (const tableId in opsMap) {
      for (const recordId in opsMap[tableId]) {
        opsMap[tableId][recordId].forEach((op) => {
          const ctx = RecordOpBuilder.editor.setRecord.detect(op);
          if (!ctx) {
            throw new Error(
              'invalid op, it should detect by RecordOpBuilder.editor.setRecord.detect'
            );
          }
          if (isLinkCellValue(ctx.oldCellValue) || isLinkCellValue(ctx.newCellValue)) {
            ctx.oldCellValue &&
              recordDataDelete.push({
                id: recordId,
                fieldId: ctx.fieldId,
                oldValue: ctx.oldCellValue,
                newValue: null,
              });
            ctx.newCellValue &&
              recordDataRemains.push({
                id: recordId,
                fieldId: ctx.fieldId,
                newValue: ctx.newCellValue,
              });
          } else {
            recordDataRemains.push({
              id: recordId,
              fieldId: ctx.fieldId,
              oldValue: ctx.oldCellValue,
              newValue: ctx.newCellValue,
            });
          }
        });
      }
    }

    return {
      recordDataDelete,
      recordDataRemains,
    };
  }

  private async getDirectedGraph(recordData: IRecordData[]) {
    let startFieldIds = recordData.map((data) => data.fieldId);
    const linkData = recordData.filter(
      (data) => isLinkCellValue(data.newValue) || isLinkCellValue(data.oldValue)
    );
    // const linkIds = linkData
    //   .map((data) => [data.newValue, data.oldValue] as ILinkCellValue[])
    //   .flat()
    //   .filter(Boolean)
    //   .map((d) => d.id);
    const startRecordIds = uniq(recordData.map((data) => data.id));
    const linkFieldIds = linkData.map((data) => data.fieldId);

    // when link cell change, we need to get all lookup field
    if (linkFieldIds.length) {
      const lookupFieldRaw = await this.prismaService.txClient().field.findMany({
        where: { lookupLinkedFieldId: { in: linkFieldIds }, deletedTime: null, hasError: null },
        select: { id: true },
      });
      lookupFieldRaw.forEach((field) => startFieldIds.push(field.id));
    }
    startFieldIds = uniq(startFieldIds);
    const directedGraph = await this.getFieldGraphItems(startFieldIds);
    return {
      directedGraph,
      startFieldIds,
      startRecordIds,
    };
  }

  // for lookup field, cellValues should be flat and filter
  private filterArrayNull(lookupValues: unknown[] | unknown) {
    if (Array.isArray(lookupValues)) {
      const flatten = lookupValues.filter((value) => value != null);
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

  private shouldSkipCompute(field: IFieldInstance, recordItem: IRecordItem) {
    if (!field.isComputed && field.type !== FieldType.Link) {
      return true;
    }

    // skip calculate when direct set link cell by input (it has no dependencies)
    if (field.type === FieldType.Link && !field.lookupOptions && !recordItem.dependencies) {
      return true;
    }

    if ((field.lookupOptions || field.type === FieldType.Link) && !recordItem.dependencies) {
      // console.log('empty:field', field);
      // console.log('empty:recordItem', JSON.stringify(recordItem, null, 2));
      return true;
    }
    return false;
  }

  private getComputedUsers(
    field: IFieldInstance,
    record: IRecord,
    userMap: { [userId: string]: IUserInfoVo }
  ) {
    if (field.type === FieldType.CreatedBy) {
      return record.createdBy ? userMap[record.createdBy] : undefined;
    }
    if (field.type === FieldType.LastModifiedBy) {
      return record.lastModifiedBy ? userMap[record.lastModifiedBy] : undefined;
    }
  }

  private calculateUser(
    field: IFieldInstance,
    record: IRecord,
    userMap?: { [userId: string]: IUserInfoVo }
  ) {
    if (!userMap) {
      return record.fields[field.id];
    }
    const user = this.getComputedUsers(field, record, userMap);
    if (!user) {
      return record.fields[field.id];
    }

    return field.convertDBValue2CellValue({
      id: user.id,
      title: user.name,
      email: user.email,
    });
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private calculateComputeField(
    field: IFieldInstance,
    fieldMap: IFieldMap,
    recordItem: IRecordItem,
    userMap?: { [userId: string]: IUserInfoVo }
  ) {
    const record = recordItem.record;

    if (field.lookupOptions || field.type === FieldType.Link) {
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

      const lookedField = fieldMap[lookupFieldId];
      // nameConsole('calculateLookup:dependencies', recordItem.dependencies, fieldMap);
      const originLookupValues = this.calculateLookup(field, lookedField, recordItem);
      const lookupValues = Array.isArray(originLookupValues)
        ? originLookupValues.flat()
        : originLookupValues;

      // console.log('calculateLookup:dependencies', recordItem.dependencies);
      // console.log('calculateLookup:lookupValues', lookupValues, recordItem);

      if (field.isLookup) {
        return this.filterArrayNull(lookupValues);
      }

      return this.calculateRollupAndLink(field, relationship, lookedField, record, lookupValues);
    }

    if (field.type === FieldType.CreatedBy || field.type === FieldType.LastModifiedBy) {
      return this.calculateUser(field, record, userMap);
    }

    if (
      field.type === FieldType.Formula ||
      field.type === FieldType.AutoNumber ||
      field.type === FieldType.CreatedTime ||
      field.type === FieldType.LastModifiedTime
    ) {
      return this.calculateFormula(field, fieldMap, recordItem);
    }

    throw new BadRequestException(`Unsupported field type ${field.type}`);
  }

  private calculateFormula(
    field: FormulaFieldDto | AutoNumberFieldDto | CreatedTimeFieldDto | LastModifiedTimeFieldDto,
    fieldMap: IFieldMap,
    recordItem: IRecordItem
  ) {
    if (field.hasError) {
      return null;
    }

    try {
      const typedValue = evaluate(
        field.options.expression,
        fieldMap,
        recordItem.record,
        'timeZone' in field.options ? field.options.timeZone : undefined
      );
      return typedValue.toPlain();
    } catch (e) {
      this.logger.error(
        `calculateFormula error, fieldId: ${field.id}; exp: ${field.options.expression}; recordId: ${recordItem.record.id}, ${(e as { message: string }).message}`
      );
      return null;
    }
  }

  /**
   * lookup values should filter by linkCellValue
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private calculateLookup(
    field: IFieldInstance,
    lookedField: IFieldInstance,
    recordItem: IRecordItem
  ) {
    const fieldId = lookedField.id;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const dependencies = recordItem.dependencies!;
    const lookupOptions = field.lookupOptions
      ? field.lookupOptions
      : (field.options as ILinkFieldOptions);
    const { relationship } = lookupOptions;
    const linkFieldId = field.lookupOptions ? field.lookupOptions.linkFieldId : field.id;
    const cellValue = recordItem.record.fields[linkFieldId];

    if (relationship === Relationship.OneMany || relationship === Relationship.ManyMany) {
      if (!dependencies) {
        return null;
      }

      // sort lookup values by link cell order
      const dependenciesIndexed = keyBy(dependencies, 'id');
      const linkCellValues = cellValue as ILinkCellValue[];
      // when reset a link cell, the link cell value will be null
      // but dependencies will still be there in the first round calculation
      if (linkCellValues) {
        return linkCellValues
          .map((v) => {
            const result = dependenciesIndexed[v.id];
            if (!result) {
              throw new InternalServerErrorException(
                `Record not found for: ${JSON.stringify(v)}, fieldId: ${field.id}`
              );
            }
            return result;
          })
          .map((depRecord) => depRecord.fields[fieldId]);
      }

      return null;
    }

    if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
      if (!dependencies) {
        return null;
      }
      if (dependencies.length !== 1) {
        throw new Error(
          'dependencies should have only 1 element when relationship is manyOne or oneOne'
        );
      }

      const linkCellValue = cellValue as ILinkCellValue;
      if (linkCellValue) {
        return dependencies[0].fields[fieldId] ?? null;
      }
      return null;
    }
  }

  private calculateLink(
    field: LinkFieldDto,
    virtualField: IFieldInstance,
    record: IRecord,
    lookupValues: unknown
  ) {
    const linkCellValues = record.fields[field.id] as ILinkCellValue[] | ILinkCellValue | undefined;
    if (!linkCellValues) {
      return null;
    }

    if (virtualField.isMultipleCellValue) {
      if (!Array.isArray(lookupValues)) {
        throw new Error('lookupValues should be array when virtualField is multiple cell value');
      }

      if (!Array.isArray(linkCellValues)) {
        throw new Error('linkCellValues should be array when virtualField is multiple cell value');
      }

      if (linkCellValues.length !== lookupValues.length) {
        throw new Error(
          'lookupValues length should be same as linkCellValues length, now: ' +
            linkCellValues.length +
            ' - ' +
            lookupValues.length
        );
      }

      const titles = lookupValues.map((item) => {
        return virtualField.item2String(item);
      });

      return field.updateCellTitle(linkCellValues, titles);
    }

    return field.updateCellTitle(linkCellValues, virtualField.cellValue2String(lookupValues));
  }

  private calculateRollupAndLink(
    field: IFieldInstance,
    relationship: Relationship,
    lookupField: IFieldInstance,
    record: IRecord,
    lookupValues: unknown
  ): unknown {
    if (field.type !== FieldType.Link && field.type !== FieldType.Rollup) {
      throw new BadRequestException('rollup only support link and rollup field currently');
    }

    const fieldVo = instanceToPlain(lookupField, { excludePrefixes: ['_'] }) as IFieldVo;
    const virtualField = createFieldInstanceByVo({
      ...fieldVo,
      id: 'values',
      isMultipleCellValue:
        fieldVo.isMultipleCellValue || isMultiValueLink(relationship) || undefined,
    });

    if (field.type === FieldType.Rollup) {
      // console.log('calculateRollup', field, lookupField, record, lookupValues);
      if (lookupValues == null) {
        return null;
      }
      return field
        .evaluate(
          { values: virtualField },
          { ...record, fields: { ...record.fields, values: lookupValues } }
        )
        .toPlain();
    }

    if (field.type === FieldType.Link) {
      return this.calculateLink(field, virtualField, record, lookupValues);
    }
  }

  async createAuxiliaryData(allFieldIds: string[]) {
    const prisma = this.prismaService.txClient();
    const fieldRaws = await prisma.field.findMany({
      where: { id: { in: allFieldIds }, deletedTime: null },
    });

    // if a field that has been looked up  has changed, the link field should be retrieved as context
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

    const fieldId2DbTableName = fieldRaws.reduce<{ [fieldId: string]: string }>((pre, f) => {
      pre[f.id] = tableId2DbTableName[f.tableId];
      return pre;
    }, {});

    return {
      fieldMap,
      fieldId2TableId,
      fieldId2DbTableName,
      dbTableName2fields,
      tableId2DbTableName,
    };
  }

  collectChanges(
    orders: ITopoItemWithRecords[],
    fieldMap: IFieldMap,
    fieldId2TableId: { [fieldId: string]: string },
    userMap?: { [userId: string]: IUserInfoVo }
  ) {
    // detail changes
    const changes: ICellChange[] = [];
    // console.log('collectChanges:orders:', JSON.stringify(orders, null, 2));

    orders.forEach((item) => {
      Object.values(item.recordItemMap || {}).forEach((recordItem) => {
        const field = fieldMap[item.id];
        const record = recordItem.record;
        if (this.shouldSkipCompute(field, recordItem)) {
          return;
        }

        const value = this.calculateComputeField(field, fieldMap, recordItem, userMap);
        // console.log(
        //   `calculated: ${field.type}.${field.id}.${record.id}`,
        //   recordItem.record.fields,
        //   value
        // );
        const oldValue = record.fields[field.id];
        record.fields[field.id] = value;
        changes.push({
          tableId: fieldId2TableId[field.id],
          fieldId: field.id,
          recordId: record.id,
          oldValue,
          newValue: value,
        });
      });
    });
    return changes;
  }

  recordRaw2Record(fields: IFieldInstance[], raw: { [dbFieldName: string]: unknown }): IRecord {
    const fieldsData = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
      acc[field.id] = field.convertDBValue2CellValue(raw[field.dbFieldName] as string);
      return acc;
    }, {});

    return {
      fields: fieldsData,
      id: raw.__id as string,
      autoNumber: raw.__auto_number as number,
      createdTime: (raw.__created_time as Date)?.toISOString(),
      lastModifiedTime: (raw.__last_modified_time as Date)?.toISOString(),
      createdBy: raw.__created_by as string,
      lastModifiedBy: raw.__last_modified_by as string,
    };
  }

  getLinkOrderFromTopoOrders(params: {
    topoOrders: ITopoItem[];
    fieldMap: IFieldMap;
  }): ITopoLinkOrder[] {
    const newOrder: ITopoLinkOrder[] = [];
    const { topoOrders, fieldMap } = params;
    // one link fieldId only need to add once
    const checkSet = new Set<string>();
    for (const item of topoOrders) {
      const field = fieldMap[item.id];
      if (field.lookupOptions) {
        const { fkHostTableName, selfKeyName, foreignKeyName, relationship, linkFieldId } =
          field.lookupOptions;
        if (checkSet.has(linkFieldId)) {
          continue;
        }
        checkSet.add(linkFieldId);
        newOrder.push({
          fieldId: linkFieldId,
          relationship,
          fkHostTableName,
          selfKeyName,
          foreignKeyName,
        });
        continue;
      }

      if (field.type === FieldType.Link) {
        const { fkHostTableName, selfKeyName, foreignKeyName } = field.options;
        if (checkSet.has(field.id)) {
          continue;
        }
        checkSet.add(field.id);
        newOrder.push({
          fieldId: field.id,
          relationship: field.options.relationship,
          fkHostTableName,
          selfKeyName,
          foreignKeyName,
        });
      }
    }
    return newOrder;
  }

  getRecordIdsByTableName(params: {
    fieldMap: IFieldMap;
    fieldId2DbTableName: Record<string, string>;
    initialRecordIdMap?: { [dbTableName: string]: Set<string> };
    modifiedRecords: IRecordData[];
    relatedRecordItems: IRelatedRecordItem[];
  }) {
    const {
      fieldMap,
      fieldId2DbTableName,
      initialRecordIdMap,
      modifiedRecords,
      relatedRecordItems,
    } = params;
    const recordIdsByTableName = cloneDeep(initialRecordIdMap) || {};
    const insertId = (fieldId: string, id: string) => {
      const dbTableName = fieldId2DbTableName[fieldId];
      if (!recordIdsByTableName[dbTableName]) {
        recordIdsByTableName[dbTableName] = new Set<string>();
      }
      recordIdsByTableName[dbTableName].add(id);
    };

    modifiedRecords.forEach((item) => {
      insertId(item.fieldId, item.id);
      const field = fieldMap[item.fieldId];
      if (field.type !== FieldType.Link) {
        return;
      }
      const lookupFieldId = field.options.lookupFieldId;

      const { newValue } = item;
      [newValue]
        .flat()
        .filter(Boolean)
        .map((item) => insertId(lookupFieldId, (item as ILinkCellValue).id));
    });

    relatedRecordItems.forEach((item) => {
      const field = fieldMap[item.fieldId];
      const options = field.lookupOptions ?? (field.options as ILinkFieldOptions);

      insertId(options.lookupFieldId, item.fromId);
      insertId(item.fieldId, item.toId);
    });

    return recordIdsByTableName;
  }

  async getRecordMapBatch(params: {
    fieldMap: IFieldMap;
    fieldId2DbTableName: Record<string, string>;
    dbTableName2fields: Record<string, IFieldInstance[]>;
    initialRecordIdMap?: { [dbTableName: string]: Set<string> };
    modifiedRecords: IRecordData[];
    relatedRecordItems: IRelatedRecordItem[];
  }) {
    const { fieldId2DbTableName, dbTableName2fields, modifiedRecords } = params;

    const recordIdsByTableName = this.getRecordIdsByTableName(params);
    const recordMap = await this.getRecordMap(recordIdsByTableName, dbTableName2fields);
    this.coverRecordData(fieldId2DbTableName, modifiedRecords, recordMap);

    return recordMap;
  }

  async getRecordMap(
    recordIdsByTableName: Record<string, Set<string>>,
    dbTableName2fields: Record<string, IFieldInstance[]>
  ) {
    const results: {
      [dbTableName: string]: { [dbFieldName: string]: unknown }[];
    } = {};
    for (const dbTableName in recordIdsByTableName) {
      // deduplication is needed
      const recordIds = Array.from(recordIdsByTableName[dbTableName]);
      const dbFieldNames = dbTableName2fields[dbTableName]
        .map((f) => f.dbFieldName)
        .concat([...preservedDbFieldNames]);
      const nativeQuery = this.knex(dbTableName)
        .select(dbFieldNames)
        .whereIn('__id', recordIds)
        .toQuery();
      const result = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ [dbFieldName: string]: unknown }[]>(nativeQuery);
      results[dbTableName] = result;
    }

    return this.formatRecordQueryResult(results, dbTableName2fields);
  }

  createTopoItemWithRecords(params: {
    topoOrders: ITopoItem[];
    tableId2DbTableName: { [tableId: string]: string };
    fieldId2TableId: { [fieldId: string]: string };
    fieldMap: IFieldMap;
    dbTableName2recordMap: { [tableName: string]: IRecordMap };
    relatedRecordItemsIndexed: Record<string, IRelatedRecordItem[]>;
  }): ITopoItemWithRecords[] {
    const {
      topoOrders,
      fieldMap,
      tableId2DbTableName,
      fieldId2TableId,
      dbTableName2recordMap,
      relatedRecordItemsIndexed,
    } = params;
    return topoOrders.map<ITopoItemWithRecords>((order) => {
      const field = fieldMap[order.id];
      const fieldId = field.id;
      const tableId = fieldId2TableId[order.id];
      const dbTableName = tableId2DbTableName[tableId];
      const recordMap = dbTableName2recordMap[dbTableName];
      const relatedItems = relatedRecordItemsIndexed[fieldId];

      // console.log('withRecord:order', JSON.stringify(order, null, 2));
      // console.log('withRecord:relatedItems', relatedItems);
      return {
        ...order,
        recordItemMap:
          recordMap &&
          Object.values(recordMap).reduce<Record<string, IRecordItem>>((pre, record) => {
            let dependencies: IRecord[] | undefined;
            if (relatedItems) {
              const options = field.lookupOptions
                ? field.lookupOptions
                : (field.options as ILinkFieldOptions);
              const foreignTableId = options.foreignTableId;
              const foreignDbTableName = tableId2DbTableName[foreignTableId];
              const foreignRecordMap = dbTableName2recordMap[foreignDbTableName];
              const dependentRecordIdsIndexed = groupBy(relatedItems, 'toId');
              const dependentRecordIds = dependentRecordIdsIndexed[record.id];

              if (dependentRecordIds) {
                dependencies = dependentRecordIds.map((item) => foreignRecordMap[item.fromId]);
              }
            }

            if (dependencies) {
              pre[record.id] = { record, dependencies };
            } else {
              pre[record.id] = { record };
            }

            return pre;
          }, {}),
      };
    });
  }

  formatRecordQueryResult(
    formattedResults: {
      [tableName: string]: { [dbFieldName: string]: unknown }[];
    },
    dbTableName2fields: { [tableId: string]: IFieldInstance[] }
  ) {
    return Object.entries(formattedResults).reduce<{
      [dbTableName: string]: IRecordMap;
    }>((acc, [dbTableName, records]) => {
      const fields = dbTableName2fields[dbTableName];
      acc[dbTableName] = records.reduce<IRecordMap>((pre, recordRaw) => {
        const record = this.recordRaw2Record(fields, recordRaw);
        pre[record.id] = record;
        return pre;
      }, {});
      return acc;
    }, {});
  }

  // use modified record data to cover the record data from db
  private coverRecordData(
    fieldId2DbTableName: Record<string, string>,
    newRecordData: IRecordData[],
    allRecordByDbTableName: { [tableName: string]: IRecordMap }
  ) {
    newRecordData.forEach((cover) => {
      const dbTableName = fieldId2DbTableName[cover.fieldId];
      const record = allRecordByDbTableName[dbTableName][cover.id];
      if (!record) {
        throw new BadRequestException(`Can not find record: ${cover.id} in database`);
      }
      record.fields[cover.fieldId] = cover.newValue;
    });
  }

  async getFieldGraphItems(startFieldIds: string[]): Promise<IGraphItem[]> {
    const getResult = async (startFieldIds: string[]) => {
      const _knex = this.knex;

      const nonRecursiveQuery = _knex
        .select('from_field_id', 'to_field_id')
        .from('reference')
        .whereIn('from_field_id', startFieldIds)
        .orWhereIn('to_field_id', startFieldIds);
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
        .from('connected_reference')
        .toQuery();

      return (
        this.prismaService
          .txClient()
          // eslint-disable-next-line @typescript-eslint/naming-convention
          .$queryRawUnsafe<{ from_field_id: string; to_field_id: string }[]>(finalQuery)
      );
    };

    const queryResult = await getResult(startFieldIds);

    return filterDirectedGraph(
      queryResult.map((row) => ({ fromFieldId: row.from_field_id, toFieldId: row.to_field_id })),
      startFieldIds
    );
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
  async getDependentRecordItems(
    fieldMap: IFieldMap,
    recordItems: IRelatedRecordItem[]
  ): Promise<IRelatedRecordItem[]> {
    const indexRecordItems = groupBy(recordItems, 'fieldId');

    const queries = Object.entries(indexRecordItems)
      .filter(([fieldId]) => {
        const options =
          fieldMap[fieldId].lookupOptions || (fieldMap[fieldId].options as ILinkFieldOptions);
        const relationship = options.relationship;
        return relationship === Relationship.ManyMany || relationship === Relationship.OneMany;
      })
      .map(([fieldId, recordItem]) => {
        const options =
          fieldMap[fieldId].lookupOptions || (fieldMap[fieldId].options as ILinkFieldOptions);
        const { fkHostTableName, selfKeyName, foreignKeyName } = options;
        const ids = recordItem.map((item) => item.toId);

        return this.knex
          .select({
            fieldId: this.knex.raw('?', fieldId),
            toId: selfKeyName,
            fromId: foreignKeyName,
          })
          .from(fkHostTableName)
          .whereIn(selfKeyName, ids);
      });

    if (!queries.length) {
      return [];
    }

    const [firstQuery, ...restQueries] = queries;
    const sqlQuery = firstQuery.unionAll(restQueries).toQuery();
    return this.prismaService.txClient().$queryRawUnsafe<IRelatedRecordItem[]>(sqlQuery);
  }

  affectedRecordItemsQuerySql(
    startFieldIds: string[],
    fieldMap: IFieldMap,
    linkAdjacencyMap: IAdjacencyMap,
    startRecordIds: string[]
  ): string {
    const visited = new Set<string>();
    const knex = this.knex;
    const query = knex.queryBuilder();

    function visit(node: string, preNode: string) {
      if (visited.has(node)) {
        return;
      }

      visited.add(node);
      const options = fieldMap[node].lookupOptions || (fieldMap[node].options as ILinkFieldOptions);
      const { fkHostTableName, selfKeyName, foreignKeyName } = options;

      query.with(
        node,
        knex
          .distinct({
            toId: `${fkHostTableName}.${selfKeyName}`,
            fromId: `${preNode}.toId`,
          })
          .from(fkHostTableName)
          .whereNotNull(`${fkHostTableName}.${selfKeyName}`) // toId
          .join(preNode, `${preNode}.toId`, '=', `${fkHostTableName}.${foreignKeyName}`)
      );
      const nextNodes = linkAdjacencyMap[node];
      // Process outgoing edges
      if (nextNodes) {
        for (const neighbor of nextNodes) {
          visit(neighbor, node);
        }
      }
    }

    startFieldIds.forEach((fieldId) => {
      const field = fieldMap[fieldId];
      if (field.lookupOptions || field.type === FieldType.Link) {
        const options = field.lookupOptions || (field.options as ILinkFieldOptions);
        const { fkHostTableName, selfKeyName, foreignKeyName } = options;
        if (visited.has(fieldId)) {
          return;
        }
        visited.add(fieldId);
        query.with(
          fieldId,
          knex
            .distinct({
              toId: `${fkHostTableName}.${selfKeyName}`,
              fromId: `${fkHostTableName}.${foreignKeyName}`,
            })
            .from(fkHostTableName)
            .whereIn(`${fkHostTableName}.${selfKeyName}`, startRecordIds)
            .whereNotNull(`${fkHostTableName}.${foreignKeyName}`)
        );
      } else {
        query.with(
          fieldId,
          knex.unionAll(
            startRecordIds.map((id) =>
              knex.select({ toId: knex.raw('?', id), fromId: knex.raw('?', null) })
            )
          )
        );
      }
      const nextNodes = linkAdjacencyMap[fieldId];

      // start visit
      if (nextNodes) {
        for (const neighbor of nextNodes) {
          visit(neighbor, fieldId);
        }
      }
    });

    // union all result
    query.unionAll(
      Array.from(visited).map((fieldId) =>
        knex
          .select({
            fieldId: knex.raw('?', fieldId),
            fromId: knex.ref(`${fieldId}.fromId`),
            toId: knex.ref(`${fieldId}.toId`),
          })
          .from(fieldId)
      )
    );

    return query.toQuery();
  }

  async getAffectedRecordItems(
    startFieldIds: string[],
    fieldMap: IFieldMap,
    linkAdjacencyMap: IAdjacencyMap,
    startRecordIds: string[]
  ): Promise<IRelatedRecordItem[]> {
    const affectedRecordItemsQuerySql = this.affectedRecordItemsQuerySql(
      startFieldIds,
      fieldMap,
      linkAdjacencyMap,
      startRecordIds
    );

    return this.prismaService
      .txClient()
      .$queryRawUnsafe<IRelatedRecordItem[]>(affectedRecordItemsQuerySql);
  }

  async getRelatedItems(
    startFieldIds: string[],
    fieldMap: IFieldMap,
    linkAdjacencyMap: IAdjacencyMap,
    startRecordIds: string[]
  ) {
    if (isEmpty(startRecordIds) || isEmpty(linkAdjacencyMap)) {
      return [];
    }
    const effectedItems = await this.getAffectedRecordItems(
      startFieldIds,
      fieldMap,
      linkAdjacencyMap,
      startRecordIds
    );

    const dependentItems = await this.getDependentRecordItems(fieldMap, effectedItems);

    return unionWith(
      effectedItems,
      dependentItems,
      (left, right) =>
        left.toId === right.toId && left.fromId === right.fromId && left.fieldId === right.fieldId
    );
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
