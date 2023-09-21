import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { RecordOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { groupBy, keyBy } from 'lodash';
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
  protected readonly knex = knex({ client: 'sqlite3' });
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
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

    return await this.prismaService
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
            __last_modified_by: userId,
            __version: d.version + 1,
          } as { [dbFieldName: string]: unknown },
        }))
        .map(
          (d) =>
            `('${d.recordId}', ${columnNames
              .map((name) => (d.updateParam[name] == null ? 'null' : `'${d.updateParam[name]}'`))
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
  private async executeInsertOps(tableId: string, opsData: IOpsData[]) {
    const userId = this.cls.get('user.id');
    const insertSql = `
        INSERT INTO ops ("collection", "doc_id", "version", "operation", "created_by")
        VALUES
        ${opsData
          .map(
            (d) =>
              `('${tableId}', '${d.recordId}', ${d.version + 1}, '${JSON.stringify(
                d.rawOp
              )}', '${userId}')`
          )
          .join(', ')}
      `;

    return await this.prismaService.txClient().$executeRawUnsafe(insertSql);
  }
}
