import { Injectable } from '@nestjs/common';
import type { ILookupOptionsVo, IOtOperation } from '@teable-group/core';
import { RecordOpBuilder, Relationship } from '@teable-group/core';
import { Prisma } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { keyBy, uniq, uniqBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import type { IRawOp, IRawOpMap } from '../../share-db/interface';
import { Timing } from '../../utils/timing';
import type { IFieldInstance } from '../field/model/factory';
import { dbType2knexFormat } from '../field/util';
import type { IFieldMap, IRecordRefItem, ITopoItem } from './reference.service';
import { IOpsMap, ReferenceService } from './reference.service';
import type { ICellChange } from './utils/changes';
import { formatChangesToOps, mergeDuplicateChange } from './utils/changes';

// eslint-disable-next-line @typescript-eslint/no-unused-vars

interface IOpsData {
  recordId: string;
  updateParam: {
    [dbFieldName: string]: unknown;
  };
  version: number;
  rawOp: IRawOp;
}

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
    @InjectModel() private readonly knex: Knex
  ) {}

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
    reset?: boolean
  ): Promise<IRawOpMap | undefined> {
    const result = reset
      ? await this.getChangedOpsMapByReset(prisma, tableId, fieldIds)
      : await this.getChangedOpsMap(prisma, tableId, fieldIds);

    if (!result) {
      return;
    }
    const { opsMap, fieldMap, tableId2DbTableName } = result;
    return await this.batchSave(prisma, src, opsMap, fieldMap, tableId2DbTableName);
  }

  async getTopoOrdersContext(
    prisma: Prisma.TransactionClient,
    fieldIds: string[]
  ): Promise<ITopoOrdersContext> {
    const undirectedGraph = await this.referenceService.getDependentNodesCTE(prisma, fieldIds);

    // get all related field by undirected graph
    const allFieldIds = uniq(this.referenceService.flatGraph(undirectedGraph).concat(fieldIds));

    // prepare all related data
    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.referenceService.createAuxiliaryData(prisma, allFieldIds);

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
      const items = await this.referenceService.getAffectedRecordItems(
        prisma,
        linkOrders,
        originItems
      );
      // nameConsole('fieldId:', { fieldId }, fieldMap);
      // nameConsole('affectedRecordItems:', items, fieldMap);
      affectedRecordItems = affectedRecordItems.concat(items);
      originRecordIdItems = originRecordIdItems.concat(originItems);
    }
    return { affectedRecordItems, originRecordIdItems };
  }

  async getRecordsBatchByFields(
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
        .concat(['__id']);
      const nativeSql = this.knex(dbTableName).select(dbFieldNames).toSQL().toNative();
      const result = await prisma.$queryRawUnsafe<{ [dbFieldName: string]: unknown }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );
      results[dbTableName] = result;
    }

    return this.referenceService.formatRecordQueryResult(results, dbTableName2fields);
  }

  @Timing()
  async getChangedOpsMapByReset(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldIds: string[]
  ) {
    if (!fieldIds.length) {
      return undefined;
    }

    const context = await this.getTopoOrdersContext(prisma, fieldIds);
    const {
      fieldMap,
      topoOrdersByFieldId,
      dbTableName2fields,
      tableId2DbTableName,
      fieldId2TableId,
    } = context;

    const dbTableName2records = await this.getRecordsBatchByFields(prisma, dbTableName2fields);

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
      prisma,
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
  async getChangedOpsMap(prisma: Prisma.TransactionClient, tableId: string, fieldIds: string[]) {
    if (!fieldIds.length) {
      return undefined;
    }

    const context = await this.getTopoOrdersContext(prisma, fieldIds);
    const { fieldMap, tableId2DbTableName } = context;
    const changes = await this.calculateChanges(prisma, tableId, context);
    if (!changes.length) {
      return;
    }

    const opsMap = formatChangesToOps(mergeDuplicateChange(changes));
    return { opsMap, fieldMap, tableId2DbTableName };
  }

  private async calculateChanges(
    prisma: Prisma.TransactionClient,
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
    const { affectedRecordItems, originRecordIdItems } = await this.getRecordItems(prisma, {
      tableId,
      fieldId2TableId,
      tableId2DbTableName,
      topoOrdersByFieldId,
      fieldMap,
    });

    const dependentRecordItems = await this.referenceService.getDependentRecordItems(
      prisma,
      affectedRecordItems
    );

    // nameConsole('topoOrdersByFieldId', topoOrdersByFieldId, fieldMap);
    // nameConsole('originRecordIdItems', originRecordIdItems, fieldMap);
    // nameConsole('affectedRecordItems', affectedRecordItems, fieldMap);
    // nameConsole('dependentRecordItems', dependentRecordItems, fieldMap);

    // record data source
    const dbTableName2records = await this.referenceService.getRecordsBatch(prisma, {
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

  @Timing()
  async batchSave(
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

    return prisma.$queryRawUnsafe<{ __version: number; __id: string }[]>(
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
    if (!opsData.length) {
      return;
    }

    const tempTableName = `${dbTableName}_temp`;
    const fieldIds = Array.from(new Set(opsData.flatMap((d) => Object.keys(d.updateParam))));
    const columnNames = fieldIds
      .map((id) => fieldMap[id].dbFieldName)
      .concat(['__version', '__last_modified_time', '__last_modified_by']);

    // 1.create temporary table structure
    const createTempTableSchema = this.knex.schema.createTable(tempTableName, (table) => {
      table.text('__id').primary();
      fieldIds.forEach((id) => {
        const { dbFieldName, dbFieldType } = fieldMap[id];
        const typeKey = dbType2knexFormat(dbFieldType);
        table[typeKey](dbFieldName);
      });
      table.integer('__version');
      table.dateTime('__last_modified_time');
      table.text('__last_modified_by');
    });

    const createTempTableSql = createTempTableSchema
      .toQuery()
      .replace('create table', 'create temporary table');
    await prisma.$executeRawUnsafe(createTempTableSql);

    // 2.initialize temporary table data
    const insertRowsData = opsData.map((data) => {
      return {
        __id: data.recordId,
        __version: data.version + 1,
        __last_modified_time: new Date().toISOString(),
        __last_modified_by: 'admin',
        ...Object.entries(data.updateParam).reduce<{ [dbFieldName: string]: unknown }>(
          (pre, [fieldId, value]) => {
            const field = fieldMap[fieldId];
            const { dbFieldName } = field;
            pre[dbFieldName] = field.convertCellValue2DBValue(value) ?? null;
            return pre;
          },
          {}
        ),
      };
    });
    const insertTempTableSql = this.knex.insert(insertRowsData).into(tempTableName).toQuery();
    await prisma.$executeRawUnsafe(insertTempTableSql);

    // 3.update data
    const updateColumns = columnNames.reduce<{ [key: string]: unknown }>((pre, columnName) => {
      pre[columnName] = this.knex.raw(`(select ?? from ?? where ?? = ??)`, [
        columnName,
        tempTableName,
        '__id',
        this.knex.ref(`${dbTableName}.__id`),
      ]);
      return pre;
    }, {});
    const updateSql = this.knex(dbTableName)
      .update(updateColumns)
      .whereExists(
        this.knex
          .select(this.knex.raw(1))
          .from(tempTableName)
          .where('__id', this.knex.ref(`${dbTableName}.__id`))
      )
      .toQuery();
    await prisma.$executeRawUnsafe(updateSql);

    // 4.delete temporary table
    const dropTempTableSql = this.knex.schema.dropTable(tempTableName).toQuery();
    await prisma.$executeRawUnsafe(dropTempTableSql);
  }

  @Timing()
  private async executeInsertOps(
    prisma: Prisma.TransactionClient,
    tableId: string,
    opsData: IOpsData[]
  ) {
    const insertRowsData = opsData.map((data) => {
      return {
        collection: tableId,
        doc_id: data.recordId,
        version: data.version + 1,
        operation: JSON.stringify(data.rawOp),
        created_by: 'admin',
      };
    });

    const insertTempTableSql = this.knex.insert(insertRowsData).into('ops').toQuery();
    return prisma.$executeRawUnsafe(insertTempTableSql);
  }
}
