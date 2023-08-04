/* eslint-disable no-inner-declarations */
import { Injectable } from '@nestjs/common';
import type { ILookupOptionsVo, IOtOperation } from '@teable-group/core';
import { RecordOpBuilder, Relationship } from '@teable-group/core';
import { Prisma } from '@teable-group/db-main-prisma';
import { keyBy, uniq, uniqBy } from 'lodash';
import { Timing } from '../../utils/timing';
import { preservedFieldName } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { dbType2knexFormat } from '../field/util';
import type { ICellChange, IFieldMap, IRecordRefItem, ITopoItem } from './reference.service';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ReferenceService, nameConsole, IOpsMap } from './reference.service';
import { composeMaps } from './utils/compose-maps';

export interface IRawOp {
  src: string;
  seq: number;
  op: IOtOperation[];
  v: number;
  m: {
    ts: number;
  };
  c?: string;
  d?: string;
}

interface IOpsData {
  recordId: string;
  updateParam: {
    [dbFieldName: string]: unknown;
  };
  version: number;
  rawOp: IRawOp;
}

export interface IRawOpMap {
  [tableId: string]: {
    [recordId: string]: IRawOp;
  };
}

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

  @Timing()
  async calculateFields(
    prisma: Prisma.TransactionClient,
    src: string,
    tableId: string,
    fieldIds: string[],
    toDeleteFieldIds?: string[]
  ): Promise<IRawOpMap | undefined> {
    const resetResult =
      toDeleteFieldIds && (await this.getChangedOpsMapByReset(prisma, tableId, toDeleteFieldIds));
    const calculateResult = await this.getChangedOpsMap(
      prisma,
      tableId,
      fieldIds,
      toDeleteFieldIds
    );

    console.log({ fieldIds, toDeleteFieldIds });
    console.log({ resetResult, calculateResult });

    if (!resetResult && !calculateResult) {
      return;
    }
    const opsMap = composeMaps([resetResult?.opsMap, calculateResult?.opsMap]);
    const fieldMap = Object.assign({}, resetResult?.fieldMap, calculateResult?.fieldMap);
    const tableId2DbTableName = Object.assign(
      {},
      resetResult?.tableId2DbTableName,
      calculateResult?.tableId2DbTableName
    );
    return await this.batchSave(prisma, src, opsMap, fieldMap, tableId2DbTableName);
  }

  private async prepareContexts(prisma: Prisma.TransactionClient, fieldIds: string[]) {
    const undirectedGraph = await this.getDependentNodesCTE(prisma, fieldIds);

    // get all related field by undirected graph
    const allFieldIds = uniq(this.flatGraph(undirectedGraph).concat(fieldIds));

    // prepare all related data
    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.createAuxiliaryData(prisma, allFieldIds);

    // topological sorting
    const topoOrdersByFieldId = this.getTopoOrdersByFieldId(fieldIds, fieldMap, undirectedGraph);
    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);

    return {
      fieldMap,
      topoOrdersByFieldId,
      tableId2DbTableName,
      dbTableName2fields,
      fieldId2TableId,
    };
  }

  private async getRecordItems(
    prisma: Prisma.TransactionClient,
    params: {
      tableId: string;
      fieldId2TableId: { [fieldId: string]: string };
      tableId2DbTableName: { [tableId: string]: string };
      topoOrdersByFieldId: { [fieldId: string]: ITopoItem[] };
      fieldMap: IFieldMap;
    }
  ) {
    const { tableId, fieldId2TableId, tableId2DbTableName, topoOrdersByFieldId, fieldMap } = params;
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

      console.log('getOriginComputedRecords', originItems);

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
    return { affectedRecordItems, originRecordIdItems };
  }

  private async getRecordsBatchByFieldId(
    prisma: Prisma.TransactionClient,
    dbTableName2fields: { [dbTableName: string]: IFieldInstance[] }
  ) {
    const results: {
      [dbTableName: string]: { [dbFieldName: string]: unknown }[];
    } = {};
    for (const dbTableName in dbTableName2fields) {
      // deduplication is needed
      const dbFieldNames = dbTableName2fields[dbTableName]
        .map((f) => f.dbFieldName)
        .concat([...preservedFieldName]);
      const nativeSql = this.knex(dbTableName).select(dbFieldNames).toSQL().toNative();
      const result = await prisma.$queryRawUnsafe<{ [dbFieldName: string]: unknown }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );
      results[dbTableName] = result;
    }

    return this.formatRecordQueryResult(results, dbTableName2fields);
  }

  @Timing()
  async getChangedOpsMapByReset(
    prisma: Prisma.TransactionClient,
    _tableId: string,
    fieldIds: string[]
  ) {
    if (!fieldIds.length) {
      return undefined;
    }

    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.createAuxiliaryData(prisma, fieldIds);

    const dbTableName2records = await this.getRecordsBatchByFieldId(prisma, dbTableName2fields);

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

    const opsMap = this.formatChangesToOps(changes);
    return { opsMap, fieldMap, tableId2DbTableName };
  }

  @Timing()
  async getChangedOpsMap(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldIds: string[],
    resetFieldIds?: string[]
  ) {
    if (!fieldIds.length) {
      return undefined;
    }

    const {
      fieldMap,
      topoOrdersByFieldId,
      dbTableName2fields,
      tableId2DbTableName,
      fieldId2TableId,
    } = await this.prepareContexts(prisma, fieldIds);

    const { affectedRecordItems, originRecordIdItems } = await this.getRecordItems(prisma, {
      tableId,
      fieldId2TableId,
      tableId2DbTableName,
      topoOrdersByFieldId,
      fieldMap,
    });

    const dependentRecordItems = await this.getDependentRecordItems(prisma, affectedRecordItems);

    // TODO: find out why those is empty
    nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);
    nameConsole('originRecordIdItems', originRecordIdItems, fieldMap);
    nameConsole('affectedRecordItems', affectedRecordItems, fieldMap);
    nameConsole('dependentRecordItems', dependentRecordItems, fieldMap);

    // record data source
    const dbTableName2records = await this.getRecordsBatch(prisma, {
      originRecordItems: originRecordIdItems,
      affectedRecordItems,
      dependentRecordItems,
      dbTableName2fields,
    });
    nameConsole('dbTableName2records', dbTableName2records, fieldMap);

    if (resetFieldIds) {
      Object.values(dbTableName2records).forEach((records) => {
        records.forEach((record) => {
          resetFieldIds.forEach((fieldId) => {
            console.log('clean:', record.fields[fieldId]);
            record.fields[fieldId] = null;
          });
        });
      });
    }
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

    if (!changes.length) {
      return;
    }

    const opsMap = this.formatChangesToOps(this.mergeDuplicateChange(changes));
    return { opsMap, fieldMap, tableId2DbTableName };
  }

  @Timing()
  private async batchSave(
    prisma: Prisma.TransactionClient,
    src: string,
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance },
    tableId2DbTableName: { [tableId: string]: string }
  ) {
    const rawOpMap: IRawOpMap = {};
    for (const tableId in opsMap) {
      const dbTableName = tableId2DbTableName[tableId];
      const raw = await this.fetchRawData(prisma, dbTableName, opsMap[tableId]);
      const versionGroup = keyBy(raw, '__id');

      const opsData = this.buildOpsData(src, opsMap[tableId], versionGroup);
      rawOpMap[tableId] = opsData.reduce<{ [recordId: string]: IRawOp }>((pre, d) => {
        pre[d.recordId] = d.rawOp;
        return pre;
      }, {});
      await this.executeUpdateRecords(prisma, dbTableName, fieldMap, opsData);
      await this.executeInsertOps(prisma, tableId, opsData);
    }
    return rawOpMap;
  }

  @Timing()
  private async fetchRawData(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    ops: { [recordId: string]: IOtOperation[] }
  ) {
    const recordIds = Object.keys(ops);
    const nativeSql = this.knex(dbTableName)
      .whereIn('__id', recordIds)
      .select('__id', '__version')
      .toSQL()
      .toNative();

    return await prisma.$queryRawUnsafe<{ __version: number; __id: string }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );
  }

  @Timing()
  private buildOpsData(
    src: string,
    ops: { [recordId: string]: IOtOperation[] },
    versionGroup: { [recordId: string]: { __version: number; __id: string } }
  ) {
    const opsData: IOpsData[] = [];

    for (const recordId in ops) {
      const updateParam = ops[recordId].reduce<{ [fieldId: string]: unknown }>((pre, op) => {
        const opContext = RecordOpBuilder.editor.setRecord.detect(op);
        if (!opContext) {
          throw new Error(`illegal op ${JSON.stringify(op)} found`);
        }
        pre[opContext.fieldId] = opContext.newValue;
        return pre;
      }, {});

      const version = versionGroup[recordId].__version;
      const rawOp: IRawOp = {
        src,
        seq: 1,
        op: ops[recordId],
        v: version,
        m: {
          ts: Date.now(),
        },
      };

      opsData.push({
        recordId,
        version,
        rawOp,
        updateParam,
      });
    }

    return opsData;
  }

  @Timing()
  private async executeUpdateRecords(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsData: IOpsData[]
  ) {
    const tempTableName = `${dbTableName}_temp`;
    const fieldIds = Array.from(new Set(opsData.flatMap((d) => Object.keys(d.updateParam))));
    const columnNames = fieldIds
      .map((id) => fieldMap[id].dbFieldName)
      .concat(['__version', '__last_modified_time', '__last_modified_by']);

    const createTempTableSql = `
      CREATE TEMPORARY TABLE ${tempTableName} (
        __id TEXT PRIMARY KEY,
        ${fieldIds
          .map((id) => `${fieldMap[id].dbFieldName} ${dbType2knexFormat(fieldMap[id].dbFieldType)}`)
          .concat([`__version INTEGER`, `__last_modified_time DATETIME`, `__last_modified_by TEXT`])
          .join(', ')}
      )
    `;
    await prisma.$executeRawUnsafe(createTempTableSql);

    const insertTempTableSql = `
      INSERT INTO ${tempTableName} (__id, ${columnNames.join(', ')})
      VALUES
      ${opsData
        .map((d) => ({
          ...d,
          updateParam: {
            ...Object.entries(d.updateParam).reduce<{ [dbFieldName: string]: unknown }>(
              (pre, [fieldId, value]) => {
                const field = fieldMap[fieldId];
                const dbFieldName = field.dbFieldName;
                const cellValue = field.convertCellValue2DBValue(value);
                pre[dbFieldName] = cellValue;
                return pre;
              },
              {}
            ),
            __last_modified_time: new Date().toISOString(),
            __last_modified_by: 'admin',
            __version: d.version + 1,
          } as { [dbFieldName: string]: unknown },
        }))
        .map(
          (d) =>
            `('${d.recordId}', ${columnNames
              .map((name) => (d.updateParam[name] ? `'${d.updateParam[name]}'` : 'null'))
              .join(', ')})`
        )
        .join(', ')}
    `;

    await prisma.$executeRawUnsafe(insertTempTableSql);

    const updateSql = `
      UPDATE ${dbTableName}
      SET ${columnNames
        .map(
          (name) =>
            `${name} = (SELECT ${name} FROM ${tempTableName} WHERE __id = ${dbTableName}.__id)`
        )
        .join(', ')}
      WHERE EXISTS (SELECT 1 FROM ${tempTableName} WHERE __id = ${dbTableName}.__id)
    `;
    await prisma.$executeRawUnsafe(updateSql);

    const dropTempTableSql = `DROP TABLE ${tempTableName}`;
    await prisma.$executeRawUnsafe(dropTempTableSql);
  }

  @Timing()
  private async executeInsertOps(
    prisma: Prisma.TransactionClient,
    tableId: string,
    opsData: IOpsData[]
  ) {
    const insertSql = `
        INSERT INTO ops ("collection", "doc_id", "version", "operation", "created_by")
        VALUES
        ${opsData
          .map(
            (d) =>
              `('${tableId}', '${d.recordId}', ${d.version + 1}, '${JSON.stringify(
                d.rawOp
              )}', 'admin')`
          )
          .join(', ')}
      `;

    return await prisma.$executeRawUnsafe(insertSql);
  }
}
