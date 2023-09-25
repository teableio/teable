import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { RecordOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { groupBy, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IRawOp, IRawOpMap } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { Timing } from '../../utils/timing';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { dbType2knexFormat } from '../field/util';
import { IOpsMap } from './reference.service';

interface IOpsData {
  recordId: string;
  updateParam: {
    [dbFieldName: string]: unknown;
  };
  version: number;
  rawOp: IRawOp;
}

@Injectable()
export class BatchService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectModel() private readonly knex: Knex
  ) {}

  private async completeMissingCtx(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance },
    tableId2DbTableName: { [tableId: string]: string }
  ) {
    const tableIds = Object.keys(opsMap);
    const missingTableIds = tableIds.filter((id) => !tableId2DbTableName[id]);
    if (!missingTableIds.length) {
      return { tableId2DbTableName, fieldMap };
    }

    const missingFieldIds = Array.from(
      missingTableIds.reduce<Set<string>>((pre, id) => {
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

    const tableRaw = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: missingTableIds }, deletedTime: null },
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
  async save(
    src: string,
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance },
    tableId2DbTableName: { [tableId: string]: string }
  ) {
    const rawOpMap: IRawOpMap = {};
    const result = await this.completeMissingCtx(opsMap, fieldMap, tableId2DbTableName);
    fieldMap = result.fieldMap;
    tableId2DbTableName = result.tableId2DbTableName;

    for (const tableId in opsMap) {
      const dbTableName = tableId2DbTableName[tableId];
      const recordOpsMap = opsMap[tableId];
      const raw = await this.fetchRawData(dbTableName, recordOpsMap);
      const versionGroup = keyBy(raw, '__id');

      const opsData = this.buildOpsData(src, recordOpsMap, versionGroup);
      rawOpMap[tableId] = opsData.reduce<{ [recordId: string]: IRawOp }>((pre, d) => {
        pre[d.recordId] = d.rawOp;
        return pre;
      }, {});
      await this.executeUpdateRecords(dbTableName, fieldMap, opsData);
      await this.executeInsertOps(tableId, opsData);
    }
    return rawOpMap;
  }

  @Timing()
  private async fetchRawData(
    dbTableName: string,
    recordOpsMap: { [recordId: string]: IOtOperation[] }
  ) {
    const recordIds = Object.keys(recordOpsMap);
    const nativeSql = this.knex(dbTableName)
      .whereIn('__id', recordIds)
      .select('__id', '__version')
      .toSQL()
      .toNative();

    return this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __version: number; __id: string }[]>(nativeSql.sql, ...nativeSql.bindings);
  }

  @Timing()
  private buildOpsData(
    src: string,
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
      const rawOp: IRawOp = {
        src,
        seq: 1,
        op: recordOpsMap[recordId],
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
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsData: IOpsData[]
  ) {
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
    const tempTableName = `${dbTableName}_temp`;
    const fieldIds = Array.from(new Set(opsData.flatMap((d) => Object.keys(d.updateParam))));
    const columnNames = fieldIds
      .map((id) => fieldMap[id].dbFieldName)
      .concat(['__version', '__last_modified_time', '__last_modified_by']);

    // 1.create temporary table structure
    const createTempTableSchema = this.knex.schema.createTable(tempTableName, (table) => {
      table.string('__id').primary();
      fieldIds.forEach((id) => {
        const { dbFieldName, dbFieldType } = fieldMap[id];
        const typeKey = dbType2knexFormat(dbFieldType);
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

    // 2.initialize temporary table data
    const insertRowsData = opsData.map((data) => {
      return {
        __id: data.recordId,
        __version: data.version + 1,
        __last_modified_time: new Date().toISOString(),
        __last_modified_by: userId,
        ...Object.entries(data.updateParam).reduce<{ [dbFieldName: string]: unknown }>(
          (pre, [fieldId, value]) => {
            const field = fieldMap[fieldId];
            const { dbFieldName } = field;
            pre[dbFieldName] = field.convertCellValue2DBValue(value);
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
  private async executeInsertOps(tableId: string, opsData: IOpsData[]) {
    const userId = this.cls.get('user.id');
    const insertRowsData = opsData.map((data) => {
      return {
        collection: tableId,
        doc_id: data.recordId,
        version: data.version + 1,
        operation: JSON.stringify(data.rawOp),
        created_by: userId,
      };
    });

    const insertTempTableSql = this.knex.insert(insertRowsData).into('ops').toQuery();
    return this.prismaService.txClient().$executeRawUnsafe(insertTempTableSql);
  }
}
