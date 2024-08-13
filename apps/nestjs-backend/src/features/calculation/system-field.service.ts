/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable/core';
import { FieldType, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
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

  private async updateSystemField(
    dbTableName: string,
    recordIds: string[],
    userId: string,
    timeStr: string
  ) {
    const nativeQuery = this.knex(dbTableName)
      .update({
        __last_modified_time: timeStr,
        __last_modified_by: userId,
      })
      .whereIn('__id', recordIds)
      .toQuery();

    await this.prismaService.txClient().$executeRawUnsafe(nativeQuery);
  }

  private buildOpsByFields({
    fields,
    user,
    timeStr,
  }: {
    fields: IFieldInstance[];
    user: {
      id: string;
      name: string;
      email: string;
    };
    timeStr: string;
  }) {
    return fields
      .map((field) => {
        const { id, type } = field;
        if (type === FieldType.LastModifiedTime) {
          return RecordOpBuilder.editor.setRecord.build({
            fieldId: id,
            oldCellValue: null,
            newCellValue: timeStr,
          });
        }

        if (type === FieldType.LastModifiedBy) {
          return RecordOpBuilder.editor.setRecord.build({
            fieldId: id,
            oldCellValue: null,
            newCellValue: field.convertDBValue2CellValue({
              id: user.id,
              title: user.name,
              email: user.email,
            }),
          });
        }
      })
      .filter(Boolean) as IOtOperation[];
  }

  async getOpsMapBySystemField(opsMaps: IOpsMap) {
    const opsMap: IOpsMap = {};
    const tableIds = Object.keys(opsMaps);

    const user = this.cls.get('user');
    const timeStr = this.cls.get('tx.timeStr') ?? new Date().toISOString();

    const tableId2DbTableName = await this.getTableId2DbTableNameMap(tableIds);

    for (const tableId in opsMaps) {
      const tableOpsMap = opsMaps[tableId];
      const recordIds = Object.keys(tableOpsMap);

      await this.updateSystemField(tableId2DbTableName[tableId], recordIds, user.id, timeStr);

      const fieldsRaw = await this.prismaService.txClient().field.findMany({
        where: {
          tableId,
          deletedTime: null,
          type: { in: [FieldType.LastModifiedTime, FieldType.LastModifiedBy] },
        },
      });

      if (!fieldsRaw.length) continue;

      if (!opsMap[tableId]) opsMap[tableId] = {};

      for (const recordId in tableOpsMap) {
        if (!tableOpsMap[recordId]) continue;

        const ops = this.buildOpsByFields({
          fields: fieldsRaw.map(createFieldInstanceByRaw),
          user,
          timeStr,
        });

        opsMap[tableId][recordId] = ops;
      }
    }

    return opsMap;
  }
}
