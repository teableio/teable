import { Injectable } from '@nestjs/common';
import type {
  FieldType,
  IOtOperation,
  ISetRecordOpContext,
  LinkFieldOptions,
} from '@teable-group/core';
import { OpBuilder, Relationship, IdPrefix } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { difference, groupBy } from 'lodash';
import { ReferenceService } from './reference.service';
import type { ICellChange } from './reference.service';

export interface ITinyLinkField {
  id: string;
  tableId: string;
  type: FieldType;
  dbFieldName: string;
  options: LinkFieldOptions;
}

export interface ICellMutation {
  [tableId: string]: {
    [recordId: string]: {
      [fieldId: string]: {
        add: string[];
        del: string[];
      };
    };
  };
}

export interface IRecordMapByTableId {
  [tableId: string]: {
    [recordId: string]: {
      [fieldId: string]:
        | { id: string; title?: string }[]
        | { id: string; title?: string }
        | undefined;
    };
  };
}

export interface IRecordTitleMapByTableId {
  [tableId: string]: {
    [recordId: string]: {
      [fieldId: string]: string | undefined;
    };
  };
}

export interface ITinyFieldMapByTableId {
  [tableId: string]: {
    [fieldId: string]: ITinyLinkField;
  };
}

export interface ICellContext {
  id: string;
  fieldId: string;
  newValue?: { id: string }[] | { id: string };
  oldValue?: { id: string }[] | { id: string };
}

export interface IOpsMap {
  [tableId: string]: {
    [recordId: string]: IOtOperation[];
  };
}

export interface IApplyParam {
  tableId: string;
  recordId: string;
  opContexts: ISetRecordOpContext[];
}

@Injectable()
export class LinkService {
  constructor(private readonly referenceService: ReferenceService) {}
  private readonly knex = knex({ client: 'sqlite3' });

  // for performance, we should detect if record contains link by cellValue
  private isLinkCell(value: unknown): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function isLinkCellItem(item: any): boolean {
      if (typeof item !== 'object' || item == null) {
        return false;
      }

      if ('id' in item && typeof item.id === 'string') {
        const recordId: string = item.id;
        return recordId.startsWith(IdPrefix.Record);
      }
      return false;
    }

    if (Array.isArray(value) && isLinkCellItem(value[0])) {
      return true;
    }
    return isLinkCellItem(value);
  }

  private filterLinkContext(contexts: ICellContext[]) {
    return contexts.filter((ctx) => {
      if (this.isLinkCell(ctx.newValue)) {
        return true;
      }

      return this.isLinkCell(ctx.oldValue);
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
   * test case
   *
   * case 1 Add Link Record From ManyOne link Field
   * TableA: ManyOne-LinkB A1.null -> A1.B1
   * { TableB: { B1: { 'OneMany-LinkA': add: [A1] }} }
   * TableB: OneMany-LinkA B1.null -> B1.push(A1)
   *
   * case 2 Change Link Record From ManyOne link Field
   * TableA: ManyOne-LinkB A1.B1 -> A1.B2
   * TableB: OneMany-LinkA B1.(Old) -> B1.pop(A1) | B2.(Old) -> B2.push(A1)
   *
   * case 3 Add Link Record From OneMany link Field
   * TableA: OneMany-linkB A1.(old) -> A1.push(B1)
   * TableB: ManyOne-LinkA B1.null -> B2.A1
   *
   * case 4 Change Link Record From OneMany link Field
   * TableA: OneMany-linkB A1.(old) -> A1.[B1]
   * TableB: ManyOne-LinkA B1.null -> B2.A1
   *
   */
  private getCellMutation(
    tableId: string,
    fieldMapByTableId: ITinyFieldMapByTableId,
    contexts: ICellContext[]
  ): ICellMutation {
    function polishValue(value?: { id: string }[] | { id: string }): string[] {
      if (Array.isArray(value)) {
        return value.map((item) => item.id);
      }
      if (value) {
        return [value.id];
      }
      return [];
    }
    return contexts.reduce<ICellMutation>((acc, ctx) => {
      const { id: recordId, fieldId, oldValue, newValue } = ctx;
      const oldIds = polishValue(oldValue);
      const newIds = polishValue(newValue);
      const toAdd = difference(newIds, oldIds);
      const toDel = difference(oldIds, newIds);
      const { foreignTableId, symmetricFieldId } = fieldMapByTableId[tableId][fieldId].options;

      if (!acc[foreignTableId]) {
        acc[foreignTableId] = {};
      }

      const prepare = (targetRecordId: string) => {
        if (!acc[foreignTableId][targetRecordId]) {
          acc[foreignTableId][targetRecordId] = {};
        }
        if (!acc[foreignTableId][targetRecordId][symmetricFieldId]) {
          acc[foreignTableId][targetRecordId][symmetricFieldId] = {
            add: [],
            del: [],
          };
        }
        return acc[foreignTableId][targetRecordId][symmetricFieldId];
      };

      for (const addRecordId of toAdd) {
        prepare(addRecordId).add.push(recordId);
      }
      for (const deleteRecordId of toDel) {
        prepare(deleteRecordId).del.push(recordId);
      }

      return acc;
    }, {});
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private getCellChangeByMutation(
    cellMutation: ICellMutation,
    recordMapByTableId: IRecordMapByTableId,
    recordTitleMapByTableId: IRecordTitleMapByTableId,
    fieldMapByTableId: ITinyFieldMapByTableId
  ): ICellChange[] {
    const changes: ICellChange[] = [];
    for (const tableId in cellMutation) {
      for (const recordId in cellMutation[tableId]) {
        for (const fieldId in cellMutation[tableId][recordId]) {
          const { add, del } = cellMutation[tableId][recordId][fieldId];
          const oldValue = recordMapByTableId[tableId][recordId][fieldId];
          const field = fieldMapByTableId[tableId][fieldId];
          if (field.options.relationship === Relationship.ManyOne) {
            if (oldValue && !('id' in oldValue)) {
              throw new Error("ManyOne relationship's old value should be a single record");
            }

            if (add.length > 1 || del.length > 1) {
              throw new Error('ManyOne relationship should not have multiple records');
            }

            if (del.length && del[0] !== oldValue?.id) {
              throw new Error("ManyOne relationship's old value should be equal to delete value");
            }
            const id = add[0];
            const title =
              id &&
              recordTitleMapByTableId[field.options.foreignTableId][id][
                field.options.lookupFieldId
              ];
            changes.push({
              tableId,
              recordId,
              fieldId,
              oldValue,
              newValue: id ? { id, title } : undefined,
            });
            continue;
          }

          let newValue: { id: string }[] = [];
          if (oldValue) {
            newValue = (oldValue as { id: string }[]).filter((item) => !del.includes(item.id));
          }
          newValue.push(
            ...add.map((id) => {
              const title =
                recordTitleMapByTableId[field.options.foreignTableId][id][
                  field.options.lookupFieldId
                ];
              return { id, title };
            })
          );

          changes.push({
            tableId,
            recordId,
            fieldId,
            oldValue,
            newValue: newValue.length ? newValue : undefined,
          });
        }
      }
    }
    return changes;
  }

  private async getRecordMapByMutation(
    prisma: Prisma.TransactionClient,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: ITinyFieldMapByTableId,
    cellMutation: ICellMutation
  ): Promise<IRecordMapByTableId> {
    const recordMapByTableId: IRecordMapByTableId = {};
    for (const tableId in cellMutation) {
      const recordIds = Object.keys(cellMutation[tableId]);
      const fieldIds = Array.from(
        Object.values(cellMutation[tableId]).reduce<Set<string>>((pre, cur) => {
          for (const fieldId in cur) {
            pre.add(fieldId);
          }
          return pre;
        }, new Set())
      );

      const dbFieldName2FieldId: { [dbFieldName: string]: string } = {};
      const dbFieldNames = fieldIds.map((fieldId) => {
        const field = fieldMapByTableId[tableId][fieldId];
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

      recordMapByTableId[tableId] = recordRaw.reduce<{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [recordId: string]: { [fieldId: string]: any };
      }>((acc, cur) => {
        const recordId = cur.__id as string;
        delete cur.__id;
        acc[recordId] = {};
        for (const dbFieldName in cur) {
          const fieldId = dbFieldName2FieldId[dbFieldName];
          const cellValue = cur[dbFieldName];
          acc[recordId][fieldId] = cellValue && JSON.parse(cellValue as string);
        }
        return acc;
      }, {});
    }

    return recordMapByTableId;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private getRecordMapByTableIdByMutation(
    fieldMapByTableId: ITinyFieldMapByTableId,
    cellMutation: ICellMutation
  ) {
    const recordMapByTableId: IRecordTitleMapByTableId = {};
    for (const tableId in cellMutation) {
      const mutations = Object.values(cellMutation[tableId]);
      const fieldMap = fieldMapByTableId[tableId];
      for (const mutation of mutations) {
        for (const fieldId in mutation) {
          const field = fieldMap[fieldId];
          const targetTableId = field.options.foreignTableId;
          const lookupFieldId = field.options.lookupFieldId;
          const add = mutation[fieldId].add;
          if (!recordMapByTableId[targetTableId]) {
            recordMapByTableId[targetTableId] = {};
          }
          for (const recordId of add) {
            if (!recordMapByTableId[targetTableId][recordId]) {
              recordMapByTableId[targetTableId][recordId] = {};
            }
            recordMapByTableId[targetTableId][recordId][lookupFieldId] = undefined;
          }
        }
      }
    }
    return recordMapByTableId;
  }

  private async getRecordTitleByMutation(
    prisma: Prisma.TransactionClient,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: ITinyFieldMapByTableId,
    cellMutation: ICellMutation
  ): Promise<{
    [tableId: string]: {
      [recordId: string]: {
        [fieldId: string]: string | undefined;
      };
    };
  }> {
    const recordMapByTableId = this.getRecordMapByTableIdByMutation(
      fieldMapByTableId,
      cellMutation
    );

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
          const cellValue = record[dbFieldName];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recordLookupFieldsMap[recordId][fieldId] = (cellValue as any) ?? undefined;
        }
      }, {});
    }

    return recordMapByTableId;
  }

  // update foreignKey by ManyOne relationship field value changes
  private async updateForeignKey(
    prisma: Prisma.TransactionClient,
    tableId: string,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: ITinyFieldMapByTableId,
    contexts: ICellContext[],
    changes: ICellChange[]
  ) {
    const combinedChanges = contexts
      .map((ctx) => ({
        tableId: tableId,
        recordId: ctx.id,
        fieldId: ctx.fieldId,
        newValue: ctx.newValue as unknown,
      }))
      .concat(changes);
    for (const change of combinedChanges) {
      const { tableId, recordId, fieldId, newValue } = change;
      const dbTableName = tableId2DbTableName[tableId];
      const field = fieldMapByTableId[tableId][fieldId];
      const dbForeignKeyName = field.options.dbForeignKeyName;
      if (field.options.relationship !== Relationship.ManyOne) {
        continue;
      }

      const nativeSql = this.knex(dbTableName)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ [dbForeignKeyName]: newValue ? (newValue as any).id : null })
        .where('__id', recordId)
        .toSQL()
        .toNative();

      await prisma.$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
    }
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

  /**
   * 1. diff changes from context, merge all off changes by recordId
   * 2. generate new changes from merged changes
   * 3. update foreign key by changes
   */
  async getDerivateChangesByLink(
    prisma: Prisma.TransactionClient,
    tableId: string,
    contexts: ICellContext[]
  ): Promise<ICellChange[]> {
    const linkContext = this.filterLinkContext(contexts);
    if (!linkContext.length) {
      return [];
    }

    const fieldIds = linkContext.map((ctx) => ctx.fieldId);
    const fieldMapByTableId = await this.getTinyFieldMapByTableId(prisma, fieldIds);
    const cellMutation = this.getCellMutation(tableId, fieldMapByTableId, linkContext);
    const tableId2DbTableName = await this.getTableId2DbTableName(
      prisma,
      Object.keys(fieldMapByTableId)
    );

    const recordMapByTableId = await this.getRecordMapByMutation(
      prisma,
      tableId2DbTableName,
      fieldMapByTableId,
      cellMutation
    );

    const recordTitleMapByTableId = await this.getRecordTitleByMutation(
      prisma,
      tableId2DbTableName,
      fieldMapByTableId,
      cellMutation
    );

    const cellChange = this.getCellChangeByMutation(
      cellMutation,
      recordMapByTableId,
      recordTitleMapByTableId,
      fieldMapByTableId
    );

    if (cellChange.length) {
      await this.updateForeignKey(
        prisma,
        tableId,
        tableId2DbTableName,
        fieldMapByTableId,
        contexts,
        cellChange
      );
    }

    return cellChange;
  }

  async calculate(prisma: Prisma.TransactionClient, param: IApplyParam) {
    const { tableId, recordId } = param;

    const recordData = param.opContexts.map((ctx) => {
      return {
        id: recordId,
        fieldId: ctx.fieldId,
        newValue: ctx.newValue,
        oldValue: ctx.oldValue,
      };
    });

    const derivateChangesByLink = await this.getDerivateChangesByLink(
      prisma,
      tableId,
      recordData as ICellContext[]
    );

    const derivateChangesMap = groupBy(derivateChangesByLink, 'tableId');
    const recordDataByLink = derivateChangesMap[tableId]
      ? derivateChangesMap[tableId].map(({ recordId, fieldId, newValue, oldValue }) => ({
          id: recordId,
          fieldId,
          newValue,
          oldValue,
        }))
      : [];

    delete derivateChangesMap[tableId];

    // recordData should concat link change in current table
    let derivateChanges = await this.referenceService.calculate(
      prisma,
      tableId,
      recordData.concat(recordDataByLink)
    );

    derivateChanges = derivateChanges.concat(derivateChangesByLink);

    for (const tableId in derivateChangesMap) {
      const recordData = derivateChangesMap[tableId].map(
        ({ recordId, fieldId, newValue, oldValue }) => ({
          id: recordId,
          fieldId,
          newValue,
          oldValue,
        })
      );
      const changes = await this.referenceService.calculate(prisma, tableId, recordData);
      derivateChanges = derivateChanges.concat(changes);
    }

    if (!derivateChanges.length) {
      return;
    }

    return this.formatOpsByChanges(tableId, recordId, derivateChanges);
  }

  private changeToOp(change: ICellChange) {
    const { fieldId, oldValue, newValue } = change;
    return OpBuilder.editor.setRecord.build({
      fieldId,
      oldCellValue: oldValue,
      newCellValue: newValue,
    });
  }

  private formatOpsByChanges(tableId: string, recordId: string, changes: ICellChange[]) {
    const currentSnapshotOps: IOtOperation[] = [];
    const otherSnapshotOps = changes.reduce<{
      [tableId: string]: { [recordId: string]: IOtOperation[] };
    }>((pre, cur) => {
      const { tableId: curTableId, recordId: curRecordId } = cur;
      const op = this.changeToOp(cur);

      if (curTableId === tableId && curRecordId === recordId) {
        currentSnapshotOps.push(op);
        return pre;
      }

      if (!pre[curTableId]) {
        pre[curTableId] = {};
      }
      if (!pre[curTableId][curRecordId]) {
        pre[curTableId][curRecordId] = [];
      }
      pre[curTableId][curRecordId].push(op);

      return pre;
    }, {});

    return {
      currentSnapshotOps,
      otherSnapshotOps: Object.keys(otherSnapshotOps).length ? otherSnapshotOps : undefined,
    };
  }

  composeOpsMaps(opsMaps: IOpsMap[]): IOpsMap {
    return opsMaps.reduce((composedMap, currentMap) => {
      for (const tableId in currentMap) {
        if (composedMap[tableId]) {
          for (const recordId in currentMap[tableId]) {
            if (composedMap[tableId][recordId]) {
              composedMap[tableId][recordId] = composedMap[tableId][recordId].concat(
                currentMap[tableId][recordId]
              );
            } else {
              composedMap[tableId][recordId] = currentMap[tableId][recordId];
            }
          }
        } else {
          composedMap[tableId] = currentMap[tableId];
        }
      }
      return composedMap;
    }, {});
  }
}
