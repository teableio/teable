import { BadRequestException, Injectable } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable-group/core';
import { FieldType, Relationship } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { cloneDeep, isEqual, set } from 'lodash';
import type { IFkOpMap } from './reference.service';
import type { ICellChange } from './utils/changes';
import { isLinkCellValue } from './utils/detect-link';

export interface ITinyLinkField {
  id: string;
  tableId: string;
  type: FieldType;
  dbFieldName: string;
  options: ILinkFieldOptions;
}

export interface IRecordMapByTableId {
  [tableId: string]: {
    [recordId: string]: {
      [fieldId: string]: unknown;
    };
  };
}

export interface ITinyFieldMapByTableId {
  [tableId: string]: {
    [fieldId: string]: ITinyLinkField;
  };
}

export interface ILinkCellContext {
  recordId: string;
  fieldId: string;
  newValue?: { id: string }[] | { id: string };
  oldValue?: { id: string }[] | { id: string };
}

export interface ICellContext {
  recordId: string;
  fieldId: string;
  newValue?: unknown;
  oldValue?: unknown;
}

interface IUpdateForeignKeyParam {
  tableId: string;
  foreignTableId: string;
  mainLinkFieldId: string;
  mainTableLookupFieldId: string;
  foreignLinkFieldId: string;
  foreignTableLookupFieldId: string;
  dbForeignKeyName: string;
  recordId: string;
  fRecordId: string | null;
}

@Injectable()
export class LinkService {
  private readonly knex = knex({ client: 'sqlite3' });

  private filterLinkContext(contexts: ILinkCellContext[]): ILinkCellContext[] {
    return contexts.filter((ctx) => {
      if (isLinkCellValue(ctx.newValue)) {
        return true;
      }

      return isLinkCellValue(ctx.oldValue);
    });
  }

  private async getTinyFieldsByIds(prisma: Prisma.TransactionClient, fieldIds: string[]) {
    const fieldRaws = await prisma.field.findMany({
      where: { id: { in: fieldIds } },
      select: { id: true, type: true, options: true, tableId: true, dbFieldName: true },
    });

    return fieldRaws.map<ITinyLinkField>((field) => ({
      ...field,
      type: field.type as FieldType,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      options: JSON.parse(field.options!),
    }));
  }

  private async getTinyFieldMapByTableId(
    prisma: Prisma.TransactionClient,
    fieldIds: string[]
  ): Promise<ITinyFieldMapByTableId> {
    const fields = await this.getTinyFieldsByIds(prisma, fieldIds);

    const symmetricFields = await this.getTinyFieldsByIds(
      prisma,
      fields.map((field) => field.options.symmetricFieldId)
    );

    const relatedFields = await this.getTinyFieldsByIds(
      prisma,
      fields
        .map((field) => field.options.lookupFieldId)
        .concat(symmetricFields.map((field) => field.options.lookupFieldId))
    );

    return fields
      .concat(symmetricFields, relatedFields)
      .reduce<ITinyFieldMapByTableId>((acc, field) => {
        const { tableId, id } = field;
        if (!acc[tableId]) {
          acc[tableId] = {};
        }
        acc[tableId][id] = field;
        return acc;
      }, {});
  }

  /**
   * mainLinkFieldId is the link fieldId of the main table, contain only one link cell value
   * foreignLinkFieldId is the link fieldId of the foreign table, contain multiple link cell value
   */
  private updateForeignKeyInMemory(
    updateForeignKeyParams: IUpdateForeignKeyParam[],
    recordMapByTableId: IRecordMapByTableId
  ) {
    recordMapByTableId = cloneDeep(recordMapByTableId);
    updateForeignKeyParams.forEach((param) => {
      const {
        tableId,
        foreignTableId,
        mainLinkFieldId,
        foreignTableLookupFieldId,
        mainTableLookupFieldId,
        foreignLinkFieldId,
        dbForeignKeyName: fkFieldId,
        recordId,
        fRecordId,
      } = param;
      const foreignTable = recordMapByTableId[foreignTableId];
      const mainRecord = recordMapByTableId[tableId][recordId];
      if (!mainRecord) {
        throw new Error('mainRecord not found');
      }

      // If there is an old value, remove this record from the old foreign Link Field
      const oldFRecordId = mainRecord[fkFieldId] as string;
      if (oldFRecordId) {
        const fRecord = foreignTable[oldFRecordId];
        const oldFRecordFLink = fRecord[foreignLinkFieldId] as
          | { id: string; title?: string }[]
          | undefined;
        const newFRecordFLink = (oldFRecordFLink || []).filter((record) => record.id !== recordId);
        fRecord[foreignLinkFieldId] = newFRecordFLink.length ? newFRecordFLink : null;
      }

      // If the fRecordId is not null, add this record to the new foreignTable's foreignLinkField
      if (fRecordId) {
        const newFRecord = foreignTable[fRecordId];
        const newFRecordFLink = newFRecord[foreignLinkFieldId] as
          | { id: string; title?: string }[]
          | undefined;
        const title = mainRecord[mainTableLookupFieldId] as string | undefined;
        if (newFRecordFLink) {
          newFRecordFLink.push({
            id: recordId,
            title,
          });
        } else {
          newFRecord[foreignLinkFieldId] = [{ id: recordId, title }];
        }
      }

      if (fRecordId) {
        mainRecord[mainLinkFieldId] = { id: fRecordId };
      }

      // Update the link field in main table
      mainRecord[mainLinkFieldId] = fRecordId
        ? { id: fRecordId, title: foreignTable[fRecordId][foreignTableLookupFieldId] as string }
        : null;

      // Update the foreignKey field in main table
      mainRecord[fkFieldId] = fRecordId;
    });
    return recordMapByTableId;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private getRecordMapStructAndForeignKeyParams(
    tableId: string,
    fieldMapByTableId: ITinyFieldMapByTableId,
    cellContexts: ILinkCellContext[]
  ) {
    const recordMapByTableId: IRecordMapByTableId = {};
    const updateForeignKeyParams: IUpdateForeignKeyParam[] = [];
    for (const cellContext of cellContexts) {
      const { recordId, fieldId, newValue, oldValue } = cellContext;
      const linkRecordIds = [oldValue, newValue]
        .flat()
        .filter(Boolean)
        .map((item) => item?.id as string);
      const field = fieldMapByTableId[tableId][fieldId];
      const dbForeignKeyName = field.options.dbForeignKeyName;
      const foreignTableId = field.options.foreignTableId;
      const foreignLinkFieldId = field.options.symmetricFieldId;
      const foreignField = fieldMapByTableId[foreignTableId][foreignLinkFieldId];
      const foreignLookupFieldId = field.options.lookupFieldId;
      const lookupFieldId = foreignField.options.lookupFieldId;

      set(recordMapByTableId, [tableId, recordId, fieldId], undefined);
      set(recordMapByTableId, [tableId, recordId, lookupFieldId], undefined);

      linkRecordIds.forEach((linkRecordId) => {
        set(recordMapByTableId, [foreignTableId, linkRecordId, foreignLinkFieldId], undefined);
        set(recordMapByTableId, [foreignTableId, linkRecordId, foreignLookupFieldId], undefined);
      });

      if (field.options.relationship === Relationship.ManyOne) {
        if (newValue && !('id' in newValue)) {
          throw new BadRequestException('ManyOne relationship should not have multiple records');
        }
        // add dbForeignKeyName to the record
        set(recordMapByTableId, [tableId, recordId, dbForeignKeyName], undefined);
        updateForeignKeyParams.push({
          tableId,
          foreignTableId,
          mainLinkFieldId: fieldId,
          mainTableLookupFieldId: lookupFieldId,
          foreignLinkFieldId,
          foreignTableLookupFieldId: foreignLookupFieldId,
          dbForeignKeyName: field.options.dbForeignKeyName,
          recordId,
          fRecordId: newValue?.id || null,
        });
      }
      if (field.options.relationship === Relationship.OneMany) {
        if (newValue && !Array.isArray(newValue)) {
          throw new BadRequestException(
            'ManyMany relationship newValue should have multiple records'
          );
        }
        if (oldValue && !Array.isArray(oldValue)) {
          throw new BadRequestException(
            'ManyMany relationship oldValue should have multiple records'
          );
        }
        const paramCommon = {
          tableId: foreignTableId,
          foreignTableId: tableId,
          mainLinkFieldId: foreignLinkFieldId,
          mainTableLookupFieldId: foreignLookupFieldId,
          foreignLinkFieldId: fieldId,
          foreignTableLookupFieldId: lookupFieldId,
          dbForeignKeyName: field.options.dbForeignKeyName,
        };

        oldValue &&
          oldValue.forEach((oldValueItem) => {
            // add dbForeignKeyName to the record
            set(recordMapByTableId, [foreignTableId, oldValueItem.id, dbForeignKeyName], undefined);
            updateForeignKeyParams.push({
              ...paramCommon,
              recordId: oldValueItem.id,
              fRecordId: null,
            });
          });
        newValue &&
          newValue.forEach((newValueItem) => {
            // add dbForeignKeyName to the record
            set(recordMapByTableId, [foreignTableId, newValueItem.id, dbForeignKeyName], undefined);
            updateForeignKeyParams.push({
              ...paramCommon,
              recordId: newValueItem.id,
              fRecordId: recordId,
            });
          });
      }
    }
    return {
      recordMapByTableId,
      updateForeignKeyParams,
    };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async fillRecordMapByCellContexts(
    prisma: Prisma.TransactionClient,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: ITinyFieldMapByTableId,
    recordMapByTableId: IRecordMapByTableId
  ): Promise<IRecordMapByTableId> {
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

      const nativeSql = this.knex(tableId2DbTableName[tableId])
        .select(dbFieldNames.concat('__id'))
        .whereIn('__id', recordIds)
        .toSQL()
        .toNative();

      const recordRaw = await prisma.$queryRawUnsafe<{ [dbTableName: string]: unknown }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );

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
          // TODO: maybe lookup other type of field?
          if (field.type === FieldType.Link && cellValue != null) {
            cellValue = JSON.parse(cellValue as string);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recordLookupFieldsMap[recordId][fieldId] = (cellValue as any) ?? undefined;
        }
      }, {});
    }

    return recordMapByTableId;
  }

  private generateFkRecordMapByDbTableName(
    tableId2DbTableName: { [tableId: string]: string },
    fkFieldNameMap: { [fkFieldName: string]: Set<string> },
    updatedRecordMapByTableId: IRecordMapByTableId
  ) {
    const fkRecordMap: IFkOpMap = {};
    for (const tableId in updatedRecordMapByTableId) {
      if (!fkFieldNameMap[tableId]) {
        continue;
      }
      const fkFieldNames = Array.from(fkFieldNameMap[tableId]);
      for (const recordId in updatedRecordMapByTableId[tableId]) {
        const record = updatedRecordMapByTableId[tableId][recordId];
        fkFieldNames.forEach((fkFieldName) => {
          const value = record[fkFieldName] as string | null;

          set(fkRecordMap, [tableId2DbTableName[tableId], recordId, fkFieldName], value);
        });
      }
    }
    return fkRecordMap;
  }

  private async getTableId2DbTableName(prisma: Prisma.TransactionClient, tableIds: string[]) {
    const tableRaws = await prisma.tableMeta.findMany({
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

  private getFkFieldNameMap(updateForeignKeyParams: IUpdateForeignKeyParam[]) {
    return updateForeignKeyParams.reduce<{ [fkFieldName: string]: Set<string> }>((pre, cur) => {
      const { tableId, dbForeignKeyName } = cur;
      if (!pre[tableId]) {
        pre[tableId] = new Set();
      }
      pre[tableId].add(dbForeignKeyName);
      return pre;
    }, {});
  }

  private getDiffCellChangeByRecordMap(
    fkFieldNameMap: { [fkFieldName: string]: Set<string> },
    originRecordMapByTableId: IRecordMapByTableId,
    updatedRecordMapByTableId: IRecordMapByTableId
  ): ICellChange[] {
    const changes: ICellChange[] = [];

    for (const tableId in originRecordMapByTableId) {
      const originRecords = originRecordMapByTableId[tableId];
      const updatedRecords = updatedRecordMapByTableId[tableId];

      for (const recordId in originRecords) {
        const originFields = originRecords[recordId];
        const updatedFields = updatedRecords[recordId];

        for (const fieldId in originFields) {
          // ignore foreignKey field
          if (fkFieldNameMap[tableId]?.has(fieldId)) {
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

  private deepEqualIgnoreArrayOrder(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;

      const mapA: { [id: string]: { id: string; title?: string } } = {};
      for (const obj of a as { id: string; title?: string }[]) {
        mapA[obj.id] = obj;
      }

      for (const obj of b as { id: string; title?: string }[]) {
        const correspondingObjA = mapA[obj.id];
        if (!correspondingObjA || obj.title !== correspondingObjA.title) {
          return false;
        }
      }

      return true;
    }

    return isEqual(a, b);
  }

  private filterCellChangeByCellContexts(
    tableId: string,
    cellContexts: ICellContext[],
    cellChanges: ICellChange[]
  ): ICellChange[] {
    // Create a map for quick access to cell contexts by tableId, recordId and fieldId
    const cellContextMap: { [key: string]: ICellContext } = {};
    for (const context of cellContexts) {
      const key = `${tableId}-${context.recordId}-${context.fieldId}`;
      cellContextMap[key] = context;
    }

    return cellChanges.filter((change) => {
      const key = `${change.tableId}-${change.recordId}-${change.fieldId}`;
      const context = cellContextMap[key];

      // If cell context does not exist or its new value is not equal to the change's new value,
      // keep the change
      return !context || !this.deepEqualIgnoreArrayOrder(change.newValue, context.newValue);
    });
  }

  private async getDerivateByCellContexts(
    prisma: Prisma.TransactionClient,
    tableId: string,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: ITinyFieldMapByTableId,
    linkContexts: ILinkCellContext[]
  ): Promise<{ cellChanges: ICellChange[]; fkRecordMap: IFkOpMap }> {
    const { recordMapByTableId, updateForeignKeyParams } =
      this.getRecordMapStructAndForeignKeyParams(tableId, fieldMapByTableId, linkContexts);

    // console.log('recordMapByTableId:', recordMapByTableId);
    // console.log('updateForeignKeyParams:', updateForeignKeyParams);
    const originRecordMapByTableId = await this.fillRecordMapByCellContexts(
      prisma,
      tableId2DbTableName,
      fieldMapByTableId,
      recordMapByTableId
    );
    // console.log('originRecordMapByTableId:', JSON.stringify(originRecordMapByTableId, null, 2));

    const updatedRecordMapByTableId = this.updateForeignKeyInMemory(
      updateForeignKeyParams,
      recordMapByTableId
    );

    const fkFieldNameMap = this.getFkFieldNameMap(updateForeignKeyParams);
    const fkRecordMap = this.generateFkRecordMapByDbTableName(
      tableId2DbTableName,
      fkFieldNameMap,
      updatedRecordMapByTableId
    );

    // console.log('updatedRecordMapByTableId:', JSON.stringify(updatedRecordMapByTableId, null, 2));
    // console.log('fkRecordMap:', JSON.stringify(updatedRecordMapByTableId, null, 2));

    const originCellChanges = this.getDiffCellChangeByRecordMap(
      fkFieldNameMap,
      originRecordMapByTableId,
      updatedRecordMapByTableId
    );

    const cellChanges = this.filterCellChangeByCellContexts(
      tableId,
      linkContexts,
      originCellChanges
    );
    return {
      cellChanges,
      fkRecordMap,
    };
  }

  /**
   * v2.0 improved strategy
   * 0: define `main table` is where foreign key located in, `foreign table` is where foreign key referenced to
   * 1. generate foreign key changes, cache effected recordIds, both main table and foreign table
   * 2. update foreign key by changes and submit origin op
   * 3. check and generate op to update main table by cached recordIds
   * 4. check and generate op to update foreign table by cached recordIds
   *
   * v1.0 Strategy (deprecated)
   * 1. diff changes from context, merge all off changes by recordId
   * 2. generate new changes from merged changes
   * 3. update foreign key by changes
   */
  async getDerivateByLink(
    prisma: Prisma.TransactionClient,
    tableId: string,
    cellContexts: ICellContext[]
  ) {
    const linkContexts = this.filterLinkContext(cellContexts as ILinkCellContext[]);
    if (!linkContexts.length) {
      return null;
    }

    const fieldIds = linkContexts.map((ctx) => ctx.fieldId);
    const fieldMapByTableId = await this.getTinyFieldMapByTableId(prisma, fieldIds);
    const tableId2DbTableName = await this.getTableId2DbTableName(
      prisma,
      Object.keys(fieldMapByTableId)
    );

    return await this.getDerivateByCellContexts(
      prisma,
      tableId,
      tableId2DbTableName,
      fieldMapByTableId,
      linkContexts
    );
  }
}
