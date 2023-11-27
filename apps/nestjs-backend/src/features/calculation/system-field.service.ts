/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { FieldType, RecordOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IOpsMap } from './reference.service';

@Injectable()
export class SystemFieldService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getTableId2DbTableNameMap(tableIds: string[]) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { id: true, dbTableName: true },
    });

    return tableMeta.reduce<{ [tableId: string]: string }>((pre, t) => {
      pre[t.id] = t.dbTableName;
      return pre;
    }, {});
  }

  private async getRecordId2ModifiedDataMap(dbTableName: string, recordIds: string[]) {
    const nativeQuery = this.knex(dbTableName)
      .select('__id', '__last_modified_time', '__last_modified_by')
      .whereIn('__id', recordIds)
      .toQuery();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string; __last_modified_time: Date; __last_modified_by: string }[]>(
        nativeQuery
      );

    return result.reduce<{
      [recordId: string]: { lastModifiedTime: string; lastModifiedBy: string };
    }>((pre, r) => {
      pre[r.__id] = {
        lastModifiedTime: r.__last_modified_time?.toISOString(),
        lastModifiedBy: r.__last_modified_by,
      };
      return pre;
    }, {});
  }

  private buildOpsByFields({
    fields,
    modifiedData,
    userId,
    timeStr,
  }: {
    fields: { id: string; type: FieldType }[];
    modifiedData: { lastModifiedTime: string; lastModifiedBy: string };
    userId: string;
    timeStr: string;
  }) {
    return fields
      .map(({ id: fieldId, type }) => {
        const { lastModifiedTime, lastModifiedBy } = modifiedData;

        if (type === FieldType.LastModifiedTime) {
          return RecordOpBuilder.editor.setRecord.build({
            fieldId,
            oldCellValue: lastModifiedTime,
            newCellValue: timeStr,
          });
        }

        if (type === FieldType.LastModifiedBy && lastModifiedBy !== userId) {
          return RecordOpBuilder.editor.setRecord.build({
            fieldId,
            oldCellValue: lastModifiedBy,
            newCellValue: userId,
          });
        }
      })
      .filter(Boolean) as IOtOperation[];
  }

  async getOpsMapBySystemField(opsMaps: IOpsMap) {
    const opsMap: IOpsMap = {};
    const tableIds = Object.keys(opsMaps);

    const userId = this.cls.get('user.id');
    const timeStr = this.cls.get('tx.timeStr') ?? new Date().toISOString();

    const tableId2DbTableName = await this.getTableId2DbTableNameMap(tableIds);

    for (const tableId in opsMaps) {
      const tableOpsMap = opsMaps[tableId];
      const recordIds = Object.keys(tableOpsMap);

      const tinyFields = await this.prismaService.txClient().field.findMany({
        select: { id: true, type: true },
        where: {
          tableId,
          deletedTime: null,
          type: { in: [FieldType.LastModifiedTime, FieldType.LastModifiedBy] },
        },
      });

      if (!tinyFields.length) continue;

      const recordId2ModifiedDataMap = await this.getRecordId2ModifiedDataMap(
        tableId2DbTableName[tableId],
        recordIds
      );

      if (!opsMap[tableId]) opsMap[tableId] = {};

      for (const recordId in tableOpsMap) {
        if (!tableOpsMap[recordId]) continue;

        const ops = this.buildOpsByFields({
          fields: tinyFields as { id: string; type: FieldType }[],
          modifiedData: recordId2ModifiedDataMap[recordId],
          userId,
          timeStr,
        });

        opsMap[tableId][recordId] = ops;
      }
    }

    return opsMap;
  }
}
