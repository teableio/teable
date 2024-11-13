import { BadRequestException, Injectable } from '@nestjs/common';
import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { cloneDeep, keyBy, difference, groupBy, isEqual, set } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import type { IFieldInstance, IFieldMap } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import { SchemaType } from '../field/util';
import { BatchService } from './batch.service';
import type { ICellChange, ICellContext } from './utils/changes';
import { isLinkCellValue } from './utils/detect-link';

export interface IFkRecordMap {
  [fieldId: string]: {
    [recordId: string]: IFkRecordItem;
  };
}

export interface IFkRecordItem {
  oldKey: string | string[] | null; // null means record have no foreignKey
  newKey: string | string[] | null; // null means to delete the foreignKey
}

export interface IRecordMapByTableId {
  [tableId: string]: {
    [recordId: string]: {
      [fieldId: string]: unknown;
    };
  };
}

export interface IFieldMapByTableId {
  [tableId: string]: {
    [fieldId: string]: IFieldInstance;
  };
}

export interface ILinkCellContext {
  recordId: string;
  fieldId: string;
  newValue?: { id: string }[] | { id: string };
  oldValue?: { id: string }[] | { id: string };
}

@Injectable()
export class LinkService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly batchService: BatchService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private validateLinkCell(cell: ILinkCellContext) {
    if (!Array.isArray(cell.newValue)) {
      return cell;
    }
    const checkSet = new Set<string>();
    cell.newValue.forEach((v) => {
      if (checkSet.has(v.id)) {
        throw new BadRequestException(`Cannot set duplicate recordId: ${v.id} in the same cell`);
      }
      checkSet.add(v.id);
    });
    return cell;
  }

  private filterLinkContext(contexts: ILinkCellContext[]): ILinkCellContext[] {
    return contexts
      .filter((ctx) => {
        if (isLinkCellValue(ctx.newValue)) {
          return true;
        }

        return isLinkCellValue(ctx.oldValue);
      })
      .map((ctx) => {
        this.validateLinkCell(ctx);
        return { ...ctx, oldValue: isLinkCellValue(ctx.oldValue) ? ctx.oldValue : undefined };
      });
  }

  private async getRelatedFieldMap(fieldIds: string[]): Promise<IFieldMapByTableId> {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds } },
    });
    const fields = fieldRaws.map(createFieldInstanceByRaw) as LinkFieldDto[];

    const symmetricFieldRaws = await this.prismaService.txClient().field.findMany({
      where: {
        id: {
          in: fields
            .filter((field) => field.options.symmetricFieldId)
            .map((field) => field.options.symmetricFieldId as string),
        },
      },
    });

    const symmetricFields = symmetricFieldRaws.map(createFieldInstanceByRaw) as LinkFieldDto[];

    const lookedFieldRaws = await this.prismaService.txClient().field.findMany({
      where: {
        id: {
          in: fields
            .map((field) => field.options.lookupFieldId)
            .concat(symmetricFields.map((field) => field.options.lookupFieldId)),
        },
      },
    });
    const lookedFields = lookedFieldRaws.map(createFieldInstanceByRaw);

    const instanceMap = keyBy([...fields, ...symmetricFields, ...lookedFields], 'id');

    return [...fieldRaws, ...symmetricFieldRaws, ...lookedFieldRaws].reduce<IFieldMapByTableId>(
      (acc, field) => {
        const { tableId, id } = field;
        if (!acc[tableId]) {
          acc[tableId] = {};
        }
        acc[tableId][id] = instanceMap[id];
        return acc;
      },
      {}
    );
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private updateForeignCellForManyMany(params: {
    fkItem: IFkRecordItem;
    recordId: string;
    symmetricFieldId: string;
    sourceLookedFieldId: string;
    sourceRecordMap: IRecordMapByTableId['tableId'];
    foreignRecordMap: IRecordMapByTableId['tableId'];
  }) {
    const {
      fkItem,
      recordId,
      symmetricFieldId,
      sourceLookedFieldId,
      foreignRecordMap,
      sourceRecordMap,
    } = params;
    const oldKey = (fkItem.oldKey || []) as string[];
    const newKey = (fkItem.newKey || []) as string[];

    const toDelete = difference(oldKey, newKey);
    const toAdd = difference(newKey, oldKey);

    // Update link cell values for symmetric field of the foreign table
    if (toDelete.length) {
      toDelete.forEach((foreignRecordId) => {
        const foreignCellValue = foreignRecordMap[foreignRecordId][symmetricFieldId] as
          | ILinkCellValue[]
          | null;

        if (foreignCellValue) {
          const filteredCellValue = foreignCellValue.filter((item) => item.id !== recordId);
          foreignRecordMap[foreignRecordId][symmetricFieldId] = filteredCellValue.length
            ? filteredCellValue
            : null;
        }
      });
    }

    if (toAdd.length) {
      toAdd.forEach((foreignRecordId) => {
        const sourceRecordTitle = sourceRecordMap[recordId][sourceLookedFieldId] as
          | string
          | undefined;
        const newForeignRecord = foreignRecordMap[foreignRecordId];
        if (!newForeignRecord) {
          throw new BadRequestException(
            `Consistency error, recordId ${foreignRecordId} is not exist`
          );
        }
        const foreignCellValue = newForeignRecord[symmetricFieldId] as ILinkCellValue[] | null;
        if (foreignCellValue) {
          newForeignRecord[symmetricFieldId] = foreignCellValue.concat({
            id: recordId,
            title: sourceRecordTitle,
          });
        } else {
          newForeignRecord[symmetricFieldId] = [{ id: recordId, title: sourceRecordTitle }];
        }
      });
    }
  }

  private updateForeignCellForManyOne(params: {
    fkItem: IFkRecordItem;
    recordId: string;
    symmetricFieldId: string;
    sourceLookedFieldId: string;
    sourceRecordMap: IRecordMapByTableId['tableId'];
    foreignRecordMap: IRecordMapByTableId['tableId'];
  }) {
    const {
      fkItem,
      recordId,
      symmetricFieldId,
      sourceLookedFieldId,
      foreignRecordMap,
      sourceRecordMap,
    } = params;
    const oldKey = fkItem.oldKey as string | null;
    const newKey = fkItem.newKey as string | null;

    // Update link cell values for symmetric field of the foreign table
    if (oldKey) {
      const foreignCellValue = foreignRecordMap[oldKey][symmetricFieldId] as
        | ILinkCellValue[]
        | null;

      if (foreignCellValue) {
        const filteredCellValue = foreignCellValue.filter((item) => item.id !== recordId);
        foreignRecordMap[oldKey][symmetricFieldId] = filteredCellValue.length
          ? filteredCellValue
          : null;
      }
    }

    if (newKey) {
      const sourceRecordTitle = sourceRecordMap[recordId][sourceLookedFieldId] as
        | string
        | undefined;
      const newForeignRecord = foreignRecordMap[newKey];
      if (!newForeignRecord) {
        throw new BadRequestException(`Consistency error, recordId ${newKey} is not exist`);
      }
      const foreignCellValue = newForeignRecord[symmetricFieldId] as ILinkCellValue[] | null;
      if (foreignCellValue) {
        newForeignRecord[symmetricFieldId] = foreignCellValue.concat({
          id: recordId,
          title: sourceRecordTitle,
        });
      } else {
        newForeignRecord[symmetricFieldId] = [{ id: recordId, title: sourceRecordTitle }];
      }
    }
  }

  private updateForeignCellForOneMany(params: {
    fkItem: IFkRecordItem;
    recordId: string;
    symmetricFieldId: string;
    sourceLookedFieldId: string;
    sourceRecordMap: IRecordMapByTableId['tableId'];
    foreignRecordMap: IRecordMapByTableId['tableId'];
  }) {
    const {
      fkItem,
      recordId,
      symmetricFieldId,
      sourceLookedFieldId,
      foreignRecordMap,
      sourceRecordMap,
    } = params;

    const oldKey = (fkItem.oldKey || []) as string[];
    const newKey = (fkItem.newKey || []) as string[];

    const toDelete = difference(oldKey, newKey);
    const toAdd = difference(newKey, oldKey);

    if (toDelete.length) {
      toDelete.forEach((foreignRecordId) => {
        foreignRecordMap[foreignRecordId][symmetricFieldId] = null;
      });
    }

    if (toAdd.length) {
      const sourceRecordTitle = sourceRecordMap[recordId][sourceLookedFieldId] as
        | string
        | undefined;

      toAdd.forEach((foreignRecordId) => {
        foreignRecordMap[foreignRecordId][symmetricFieldId] = {
          id: recordId,
          title: sourceRecordTitle,
        };
      });
    }
  }

  private updateForeignCellForOneOne(params: {
    fkItem: IFkRecordItem;
    recordId: string;
    symmetricFieldId: string;
    sourceLookedFieldId: string;
    sourceRecordMap: IRecordMapByTableId['tableId'];
    foreignRecordMap: IRecordMapByTableId['tableId'];
  }) {
    const {
      fkItem,
      recordId,
      symmetricFieldId,
      sourceLookedFieldId,
      foreignRecordMap,
      sourceRecordMap,
    } = params;

    const oldKey = fkItem.oldKey as string | undefined;
    const newKey = fkItem.newKey as string | undefined;

    if (oldKey) {
      foreignRecordMap[oldKey][symmetricFieldId] = null;
    }

    if (newKey) {
      const sourceRecordTitle = sourceRecordMap[recordId][sourceLookedFieldId] as
        | string
        | undefined;

      foreignRecordMap[newKey][symmetricFieldId] = {
        id: recordId,
        title: sourceRecordTitle,
      };
    }
  }

  // update link cellValue title for the user input value of the source table
  private fixLinkCellTitle(params: {
    newKey: string | string[] | null;
    recordId: string;
    linkFieldId: string;
    foreignLookedFieldId: string;
    sourceRecordMap: IRecordMapByTableId['tableId'];
    foreignRecordMap: IRecordMapByTableId['tableId'];
  }) {
    const {
      newKey,
      recordId,
      linkFieldId,
      foreignLookedFieldId,
      foreignRecordMap,
      sourceRecordMap,
    } = params;

    if (!newKey) {
      return;
    }

    if (Array.isArray(newKey)) {
      sourceRecordMap[recordId][linkFieldId] = newKey.map((key) => ({
        id: key,
        title: foreignRecordMap[key][foreignLookedFieldId] as string | undefined,
      }));
      return;
    }

    const foreignRecordTitle = foreignRecordMap[newKey][foreignLookedFieldId] as string | undefined;
    sourceRecordMap[recordId][linkFieldId] = { id: newKey, title: foreignRecordTitle };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async updateLinkRecord(
    tableId: string,
    fkRecordMap: IFkRecordMap,
    fieldMapByTableId: { [tableId: string]: IFieldMap },
    originRecordMapByTableId: IRecordMapByTableId
  ): Promise<IRecordMapByTableId> {
    const recordMapByTableId = cloneDeep(originRecordMapByTableId);
    for (const fieldId in fkRecordMap) {
      const linkField = fieldMapByTableId[tableId][fieldId] as LinkFieldDto;
      const linkFieldId = linkField.id;
      const relationship = linkField.options.relationship;
      const foreignTableId = linkField.options.foreignTableId;
      const foreignLookedFieldId = linkField.options.lookupFieldId;

      const sourceRecordMap = recordMapByTableId[tableId];
      const foreignRecordMap = recordMapByTableId[foreignTableId];
      const symmetricFieldId = linkField.options.symmetricFieldId;

      for (const recordId in fkRecordMap[fieldId]) {
        const fkItem = fkRecordMap[fieldId][recordId];

        this.fixLinkCellTitle({
          newKey: fkItem.newKey,
          recordId,
          linkFieldId,
          foreignLookedFieldId,
          sourceRecordMap,
          foreignRecordMap,
        });

        if (!symmetricFieldId) {
          continue;
        }
        const symmetricField = fieldMapByTableId[foreignTableId][symmetricFieldId] as LinkFieldDto;
        const sourceLookedFieldId = symmetricField.options.lookupFieldId;
        const params = {
          fkItem,
          recordId,
          symmetricFieldId,
          sourceLookedFieldId,
          sourceRecordMap,
          foreignRecordMap,
        };
        if (relationship === Relationship.ManyMany) {
          this.updateForeignCellForManyMany(params);
        }
        if (relationship === Relationship.ManyOne) {
          this.updateForeignCellForManyOne(params);
        }
        if (relationship === Relationship.OneMany) {
          this.updateForeignCellForOneMany(params);
        }
        if (relationship === Relationship.OneOne) {
          this.updateForeignCellForOneOne(params);
        }
      }
    }
    return recordMapByTableId;
  }

  private async getForeignKeys(
    recordIds: string[],
    linkRecordIds: string[],
    options: ILinkFieldOptions
  ) {
    const { fkHostTableName, selfKeyName, foreignKeyName } = options;

    const query = this.knex(fkHostTableName)
      .select({
        id: selfKeyName,
        foreignId: foreignKeyName,
      })
      .whereIn(selfKeyName, recordIds)
      .orWhereIn(foreignKeyName, linkRecordIds)
      .whereNotNull(selfKeyName)
      .whereNotNull(foreignKeyName)
      .toQuery();

    return this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id: string; foreignId: string }[]>(query);
  }

  async getAllForeignKeys(options: ILinkFieldOptions) {
    const { fkHostTableName, selfKeyName, foreignKeyName } = options;

    const query = this.knex(fkHostTableName)
      .select({
        id: selfKeyName,
        foreignId: foreignKeyName,
      })
      .whereNotNull(selfKeyName)
      .whereNotNull(foreignKeyName)
      .toQuery();

    return this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id: string; foreignId: string }[]>(query);
  }

  private async getJoinedForeignKeys(linkRecordIds: string[], options: ILinkFieldOptions) {
    const { fkHostTableName, selfKeyName, foreignKeyName } = options;

    const query = this.knex(fkHostTableName)
      .select({
        id: selfKeyName,
        foreignId: foreignKeyName,
      })
      .whereIn(selfKeyName, function () {
        this.select(selfKeyName)
          .from(fkHostTableName)
          .whereIn(foreignKeyName, linkRecordIds)
          .whereNotNull(selfKeyName);
      })
      .whereNotNull(foreignKeyName)
      .toQuery();

    return this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id: string; foreignId: string }[]>(query);
  }

  /**
   * Checks if there are duplicate associations in one-to-one and one-to-many relationships.
   */
  private checkForIllegalDuplicateLinks(
    field: LinkFieldDto,
    recordIds: string[],
    indexedCellContext: Record<string, ILinkCellContext>
  ) {
    const relationship = field.options.relationship;
    if (relationship === Relationship.ManyMany || relationship === Relationship.ManyOne) {
      return;
    }
    const checkSet = new Set<string>();

    recordIds.forEach((recordId) => {
      const cellValue = indexedCellContext[`${field.id}-${recordId}`].newValue;
      if (!cellValue) {
        return;
      }
      if (Array.isArray(cellValue)) {
        cellValue.forEach((item) => {
          if (checkSet.has(item.id)) {
            throw new BadRequestException(
              `Consistency error, ${relationship} link field {${field.id}} unable to link a record (${item.id}) more than once`
            );
          }
          checkSet.add(item.id);
        });
        return;
      }
      if (checkSet.has(cellValue.id)) {
        throw new BadRequestException(
          `Consistency error, ${relationship} link field {${field.id}} unable to link a record (${cellValue.id}) more than once`
        );
      }
      checkSet.add(cellValue.id);
    });
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private parseFkRecordItem(
    field: LinkFieldDto,
    cellContexts: ILinkCellContext[],
    foreignKeys: {
      id: string;
      foreignId: string;
    }[]
  ): Record<string, IFkRecordItem> {
    const relationship = field.options.relationship;
    const foreignKeysIndexed = groupBy(foreignKeys, 'id');
    const foreignKeysReverseIndexed =
      relationship === Relationship.OneMany || relationship === Relationship.OneOne
        ? groupBy(foreignKeys, 'foreignId')
        : undefined;

    // eslint-disable-next-line sonarjs/cognitive-complexity
    return cellContexts.reduce<IFkRecordMap['fieldId']>((acc, cellContext) => {
      // this two relations only have one key in one recordId
      const id = cellContext.recordId;
      const foreignKeys = foreignKeysIndexed[id];
      if (relationship === Relationship.OneOne || relationship === Relationship.ManyOne) {
        const newCellValue = cellContext.newValue as ILinkCellValue | undefined;
        if (Array.isArray(newCellValue)) {
          throw new BadRequestException(
            `CellValue of ${relationship} link field values cannot be an array`
          );
        }

        if ((foreignKeys?.length ?? 0) > 1) {
          throw new Error('duplicate foreign key from database');
        }

        const foreignRecordId = foreignKeys?.[0].foreignId;
        const oldKey = foreignRecordId || null;
        const newKey = newCellValue?.id || null;
        if (oldKey === newKey) {
          return acc;
        }

        if (newKey && foreignKeysReverseIndexed?.[newKey]) {
          throw new BadRequestException(
            `Consistency error, ${relationship} link field {${field.id}} unable to link a record (${newKey}) more than once`
          );
        }

        acc[id] = { oldKey, newKey };
        return acc;
      }

      if (relationship === Relationship.ManyMany || relationship === Relationship.OneMany) {
        const newCellValue = cellContext.newValue as ILinkCellValue[] | undefined;
        if (newCellValue && !Array.isArray(newCellValue)) {
          throw new BadRequestException(
            `CellValue of ${relationship} link field values should be an array`
          );
        }

        const oldKey = foreignKeys?.map((key) => key.foreignId) ?? null;
        const newKey = newCellValue?.map((item) => item.id) ?? null;

        const extraKey = difference(newKey ?? [], oldKey ?? []);

        extraKey.forEach((key) => {
          if (foreignKeysReverseIndexed?.[key]) {
            throw new BadRequestException(
              `Consistency error, ${relationship} link field {${field.id}} unable to link a record (${key}) more than once`
            );
          }
        });
        acc[id] = {
          oldKey,
          newKey,
        };
        return acc;
      }
      return acc;
    }, {});
  }

  /**
   * Tip: for single source of truth principle, we should only trust foreign key recordId
   *
   * 1. get all edited recordId and group by fieldId
   * 2. get all exist foreign key recordId
   */
  private async getFkRecordMap(
    fieldMap: IFieldMap,
    cellContexts: ILinkCellContext[]
  ): Promise<IFkRecordMap> {
    const fkRecordMap: IFkRecordMap = {};

    const cellGroupByFieldId = groupBy(cellContexts, (ctx) => ctx.fieldId);
    const indexedCellContext = keyBy(cellContexts, (ctx) => `${ctx.fieldId}-${ctx.recordId}`);
    for (const fieldId in cellGroupByFieldId) {
      const field = fieldMap[fieldId];
      if (!field) {
        throw new BadRequestException(`Field ${fieldId} not found`);
      }

      if (field.type !== FieldType.Link) {
        throw new BadRequestException(`Field ${fieldId} is not link field`);
      }

      const recordIds = cellGroupByFieldId[fieldId].map((ctx) => ctx.recordId);
      const linkRecordIds = cellGroupByFieldId[fieldId]
        .map((ctx) =>
          [ctx.oldValue, ctx.newValue]
            .flat()
            .filter(Boolean)
            .map((item) => item?.id as string)
        )
        .flat();

      const foreignKeys = await this.getForeignKeys(recordIds, linkRecordIds, field.options);
      this.checkForIllegalDuplicateLinks(field, recordIds, indexedCellContext);

      fkRecordMap[fieldId] = this.parseFkRecordItem(
        field,
        cellGroupByFieldId[fieldId],
        foreignKeys
      );
    }

    return fkRecordMap;
  }

  // create the key for recordMapByTableId but leave the undefined value for the next step
  private getRecordMapStruct(
    tableId: string,
    fieldMapByTableId: { [tableId: string]: IFieldMap },
    cellContexts: ILinkCellContext[]
  ) {
    const recordMapByTableId: IRecordMapByTableId = {};

    for (const cellContext of cellContexts) {
      const { recordId, fieldId, newValue, oldValue } = cellContext;
      const linkRecordIds = [oldValue, newValue]
        .flat()
        .filter(Boolean)
        .map((item) => item?.id as string);
      const field = fieldMapByTableId[tableId][fieldId] as LinkFieldDto;
      const foreignTableId = field.options.foreignTableId;
      const symmetricFieldId = field.options.symmetricFieldId;
      const symmetricField = symmetricFieldId
        ? (fieldMapByTableId[foreignTableId][symmetricFieldId] as LinkFieldDto)
        : undefined;
      const foreignLookedFieldId = field.options.lookupFieldId;
      const lookedFieldId = symmetricField?.options.lookupFieldId;

      set(recordMapByTableId, [tableId, recordId, fieldId], undefined);
      lookedFieldId && set(recordMapByTableId, [tableId, recordId, lookedFieldId], undefined);

      // create object key for record in looked field
      linkRecordIds.forEach((linkRecordId) => {
        symmetricFieldId &&
          set(recordMapByTableId, [foreignTableId, linkRecordId, symmetricFieldId], undefined);
        set(recordMapByTableId, [foreignTableId, linkRecordId, foreignLookedFieldId], undefined);
      });
    }

    return recordMapByTableId;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async fetchRecordMap(
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: { [tableId: string]: IFieldMap },
    recordMapByTableId: IRecordMapByTableId,
    cellContexts: ICellContext[],
    fromReset?: boolean
  ): Promise<IRecordMapByTableId> {
    const cellContextGroup = keyBy(cellContexts, (ctx) => `${ctx.recordId}-${ctx.fieldId}`);
    for (const tableId in recordMapByTableId) {
      const recordLookupFieldsMap = recordMapByTableId[tableId];
      const recordIds = Object.keys(recordLookupFieldsMap);
      const fieldIds = Array.from(
        Object.values(recordLookupFieldsMap).reduce<Set<string>>((pre, cur) => {
          for (const fieldId in cur) {
            pre.add(fieldId);
          }
          return pre;
        }, new Set())
      );

      const dbFieldName2FieldId: { [dbFieldName: string]: string } = {};
      const dbFieldNames = fieldIds.map((fieldId) => {
        const field = fieldMapByTableId[tableId][fieldId];
        // dbForeignName is not exit in fieldMapByTableId
        if (!field) {
          return fieldId;
        }
        dbFieldName2FieldId[field.dbFieldName] = fieldId;
        return field.dbFieldName;
      });

      const nativeQuery = this.knex(tableId2DbTableName[tableId])
        .select(dbFieldNames.concat('__id'))
        .whereIn('__id', recordIds)
        .toQuery();

      const recordRaw = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ [dbTableName: string]: unknown }[]>(nativeQuery);

      recordRaw.forEach((record) => {
        const recordId = record.__id as string;
        delete record.__id;
        for (const dbFieldName in record) {
          const fieldId = dbFieldName2FieldId[dbFieldName];
          let cellValue = record[dbFieldName];

          // dbForeignName is not exit in fieldMapByTableId
          if (!fieldId) {
            recordLookupFieldsMap[recordId][dbFieldName] = cellValue;
            continue;
          }
          const field = fieldMapByTableId[tableId][fieldId];
          if (fromReset && field.type === FieldType.Link) {
            continue;
          }

          // Overlay with new data, especially cellValue in primary field
          const inputData = cellContextGroup[`${recordId}-${fieldId}`];
          if (field.type !== FieldType.Link && inputData !== undefined) {
            recordLookupFieldsMap[recordId][fieldId] = inputData.newValue ?? undefined;
            continue;
          }

          cellValue = field.convertDBValue2CellValue(cellValue);

          recordLookupFieldsMap[recordId][fieldId] = cellValue ?? undefined;
        }
      }, {});
    }

    return recordMapByTableId;
  }

  private async getTableId2DbTableName(tableIds: string[]) {
    const tableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        id: {
          in: tableIds,
        },
      },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    return tableRaws.reduce<{ [tableId: string]: string }>((acc, cur) => {
      acc[cur.id] = cur.dbTableName;
      return acc;
    }, {});
  }

  private diffLinkCellChange(
    fieldMapByTableId: { [tableId: string]: IFieldMap },
    originRecordMapByTableId: IRecordMapByTableId,
    updatedRecordMapByTableId: IRecordMapByTableId
  ): ICellChange[] {
    const changes: ICellChange[] = [];

    for (const tableId in originRecordMapByTableId) {
      const originRecords = originRecordMapByTableId[tableId];
      const updatedRecords = updatedRecordMapByTableId[tableId];
      const fieldMap = fieldMapByTableId[tableId];

      for (const recordId in originRecords) {
        const originFields = originRecords[recordId];
        const updatedFields = updatedRecords[recordId];

        for (const fieldId in originFields) {
          if (fieldMap[fieldId].type !== FieldType.Link) {
            continue;
          }

          const oldValue = originFields[fieldId];
          const newValue = updatedFields[fieldId];

          if (!isEqual(oldValue, newValue)) {
            changes.push({ tableId, recordId, fieldId, oldValue, newValue });
          }
        }
      }
    }

    return changes;
  }

  private async getDerivateByCellContexts(
    tableId: string,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: { [tableId: string]: IFieldMap },
    linkContexts: ILinkCellContext[],
    cellContexts: ICellContext[],
    fromReset?: boolean
  ): Promise<{
    cellChanges: ICellChange[];
    fkRecordMap: IFkRecordMap;
  }> {
    const fieldMap = fieldMapByTableId[tableId];
    const recordMapStruct = this.getRecordMapStruct(tableId, fieldMapByTableId, linkContexts);

    // console.log('fieldMapByTableId', fieldMapByTableId);
    const fkRecordMap = await this.getFkRecordMap(fieldMap, linkContexts);

    const originRecordMapByTableId = await this.fetchRecordMap(
      tableId2DbTableName,
      fieldMapByTableId,
      recordMapStruct,
      cellContexts,
      fromReset
    );

    const updatedRecordMapByTableId = await this.updateLinkRecord(
      tableId,
      fkRecordMap,
      fieldMapByTableId,
      originRecordMapByTableId
    );

    const cellChanges = this.diffLinkCellChange(
      fieldMapByTableId,
      originRecordMapByTableId,
      updatedRecordMapByTableId
    );
    await this.saveForeignKeyToDb(fieldMap, fkRecordMap);
    return {
      cellChanges,
      fkRecordMap,
    };
  }

  private async saveForeignKeyForManyMany(
    field: LinkFieldDto,
    fkMap: { [recordId: string]: IFkRecordItem }
  ) {
    const { selfKeyName, foreignKeyName, fkHostTableName } = field.options;

    const toDelete: [string, string][] = [];
    const toAdd: [string, string][] = [];
    for (const recordId in fkMap) {
      const fkItem = fkMap[recordId];
      const oldKey = (fkItem.oldKey || []) as string[];
      const newKey = (fkItem.newKey || []) as string[];

      difference(oldKey, newKey).forEach((key) => toDelete.push([recordId, key]));
      difference(newKey, oldKey).forEach((key) => toAdd.push([recordId, key]));
    }

    if (toDelete.length) {
      const query = this.knex(fkHostTableName)
        .whereIn([selfKeyName, foreignKeyName], toDelete)
        .delete()
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(query);
    }

    if (toAdd.length) {
      const query = this.knex(fkHostTableName)
        .insert(
          toAdd.map(([source, target]) => ({
            [selfKeyName]: source,
            [foreignKeyName]: target,
          }))
        )
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(query);
    }
  }

  private async saveForeignKeyForManyOne(
    field: LinkFieldDto,
    fkMap: { [recordId: string]: IFkRecordItem }
  ) {
    const { selfKeyName, foreignKeyName, fkHostTableName } = field.options;

    const toDelete: [string, string][] = [];
    const toAdd: [string, string][] = [];
    for (const recordId in fkMap) {
      const fkItem = fkMap[recordId];
      const oldKey = fkItem.oldKey as string | null;
      const newKey = fkItem.newKey as string | null;

      oldKey && toDelete.push([recordId, oldKey]);
      newKey && toAdd.push([recordId, newKey]);
    }

    if (toDelete.length) {
      const query = this.knex(fkHostTableName)
        .update({ [foreignKeyName]: null })
        .whereIn([selfKeyName, foreignKeyName], toDelete)
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(query);
    }

    if (toAdd.length) {
      await this.batchService.batchUpdateDB(
        fkHostTableName,
        selfKeyName,
        [{ dbFieldName: foreignKeyName, schemaType: SchemaType.String }],
        toAdd.map(([recordId, foreignRecordId]) => ({
          id: recordId,
          values: { [foreignKeyName]: foreignRecordId },
        }))
      );
    }
  }

  private async saveForeignKeyForOneMany(
    field: LinkFieldDto,
    fkMap: { [recordId: string]: IFkRecordItem }
  ) {
    const { selfKeyName, foreignKeyName, fkHostTableName, isOneWay } = field.options;

    if (isOneWay) {
      this.saveForeignKeyForManyMany(field, fkMap);
      return;
    }
    const toDelete: [string, string][] = [];
    const toAdd: [string, string][] = [];
    for (const recordId in fkMap) {
      const fkItem = fkMap[recordId];
      const oldKey = (fkItem.oldKey || []) as string[];
      const newKey = (fkItem.newKey || []) as string[];

      difference(oldKey, newKey).forEach((key) => toDelete.push([recordId, key]));
      difference(newKey, oldKey).forEach((key) => toAdd.push([recordId, key]));
    }

    if (toDelete.length) {
      const query = this.knex(fkHostTableName)
        .update({ [selfKeyName]: null })
        .whereIn([selfKeyName, foreignKeyName], toDelete)
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(query);
    }

    if (toAdd.length) {
      await this.batchService.batchUpdateDB(
        fkHostTableName,
        foreignKeyName,
        [{ dbFieldName: selfKeyName, schemaType: SchemaType.String }],
        toAdd.map(([recordId, foreignRecordId]) => ({
          id: foreignRecordId,
          values: { [selfKeyName]: recordId },
        }))
      );
    }
  }

  private async saveForeignKeyForOneOne(
    field: LinkFieldDto,
    fkMap: { [recordId: string]: IFkRecordItem }
  ) {
    const { selfKeyName, foreignKeyName, fkHostTableName } = field.options;
    if (selfKeyName === '__id') {
      await this.saveForeignKeyForManyOne(field, fkMap);
    } else {
      const toDelete: [string, string][] = [];
      const toAdd: [string, string][] = [];
      for (const recordId in fkMap) {
        const fkItem = fkMap[recordId];
        const oldKey = fkItem.oldKey as string | null;
        const newKey = fkItem.newKey as string | null;

        oldKey && toDelete.push([recordId, oldKey]);
        newKey && toAdd.push([recordId, newKey]);
      }

      if (toDelete.length) {
        const query = this.knex(fkHostTableName)
          .update({ [selfKeyName]: null })
          .whereIn([selfKeyName, foreignKeyName], toDelete)
          .toQuery();
        await this.prismaService.txClient().$executeRawUnsafe(query);
      }

      if (toAdd.length) {
        await this.batchService.batchUpdateDB(
          fkHostTableName,
          foreignKeyName,
          [{ dbFieldName: selfKeyName, schemaType: SchemaType.String }],
          toAdd.map(([recordId, foreignRecordId]) => ({
            id: foreignRecordId,
            values: { [selfKeyName]: recordId },
          }))
        );
      }
    }
  }

  private async saveForeignKeyToDb(fieldMap: IFieldMap, fkRecordMap: IFkRecordMap) {
    for (const fieldId in fkRecordMap) {
      const fkMap = fkRecordMap[fieldId];
      const field = fieldMap[fieldId] as LinkFieldDto;
      const relationship = field.options.relationship;
      if (relationship === Relationship.ManyMany) {
        await this.saveForeignKeyForManyMany(field, fkMap);
      }
      if (relationship === Relationship.ManyOne) {
        await this.saveForeignKeyForManyOne(field, fkMap);
      }
      if (relationship === Relationship.OneMany) {
        await this.saveForeignKeyForOneMany(field, fkMap);
      }
      if (relationship === Relationship.OneOne) {
        await this.saveForeignKeyForOneOne(field, fkMap);
      }
    }
  }

  /**
   * strategy
   * 0: define `main table` is where foreign key located in, `foreign table` is where foreign key referenced to
   * 1. generate foreign key changes, cache effected recordIds, both main table and foreign table
   * 2. update foreign key by changes and submit origin op
   * 3. check and generate op to update main table by cached recordIds
   * 4. check and generate op to update foreign table by cached recordIds
   */
  async getDerivateByLink(tableId: string, cellContexts: ICellContext[], fromReset?: boolean) {
    const linkContexts = this.filterLinkContext(cellContexts as ILinkCellContext[]);
    if (!linkContexts.length) {
      return;
    }
    const fieldIds = linkContexts.map((ctx) => ctx.fieldId);
    const fieldMapByTableId = await this.getRelatedFieldMap(fieldIds);
    const tableId2DbTableName = await this.getTableId2DbTableName(Object.keys(fieldMapByTableId));

    return this.getDerivateByCellContexts(
      tableId,
      tableId2DbTableName,
      fieldMapByTableId,
      linkContexts,
      cellContexts,
      fromReset
    );
  }

  private parseFkRecordItemToDelete(
    options: ILinkFieldOptions,
    toDeleteRecordIds: string[],
    foreignKeys: {
      id: string;
      foreignId: string;
    }[]
  ): Record<string, IFkRecordItem> {
    const relationship = options.relationship;
    const foreignKeysIndexed = groupBy(foreignKeys, 'id');
    const toDeleteSet = new Set(toDeleteRecordIds);

    return Object.keys(foreignKeysIndexed).reduce<IFkRecordMap['fieldId']>((acc, id) => {
      // this two relations only have one key in one recordId
      const foreignKeys = foreignKeysIndexed[id];
      if (relationship === Relationship.OneOne || relationship === Relationship.ManyOne) {
        if ((foreignKeys?.length ?? 0) > 1) {
          throw new Error('duplicate foreign key from database');
        }

        const foreignRecordId = foreignKeys?.[0].foreignId;
        const oldKey = foreignRecordId || null;
        if (!toDeleteSet.has(foreignRecordId)) {
          return acc;
        }

        acc[id] = { oldKey, newKey: null };
        return acc;
      }

      if (relationship === Relationship.ManyMany || relationship === Relationship.OneMany) {
        const oldKey = foreignKeys?.map((key) => key.foreignId) ?? null;
        if (!oldKey) {
          return acc;
        }

        const newKey = oldKey.filter((key) => !toDeleteSet.has(key));

        if (newKey.length === oldKey.length) {
          return acc;
        }

        acc[id] = {
          oldKey,
          newKey: newKey.length ? newKey : null,
        };
        return acc;
      }
      return acc;
    }, {});
  }

  private async getContextByDelete(linkFieldRaws: Field[], recordIds: string[]) {
    const cellContextsMap: { [tableId: string]: ICellContext[] } = {};

    const keyToValue = (key: string | string[] | null) =>
      key ? (Array.isArray(key) ? key.map((id) => ({ id })) : { id: key }) : null;

    for (const fieldRaws of linkFieldRaws) {
      const options = JSON.parse(fieldRaws.options as string) as ILinkFieldOptions;
      const tableId = fieldRaws.tableId;
      const foreignKeys = await this.getJoinedForeignKeys(recordIds, options);
      const fieldItems = this.parseFkRecordItemToDelete(options, recordIds, foreignKeys);
      if (!cellContextsMap[tableId]) {
        cellContextsMap[tableId] = [];
      }
      Object.keys(fieldItems).forEach((recordId) => {
        const { oldKey, newKey } = fieldItems[recordId];
        cellContextsMap[tableId].push({
          fieldId: fieldRaws.id,
          recordId,
          oldValue: keyToValue(oldKey),
          newValue: keyToValue(newKey),
        });
      });
    }

    return cellContextsMap;
  }

  async getRelatedLinkFieldRaws(tableId: string) {
    const { id: primaryFieldId } = await this.prismaService
      .txClient()
      .field.findFirstOrThrow({
        where: { tableId, deletedTime: null, isPrimary: true },
        select: { id: true },
      })
      .catch(() => {
        throw new BadRequestException(`Primary field not found`);
      });

    const references = await this.prismaService.txClient().reference.findMany({
      where: { fromFieldId: primaryFieldId },
      select: { toFieldId: true },
    });

    const referenceFieldIds = references.map((ref) => ref.toFieldId);

    return await this.prismaService.txClient().field.findMany({
      where: {
        id: { in: referenceFieldIds },
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
    });
  }

  async getDeleteRecordUpdateContext(tableId: string, recordIds: string[]) {
    const linkFieldRaws = await this.getRelatedLinkFieldRaws(tableId);

    return await this.getContextByDelete(linkFieldRaws, recordIds);
  }
}
