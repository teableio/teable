/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import type { IOtOperation } from '@teable/core';
import { IdPrefix, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { groupBy, isEmpty, keyBy } from 'lodash';
import { customAlphabet } from 'nanoid';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { bufferCount, concatMap, from, lastValueFrom } from 'rxjs';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IRawOp, IRawOpMap } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { Timing } from '../../utils/timing';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { dbType2knexFormat, SchemaType } from '../field/util';
import { IOpsMap } from './utils/compose-maps';

export interface IOpsData {
  recordId: string;
  updateParam: {
    [dbFieldName: string]: unknown;
  };
  version: number;
}

@Injectable()
export class BatchService {
  private logger = new Logger(BatchService.name);
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private async completeMissingCtx(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance } = {},
    tableId2DbTableName: { [tableId: string]: string } = {}
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

  private async updateRecordsTask(
    tableId: string,
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsPair: [recordId: string, IOtOperation[]][]
  ) {
    const raw = await this.fetchRawData(
      dbTableName,
      opsPair.map(([recordId]) => recordId)
    );
    const versionGroup = keyBy(raw, '__id');

    const opsData = this.buildRecordOpsData(opsPair, versionGroup);
    if (!opsData.length) return;

    await this.executeUpdateRecords(dbTableName, fieldMap, opsData);

    const opDataList = opsPair.map(([recordId, ops]) => {
      return { docId: recordId, version: versionGroup[recordId].__version, data: ops };
    });

    await this.saveRawOps(tableId, RawOpType.Edit, IdPrefix.Record, opDataList);
  }

  @Timing()
  async updateRecords(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance } = {},
    tableId2DbTableName: { [tableId: string]: string } = {}
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
      const opsPair = Object.entries(recordOpsMap);

      const taskFunction = async (opp: [recordId: string, IOtOperation[]][]) =>
        this.updateRecordsTask(tableId, dbTableName, fieldMap, opp);

      await lastValueFrom(
        from(opsPair).pipe(
          bufferCount(this.thresholdConfig.calcChunkSize),
          concatMap((opsPair) => from(taskFunction(opsPair)))
        )
      );
    }
  }

  // @Timing()
  private async fetchRawData(dbTableName: string, recordIds: string[]) {
    const querySql = this.knex(dbTableName)
      .whereIn('__id', recordIds)
      .select('__id', '__version', '__last_modified_time', '__last_modified_by')
      .toQuery();

    return this.prismaService.txClient().$queryRawUnsafe<
      {
        __version: number;
        __id: string;
      }[]
    >(querySql);
  }

  private buildRecordOpsData(
    opsPair: [recordId: string, IOtOperation[]][],
    versionGroup: {
      [recordId: string]: {
        __version: number;
        __id: string;
      };
    }
  ) {
    const opsData: IOpsData[] = [];

    for (const [recordId, ops] of opsPair) {
      const updateParam = ops.reduce<{ [fieldId: string]: unknown }>((pre, op) => {
        const opContext = RecordOpBuilder.editor.setRecord.detect(op);
        if (!opContext) {
          throw new Error(`illegal op ${JSON.stringify(op)} found`);
        }
        pre[opContext.fieldId] = opContext.newCellValue;
        return pre;
      }, {});

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

  async batchUpdateDB(
    dbTableName: string,
    idFieldName: string,
    schemas: { schemaType: SchemaType; dbFieldName: string }[],
    data: { id: string; values: { [key: string]: unknown } }[]
  ) {
    const tempTableName = `temp_` + customAlphabet('abcdefghijklmnopqrstuvwxyz', 10)();
    const prisma = this.prismaService.txClient();

    // 1.create temporary table structure
    const createTempTableSchema = this.knex.schema.createTable(tempTableName, (table) => {
      table.string(idFieldName).primary();
      schemas.forEach(({ dbFieldName, schemaType }) => {
        table[schemaType](dbFieldName);
      });
    });

    const createTempTableSql = createTempTableSchema
      .toQuery()
      .replace('create table', 'create temporary table');
    await prisma.$executeRawUnsafe(createTempTableSql);

    const { insertTempTableSql, updateRecordSql } = this.dbProvider.executeUpdateRecordsSqlList({
      dbTableName,
      tempTableName,
      idFieldName,
      dbFieldNames: schemas.map((s) => s.dbFieldName),
      data,
    });

    // 2.initialize temporary table data
    await prisma.$executeRawUnsafe(insertTempTableSql);

    // 3.update data
    await prisma.$executeRawUnsafe(updateRecordSql);

    // 4.delete temporary table
    const dropTempTableSql = this.knex.schema.dropTable(tempTableName).toQuery();
    await prisma.$executeRawUnsafe(dropTempTableSql);
  }

  private async executeUpdateRecordsInner(
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsData: IOpsData[]
  ) {
    if (!opsData.length) {
      return;
    }

    const fieldIds = Array.from(new Set(opsData.flatMap((d) => Object.keys(d.updateParam)))).filter(
      (id) => fieldMap[id]
    );
    const data = opsData.map((data) => {
      const { recordId, updateParam, version } = data;

      return {
        id: recordId,
        values: {
          ...Object.entries(updateParam).reduce<{ [dbFieldName: string]: unknown }>(
            (pre, [fieldId, value]) => {
              const field = fieldMap[fieldId];
              if (!field) {
                return pre;
              }
              const { dbFieldName } = field;
              pre[dbFieldName] = field.convertCellValue2DBValue(value);
              return pre;
            },
            {}
          ),
          __version: version + 1,
        },
      };
    });

    const schemas = [
      ...fieldIds.map((id) => {
        const { dbFieldName, dbFieldType } = fieldMap[id];
        return { dbFieldName, schemaType: dbType2knexFormat(this.knex, dbFieldType) };
      }),
      { dbFieldName: '__version', schemaType: SchemaType.Integer },
    ];

    await this.batchUpdateDB(dbTableName, '__id', schemas, data);
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
      src: this.cls.getId() || 'unknown',
      seq: 1,
      m: {
        ts: Date.now(),
      },
    };

    this.logger.verbose(`saveOp: ${baseRaw.src}-${collection}`);

    const rawOps = dataList.map(({ docId: docId, version, data }) => {
      let rawOp: IRawOp;
      if (opType === RawOpType.Create) {
        rawOp = {
          ...baseRaw,
          create: {
            type: 'json0',
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
    const prevMap = this.cls.get('tx.rawOpMaps') || [];
    prevMap.push(rawOpMap);
    this.cls.set('tx.rawOpMaps', prevMap);
    return rawOpMap;
  }

  private async executeInsertOps(
    collectionId: string,
    docType: IdPrefix,
    rawOps: { rawOp: IRawOp; docId: string }[]
  ) {
    const userId = this.cls.get('user.id');
    const insertRowsData = rawOps
      .filter(({ rawOp }) => !('del' in rawOp && rawOp.del))
      .map(({ rawOp, docId }) => {
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

    // delete history op when doc is deleted
    const deleteIds = rawOps
      .filter(({ rawOp }) => 'del' in rawOp && rawOp.del)
      .map(({ docId }) => docId);

    if (deleteIds.length) {
      const deleteOpsSql = this.knex('ops')
        .where('collection', collectionId)
        .whereIn('doc_id', deleteIds)
        .delete()
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(deleteOpsSql);
    }

    if (insertRowsData.length) {
      const batchInsertOpsSql = this.dbProvider.batchInsertSql('ops', insertRowsData);
      await this.prismaService.txClient().$executeRawUnsafe(batchInsertOpsSql);
    }
  }
}
