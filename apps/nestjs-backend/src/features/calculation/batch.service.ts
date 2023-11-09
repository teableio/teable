import { Inject, Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { IdPrefix, RecordOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { groupBy, isEmpty, keyBy, merge } from 'lodash';
import { customAlphabet } from 'nanoid';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IRawOp, IRawOpMap } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { Timing } from '../../utils/timing';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { dbType2knexFormat } from '../field/util';
import { IOpsMap } from './reference.service';

export interface IOpsData {
  recordId: string;
  updateParam: {
    [dbFieldName: string]: unknown;
  };
  version: number;
}

@Injectable()
export class BatchService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @Inject('DbProvider') private dbProvider: IDbProvider
  ) {}

  private async completeMissingCtx(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance },
    tableId2DbTableName: { [tableId: string]: string }
  ) {
    const tableIds = Object.keys(opsMap);

    const missingFieldIds = Array.from(
      tableIds.reduce<Set<string>>((pre, id) => {
        Object.values(opsMap[id]).forEach((ops) =>
          ops.forEach((op) => {
            const fieldId = RecordOpBuilder.editor.setRecord.detect(op)?.fieldId;
            if (fieldId) {
              pre.add(fieldId);
            }
          })
        );
        return pre;
      }, new Set())
    );

    if (!missingFieldIds.length) {
      return { fieldMap, tableId2DbTableName };
    }

    const tableRaw = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: tableIds }, deletedTime: null },
      select: { id: true, dbTableName: true },
    });

    const fieldsRaw = await this.prismaService.txClient().field.findMany({
      where: { id: { in: missingFieldIds }, deletedTime: null },
    });

    const fields = fieldsRaw.map(createFieldInstanceByRaw);

    const extraFieldsMap = keyBy(fields, 'id');

    const extraTableId2DbTableName = tableRaw.reduce<{ [tableId: string]: string }>(
      (pre, { id, dbTableName }) => {
        pre[id] = dbTableName;
        return pre;
      },
      {}
    );

    return {
      tableId2DbTableName: { ...tableId2DbTableName, ...extraTableId2DbTableName },
      fieldMap: { ...fieldMap, ...extraFieldsMap },
    };
  }

  @Timing()
  async updateRecords(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance },
    tableId2DbTableName: { [tableId: string]: string }
  ) {
    const result = await this.completeMissingCtx(opsMap, fieldMap, tableId2DbTableName);
    fieldMap = result.fieldMap;
    tableId2DbTableName = result.tableId2DbTableName;

    for (const tableId in opsMap) {
      const dbTableName = tableId2DbTableName[tableId];
      const recordOpsMap = opsMap[tableId];
      if (isEmpty(recordOpsMap)) {
        continue;
      }

      const raw = await this.fetchRawData(dbTableName, recordOpsMap);
      const versionGroup = keyBy(raw, '__id');

      const opsData = this.buildRecordOpsData(recordOpsMap, versionGroup);
      if (!opsData.length) continue;

      await this.executeUpdateRecords(dbTableName, fieldMap, opsData);

      const opDataList = Object.entries(recordOpsMap).map(([recordId, ops]) => {
        return { docId: recordId, version: versionGroup[recordId].__version, data: ops };
      });
      await this.saveRawOps(tableId, RawOpType.Edit, IdPrefix.Record, opDataList);
    }
  }

  @Timing()
  private async fetchRawData(
    dbTableName: string,
    recordOpsMap: { [recordId: string]: IOtOperation[] }
  ) {
    const recordIds = Object.keys(recordOpsMap);
    const querySql = this.knex(dbTableName)
      .whereIn('__id', recordIds)
      .select('__id', '__version')
      .toQuery();

    return this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __version: number; __id: string }[]>(querySql);
  }

  @Timing()
  private buildRecordOpsData(
    recordOpsMap: { [recordId: string]: IOtOperation[] },
    versionGroup: { [recordId: string]: { __version: number; __id: string } }
  ) {
    const opsData: IOpsData[] = [];

    for (const recordId in recordOpsMap) {
      const updateParam = recordOpsMap[recordId].reduce<{ [fieldId: string]: unknown }>(
        (pre, op) => {
          const opContext = RecordOpBuilder.editor.setRecord.detect(op);
          if (!opContext) {
            throw new Error(`illegal op ${JSON.stringify(op)} found`);
          }
          pre[opContext.fieldId] = opContext.newValue;
          return pre;
        },
        {}
      );

      const version = versionGroup[recordId].__version;

      opsData.push({
        recordId,
        version,
        updateParam,
      });
    }

    return opsData;
  }

  @Timing()
  private async executeUpdateRecords(
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsData: IOpsData[]
  ) {
    if (!opsData.length) return;

    const opsDataGroup = groupBy(opsData, (d) => {
      return Object.keys(d.updateParam).join();
    });

    // group by fieldIds before apply
    for (const groupKey in opsDataGroup) {
      await this.executeUpdateRecordsInner(dbTableName, fieldMap, opsDataGroup[groupKey]);
    }
  }

  private async executeUpdateRecordsInner(
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsData: IOpsData[]
  ) {
    if (!opsData.length) {
      return;
    }

    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    const tempTableName = `temp_` + customAlphabet('abcdefghijklmnopqrstuvwxyz', 10)();
    const fieldIds = Array.from(new Set(opsData.flatMap((d) => Object.keys(d.updateParam))));
    const columnNames = fieldIds
      .map((id) => fieldMap[id].dbFieldName)
      .concat(['__version', '__last_modified_time', '__last_modified_by']);

    // 1.create temporary table structure
    const createTempTableSchema = this.knex.schema.createTable(tempTableName, (table) => {
      table.string('__id').primary();
      fieldIds.forEach((id) => {
        const { dbFieldName, dbFieldType } = fieldMap[id];
        const typeKey = dbType2knexFormat(this.knex, dbFieldType);
        table[typeKey](dbFieldName);
      });
      table.integer('__version');
      table.dateTime('__last_modified_time');
      table.string('__last_modified_by');
    });

    const createTempTableSql = createTempTableSchema
      .toQuery()
      .replace('create table', 'create temporary table');
    await prisma.$executeRawUnsafe(createTempTableSql);

    const { insertTempTableSql, updateRecordSql } = this.dbProvider.executeUpdateRecordsSqlList({
      dbTableName,
      fieldMap,
      opsData,
      tempTableName,
      columnNames,
      userId,
    });

    // 2.initialize temporary table data
    await prisma.$executeRawUnsafe(insertTempTableSql);

    // 3.update data
    await prisma.$executeRawUnsafe(updateRecordSql);

    // 4.delete temporary table
    const dropTempTableSql = this.knex.schema.dropTable(tempTableName).toQuery();
    await prisma.$executeRawUnsafe(dropTempTableSql);
  }

  @Timing()
  async saveRawOps(
    collectionId: string,
    opType: RawOpType,
    docType: IdPrefix,
    dataList: { docId: string; version: number; data?: unknown }[]
  ) {
    const collection = `${docType}_${collectionId}`;
    const rawOpMap: IRawOpMap = { [collection]: {} };

    const baseRaw = {
      src: this.cls.get('tx.id') || 'unknown',
      seq: 1,
      m: {
        ts: Date.now(),
      },
    };

    const rawOps = dataList.map(({ docId: docId, version, data }) => {
      let rawOp: IRawOp;
      if (opType === RawOpType.Create) {
        rawOp = {
          ...baseRaw,
          create: {
            type: 'http://sharejs.org/types/JSONv0',
            data,
          },
          v: version,
        };
      } else if (opType === RawOpType.Del) {
        rawOp = {
          ...baseRaw,
          del: true,
          v: version,
        };
      } else if (opType === RawOpType.Edit) {
        rawOp = {
          ...baseRaw,
          op: data as IOtOperation[],
          v: version,
        };
      } else {
        throw new Error('unknown raw op type');
      }
      rawOpMap[collection][docId] = rawOp;
      return { rawOp, docId };
    });

    await this.executeInsertOps(collectionId, docType, rawOps);
    const prevMap = this.cls.get('tx.rawOpMap') || {};
    this.cls.set('tx.rawOpMap', merge({}, prevMap, rawOpMap));
    return rawOpMap;
  }

  private async executeInsertOps(
    collectionId: string,
    docType: IdPrefix,
    rawOps: { rawOp: IRawOp; docId: string }[]
  ) {
    const userId = this.cls.get('user.id');
    const insertRowsData = rawOps.map(({ rawOp, docId }) => {
      return {
        collection: collectionId,
        doc_type: docType,
        doc_id: docId,
        version: rawOp.v,
        operation: JSON.stringify(rawOp),
        created_by: userId,
        created_time: new Date().toISOString(),
      };
    });

    const batchInsertOpsSql = this.dbProvider.batchInsertSql('ops', insertRowsData);
    return this.prismaService.txClient().$executeRawUnsafe(batchInsertOpsSql);
  }
}
