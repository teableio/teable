import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { IFieldVo, ILinkCellValue, ILinkFieldOptions, IRecord } from '@teable/core';
import {
  evaluate,
  extractFieldIdsFromFilter,
  FieldType,
  isMultiValueLink,
  RecordOpBuilder,
  Relationship,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IUserInfoVo } from '@teable/openapi';
import { instanceToPlain } from 'class-transformer';
import { Knex } from 'knex';
import { difference, groupBy, isEmpty, isEqual, keyBy, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { preservedDbFieldNames } from '../field/constant';
import type { IFieldInstance, IFieldMap } from '../field/model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../field/model/factory';
import type { AutoNumberFieldDto } from '../field/model/field-dto/auto-number-field.dto';
import type { CreatedTimeFieldDto } from '../field/model/field-dto/created-time-field.dto';
import type { FormulaFieldDto } from '../field/model/field-dto/formula-field.dto';
import type { LastModifiedTimeFieldDto } from '../field/model/field-dto/last-modified-time-field.dto';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import { BatchService } from './batch.service';
import type { IFkRecordItem, IFkRecordMap } from './link.service';
import type { ICellChange } from './utils/changes';
import { formatChangesToOps } from './utils/changes';
import type { IOpsMap } from './utils/compose-maps';
import { isLinkCellValue } from './utils/detect-link';
import { filterDirectedGraph, getTopoOrders, prependStartFieldIds } from './utils/dfs';

// topo item is for field level reference, all id stands for fieldId;
export interface ITopoItem {
  id: string;
  dependencies: string[];
}

export interface ITopoItemWithRecords extends ITopoItem {
  recordItemMap?: Record<string, IRecordItem>;
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
  toId: string;
  fromId?: string;
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
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
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
  async calculateOpsMap(opsMap: IOpsMap, fkRecordMap?: IFkRecordMap) {
    await this.calculateRecordData(this.opsMap2RecordData(opsMap), fkRecordMap);
  }

  async prepareCalculation(recordData: IRecordData[]) {
    if (!recordData.length) {
      return;
    }
    const { directedGraph, startZone } = await this.getDirectedGraph(recordData);
    if (!directedGraph.length) {
      return;
    }
    const startFieldIds = Object.keys(startZone);
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

    const topoOrders = prependStartFieldIds(getTopoOrders(directedGraph), startFieldIds);

    if (isEmpty(topoOrders)) {
      return;
    }

    return {
      startZone,
      fieldMap,
      fieldId2TableId,
      tableId2DbTableName,
      dbTableName2fields,
      fieldId2DbTableName,
      topoOrders,
    };
  }

  private async calculateLinkRelatedRecords(props: {
    field: IFieldInstance;
    fieldMap: IFieldMap;
    relatedRecordItems: IRelatedRecordItem[];
    fieldId2DbTableName: Record<string, string>;
    tableId2DbTableName: Record<string, string>;
    fieldId2TableId: Record<string, string>;
    dbTableName2fields: Record<string, IFieldInstance[]>;
  }) {
    const {
      field,
      fieldMap,
      fieldId2DbTableName,
      tableId2DbTableName,
      fieldId2TableId,
      relatedRecordItems,
      dbTableName2fields,
    } = props;
    const dbTableName = fieldId2DbTableName[field.id];

    const recordIds = uniq(relatedRecordItems.map((item) => item.toId));
    const foreignRecordIds = uniq(
      relatedRecordItems.map((item) => item.fromId).filter(Boolean) as string[]
    );

    // record data source
    const recordMapByTableName = await this.getRecordMapBatch({
      field,
      tableId2DbTableName,
      fieldId2DbTableName,
      dbTableName2fields,
      recordIds,
      foreignRecordIds,
    });

    const options = field.lookupOptions
      ? field.lookupOptions
      : (field.options as ILinkFieldOptions);

    const foreignDbTableName = tableId2DbTableName[options.foreignTableId];
    const recordMap = recordMapByTableName[dbTableName];
    const foreignRecordMap = recordMapByTableName[foreignDbTableName];

    const dependentRecordIdsIndexed = groupBy(relatedRecordItems, 'toId');

    const tableId = fieldId2TableId[field.id];

    const changes = recordIds.reduce<ICellChange[]>((pre, recordId) => {
      let dependencies: IRecord[] | undefined;
      const recordItems = dependentRecordIdsIndexed[recordId];
      const dependentRecordIds = recordItems.map((item) => item.fromId).filter(Boolean) as string[];
      const record = recordMap[recordId];

      if (dependentRecordIds) {
        try {
          dependencies = dependentRecordIds.map((id) => foreignRecordMap[id]);
        } catch (e) {
          console.log('changes:field', field);
          console.log('relatedRecordItems', relatedRecordItems);
          console.log('recordIdsByTableName', recordMapByTableName);
          console.log('foreignRecordMap', foreignRecordMap);
          throw e;
        }
      }

      const change = this.collectChanges({ record, dependencies }, tableId, field, fieldMap);

      if (change) {
        pre.push(change);
      }

      return pre;
    }, []);

    const opsMap = formatChangesToOps(changes);
    await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
  }

  private async getUserMap(
    recordMap: Record<string, IRecord>,
    type: FieldType
  ): Promise<{ [userId: string]: IUserInfoVo }> {
    const userKey = type === FieldType.CreatedBy ? 'createdBy' : 'lastModifiedBy';
    const userIds = Array.from(
      new Set(
        Object.values(recordMap)
          .map((record) => record[userKey])
          .filter(Boolean) as string[]
      )
    );

    const users = await this.prismaService.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true, avatar: true },
    });

    return keyBy(users, 'id');
  }

  private async calculateInTableRecords(props: {
    field: IFieldInstance;
    fieldMap: IFieldMap;
    relatedRecordItems: IRelatedRecordItem[];
    fieldId2DbTableName: Record<string, string>;
    tableId2DbTableName: Record<string, string>;
    fieldId2TableId: Record<string, string>;
    dbTableName2fields: Record<string, IFieldInstance[]>;
  }) {
    const {
      field,
      fieldMap,
      relatedRecordItems,
      fieldId2DbTableName,
      tableId2DbTableName,
      fieldId2TableId,
      dbTableName2fields,
    } = props;

    const dbTableName = fieldId2DbTableName[field.id];
    const recordIds = uniq(relatedRecordItems.map((item) => item.toId));

    // record data source
    const recordIdsByTableName = await this.getRecordMapBatch({
      field,
      tableId2DbTableName,
      fieldId2DbTableName,
      dbTableName2fields,
      recordIds,
    });

    const tableId = fieldId2TableId[field.id];
    const recordMap = recordIdsByTableName[dbTableName];
    const userMap =
      field.type === FieldType.CreatedBy || field.type === FieldType.LastModifiedBy
        ? await this.getUserMap(recordMap, field.type)
        : undefined;

    const changes = recordIds.reduce<ICellChange[]>((pre, recordId) => {
      const record = recordMap[recordId];
      const change = this.collectChanges({ record }, tableId, field, fieldMap, userMap);
      if (change) {
        pre.push(change);
      }

      return pre;
    }, []);

    const opsMap = formatChangesToOps(changes);
    await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
  }

  async calculateRecordData(recordData: IRecordData[], fkRecordMap?: IFkRecordMap) {
    const result = await this.prepareCalculation(recordData);
    if (!result) {
      return;
    }
    await this.calculate({ ...result, fkRecordMap });
  }

  async calculate(props: {
    startZone: { [fieldId: string]: string[] };
    fieldMap: IFieldMap;
    topoOrders: ITopoItem[];
    fieldId2DbTableName: Record<string, string>;
    tableId2DbTableName: Record<string, string>;
    fieldId2TableId: Record<string, string>;
    dbTableName2fields: Record<string, IFieldInstance[]>;
    fkRecordMap?: IFkRecordMap;
  }) {
    const {
      startZone,
      fieldMap,
      topoOrders,
      fieldId2DbTableName,
      tableId2DbTableName,
      fieldId2TableId,
      dbTableName2fields,
      fkRecordMap,
    } = props;

    const recordIdsMap = { ...startZone };

    for (const order of topoOrders) {
      const fieldId = order.id;
      const field = fieldMap[fieldId];
      const fromRecordIds = order.dependencies
        ?.map((item) => recordIdsMap[item])
        .filter(Boolean)
        .flat();
      const toRecordIds = recordIdsMap[fieldId];
      if (!fromRecordIds?.length && !toRecordIds?.length) {
        continue;
      }
      const relatedRecordItems = await this.getAffectedRecordItems({
        fieldId,
        fieldMap,
        fromRecordIds,
        toRecordIds,
        fkRecordMap,
        tableId2DbTableName,
      });

      if (field.lookupOptions || field.type === FieldType.Link) {
        await this.calculateLinkRelatedRecords({
          field,
          fieldMap,
          fieldId2DbTableName,
          tableId2DbTableName,
          fieldId2TableId,
          dbTableName2fields,
          relatedRecordItems,
        });
      } else {
        await this.calculateInTableRecords({
          field,
          fieldMap,
          relatedRecordItems,
          fieldId2DbTableName,
          tableId2DbTableName,
          fieldId2TableId,
          dbTableName2fields,
        });
      }

      recordIdsMap[fieldId] = uniq(relatedRecordItems.map((item) => item.toId));
    }
  }

  private opsMap2RecordData(opsMap: IOpsMap) {
    const recordData: IRecordData[] = [];
    for (const tableId in opsMap) {
      for (const recordId in opsMap[tableId]) {
        opsMap[tableId][recordId].forEach((op) => {
          const ctx = RecordOpBuilder.editor.setRecord.detect(op);
          if (!ctx) {
            throw new Error(
              'invalid op, it should detect by RecordOpBuilder.editor.setRecord.detect'
            );
          }
          recordData.push({
            id: recordId,
            fieldId: ctx.fieldId,
            oldValue: ctx.oldCellValue,
            newValue: ctx.newCellValue,
          });
        });
      }
    }
    return recordData;
  }

  private async getDirectedGraph(recordData: IRecordData[]) {
    const startZone = recordData.reduce<{ [fieldId: string]: Set<string> }>((pre, data) => {
      if (!pre[data.fieldId]) {
        pre[data.fieldId] = new Set();
      }
      pre[data.fieldId].add(data.id);
      return pre;
    }, {});

    const linkData = recordData.filter(
      (data) => isLinkCellValue(data.newValue) || isLinkCellValue(data.oldValue)
    );
    // const linkIds = linkData
    //   .map((data) => [data.newValue, data.oldValue] as ILinkCellValue[])
    //   .flat()
    //   .filter(Boolean)
    //   .map((d) => d.id);
    const linkFieldIds = linkData.map((data) => data.fieldId);

    // when link cell change, we need to get all lookup field
    if (linkFieldIds.length) {
      const lookupFieldRaw = await this.prismaService.txClient().field.findMany({
        where: { lookupLinkedFieldId: { in: linkFieldIds }, deletedTime: null, hasError: null },
        select: { id: true, lookupLinkedFieldId: true },
      });
      lookupFieldRaw.forEach(
        (field) => (startZone[field.id] = startZone[field.lookupLinkedFieldId as string])
      );
    }
    const directedGraph = await this.getFieldGraphItems(Object.keys(startZone));

    return {
      directedGraph,
      startZone: Object.fromEntries(
        Object.entries(startZone).map(([key, value]) => [key, Array.from(value)])
      ),
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
      // console.log('calculateLookup:lookupValues', field.id, lookupValues, recordItem);

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
      console.log(e);
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
    const dependenciesIndexed = keyBy(dependencies, 'id');

    if (relationship === Relationship.OneMany || relationship === Relationship.ManyMany) {
      if (!dependencies) {
        return null;
      }

      // sort lookup values by link cell order
      let linkCellValues = cellValue as ILinkCellValue[];
      // when reset a link cell, the link cell value will be null
      // but dependencies will still be there in the first round calculation
      if (linkCellValues) {
        if (field.lookupOptions?.filter) {
          linkCellValues = linkCellValues.filter((v) => dependenciesIndexed[v.id]);
        }
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

      const linkCellValue = cellValue as ILinkCellValue;
      if (linkCellValue) {
        return dependenciesIndexed[linkCellValue.id]?.fields[fieldId] ?? null;
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

  async getLookupFilterFieldMap(fieldMap: IFieldMap) {
    const fieldIds = Object.keys(fieldMap)
      .map((fieldId) => {
        const lookupOptions = fieldMap[fieldId].lookupOptions;
        if (lookupOptions && lookupOptions.filter) {
          return extractFieldIdsFromFilter(lookupOptions.filter);
        }
        return [];
      })
      .flat();

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    return fieldRaws.reduce<{ [fieldId: string]: IFieldInstance }>((pre, f) => {
      pre[f.id] = createFieldInstanceByRaw(f);
      return pre;
    }, {});
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

    const lookupFilterFieldMap = await this.getLookupFilterFieldMap(fieldMap);

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
      fieldMap: { ...fieldMap, ...lookupFilterFieldMap },
      fieldId2TableId,
      fieldId2DbTableName,
      dbTableName2fields,
      tableId2DbTableName,
    };
  }

  collectChanges(
    recordItem: IRecordItem,
    tableId: string,
    field: IFieldInstance,
    fieldMap: IFieldMap,
    userMap?: { [userId: string]: IUserInfoVo }
  ): ICellChange | undefined {
    const record = recordItem.record;
    if (!field.isComputed && field.type !== FieldType.Link) {
      return;
    }

    const value = this.calculateComputeField(field, fieldMap, recordItem, userMap);

    const oldValue = record.fields[field.id];
    if (isEqual(oldValue, value)) {
      return;
    }

    return {
      tableId,
      fieldId: field.id,
      recordId: record.id,
      oldValue,
      newValue: value,
    };
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

  async getRecordMapBatch(params: {
    field: IFieldInstance;
    recordIds: string[];
    foreignRecordIds?: string[];
    tableId2DbTableName: { [tableId: string]: string };
    fieldId2DbTableName: Record<string, string>;
    dbTableName2fields: Record<string, IFieldInstance[]>;
  }) {
    const {
      field,
      recordIds,
      foreignRecordIds,
      tableId2DbTableName,
      fieldId2DbTableName,
      dbTableName2fields,
    } = params;

    const dbTableName = fieldId2DbTableName[field.id];
    const options = field.lookupOptions ?? (field.options as ILinkFieldOptions);
    const foreignDbTableName = tableId2DbTableName[options.foreignTableId];

    const recordIdsByTableName = {
      [dbTableName]: new Set(recordIds),
    };
    if (foreignDbTableName && foreignRecordIds) {
      recordIdsByTableName[foreignDbTableName] = recordIdsByTableName[foreignDbTableName]
        ? new Set([...recordIdsByTableName[foreignDbTableName], ...foreignRecordIds])
        : new Set(foreignRecordIds);
    }

    return await this.getRecordMap(recordIdsByTableName, dbTableName2fields);
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

  revertFkMap(fkMap: { [recordId: string]: IFkRecordItem } | null | undefined):
    | {
        [recordId: string]: IFkRecordItem;
      }
    | undefined {
    if (!fkMap) {
      return;
    }

    const reverted: { [recordId: string]: IFkRecordItem } = {};

    for (const [key, value] of Object.entries(fkMap)) {
      const newLinks = (value.newKey && [value.newKey].flat()) as string[] | null;
      const oldLinks = (value.oldKey && [value.oldKey].flat()) as string[] | null;

      oldLinks?.forEach((oldId) => {
        if (!newLinks?.includes(oldId)) {
          reverted[oldId] = reverted[oldId] || { newKey: [], oldKey: [] };
          (reverted[oldId].oldKey as string[]).push(key);
        }
      });

      newLinks?.forEach((newId) => {
        if (!oldLinks?.includes(newId)) {
          reverted[newId] = reverted[newId] || { newKey: [], oldKey: [] };
          (reverted[newId].newKey as string[]).push(key);
        }
      });
    }

    return reverted;
  }

  async getAffectedRecordItems(params: {
    fieldId: string;
    fieldMap: IFieldMap;
    fromRecordIds?: string[];
    toRecordIds?: string[];
    fkRecordMap?: IFkRecordMap;
    tableId2DbTableName: { [tableId: string]: string };
  }): Promise<IRelatedRecordItem[]> {
    const { fieldId, fieldMap, fromRecordIds, toRecordIds, fkRecordMap, tableId2DbTableName } =
      params;
    const knex = this.knex;
    const dbProvider = this.dbProvider;

    const field = fieldMap[fieldId];

    const options =
      field.lookupOptions ||
      (field.type === FieldType.Link && (field.options as ILinkFieldOptions));
    if (!options) {
      if (!toRecordIds && !fromRecordIds) {
        throw new Error('toRecordIds or fromRecordIds is required for normal computed field');
      }
      return (toRecordIds?.map((id) => ({ fromId: id, toId: id })) ||
        fromRecordIds?.map((id) => ({ fromId: id, toId: id }))) as IRelatedRecordItem[];
    }

    const relatedLinkField = fieldMap[field.lookupOptions?.linkFieldId || field.id] as LinkFieldDto;
    const symmetricLinkFieldId = relatedLinkField.options.symmetricFieldId;
    const fkMap = fkRecordMap?.[relatedLinkField.id]
      ? fkRecordMap[relatedLinkField.id]
      : symmetricLinkFieldId
        ? this.revertFkMap(fkRecordMap?.[symmetricLinkFieldId])
        : undefined;

    const unionToRecordIds = fkMap
      ? Array.from(new Set([toRecordIds || [], Object.keys(fkMap)].flat()))
      : toRecordIds;

    const { fkHostTableName, selfKeyName, foreignKeyName } = options;

    // 1. Build the base query with initial_to_ids CTE
    const query = knex.with('initial_to_ids', (qb) => {
      if (fromRecordIds?.length) {
        const fromQuery = knex
          .select(selfKeyName)
          .from(fkHostTableName)
          .whereIn(foreignKeyName, fromRecordIds);

        qb.select(selfKeyName).from(fromQuery.as('t'));
      }

      if (unionToRecordIds?.length) {
        const valueQueries = unionToRecordIds.map((id) =>
          knex.select(knex.raw('? as ??', [id, selfKeyName]))
        );
        qb.union(valueQueries);
      }
    });

    // 2. Add filter logic and build final query
    if (field.lookupOptions?.filter) {
      // First get filtered records
      query
        .with('filtered_records', (qb) => {
          const dataTableName = tableId2DbTableName[options.foreignTableId];
          qb.select('__id').from(dataTableName);
          dbProvider.filterQuery(qb, fieldMap, field.lookupOptions!.filter).appendQueryBuilder();
        })
        // Get valid pairs (where fromId passes filter)
        .with('valid_pairs', (qb) => {
          qb.select([`i.${selfKeyName} as toId`, `a.${foreignKeyName} as fromId`])
            .from('initial_to_ids as i')
            .leftJoin(`${fkHostTableName} as a`, `a.${selfKeyName}`, `i.${selfKeyName}`)
            .whereIn(`a.${foreignKeyName}`, function () {
              this.select('__id').from('filtered_records');
            });
        })
        // Union with toIds that have no valid pairs (with null fromId)
        .select('*')
        .from('valid_pairs')
        .unionAll(
          knex
            .select([`initial_to_ids.${selfKeyName} as toId`, knex.raw('NULL as fromId')])
            .from('initial_to_ids')
            .whereNotExists(function () {
              this.select('*')
                .from('valid_pairs')
                .where('toId', knex.ref(`initial_to_ids.${selfKeyName}`));
            })
        );
    } else {
      // No filter, just get all pairs
      query
        .select([`i.${selfKeyName} as toId`, `a.${foreignKeyName} as fromId`])
        .from('initial_to_ids as i')
        .leftJoin(`${fkHostTableName} as a`, `a.${selfKeyName}`, `i.${selfKeyName}`);
    }

    const affectedRecordItemsQuerySql = query.toQuery();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<IRelatedRecordItem[]>(affectedRecordItemsQuerySql);

    return result.filter((item) => item.fromId || item.toId);
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
