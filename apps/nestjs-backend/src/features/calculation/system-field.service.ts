/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import type { LastModifiedTimeFieldCore } from '@teable/core';
import { FieldKeyType, TableDomain, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { Timing } from '../../utils/timing';
import { UserFieldDto } from '../field/model/field-dto/user-field.dto';

@Injectable()
export class SystemFieldService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async updateSystemField(
    dbTableName: string,
    recordIds: string[],
    userId: string,
    timeStr: string
  ) {
    if (!recordIds.length) return;

    const nativeQuery = this.knex(dbTableName)
      .update({
        __last_modified_time: timeStr,
        __last_modified_by: userId,
      })
      .whereIn('__id', recordIds)
      .toQuery();

    await this.prismaService.txClient().$executeRawUnsafe(nativeQuery);
  }

  @Timing()
  async getModifiedSystemOpsMap(
    table: TableDomain,
    fieldKeyType: FieldKeyType,
    records: {
      fields: Record<string, unknown>;
      id: string;
    }[]
  ): Promise<
    {
      fields: Record<string, unknown>;
      id: string;
    }[]
  > {
    const user = this.cls.get('user');
    const timeStr = this.cls.get('tx.timeStr') ?? new Date().toISOString();

    const dbTableName = table.dbTableName;
    const trackedLastModifiedColumnUpdates: Record<string, string[]> = {};

    await this.updateSystemField(
      dbTableName,
      records.map((r) => r.id),
      user.id,
      timeStr
    );

    const lastModifiedFields = table.getLastModifiedFields();

    if (!lastModifiedFields.length) return records;

    const fieldsMap = table.getFieldsMap(fieldKeyType);

    const updatedRecords = records.map((record) => {
      const changedFieldIds = new Set<string>();
      for (const key of Object.keys(record.fields ?? {})) {
        const changedField = fieldsMap.get(key);
        if (changedField) changedFieldIds.add(changedField.id);
      }

      const systemRecordFields = lastModifiedFields.reduce<{ [fieldId: string]: unknown }>(
        (pre, field) => {
          const type = field.type;
          if (type === FieldType.LastModifiedTime) {
            const lmtField = field as LastModifiedTimeFieldCore;
            const trackAll = lmtField.isTrackAll();
            const shouldUpdate = lmtField.shouldUpdate(changedFieldIds);
            if (shouldUpdate) {
              pre[field[fieldKeyType]] = timeStr;
              if (!trackAll) {
                const ids = trackedLastModifiedColumnUpdates[field.dbFieldName] || [];
                ids.push(record.id);
                trackedLastModifiedColumnUpdates[field.dbFieldName] = ids;
              }
            }
          }

          if (type === FieldType.LastModifiedBy) {
            pre[field[fieldKeyType]] = UserFieldDto.fullAvatarUrl({
              id: user.id,
              title: user.name,
              email: user.email,
            });
          }
          return pre;
        },
        {}
      );

      return {
        ...record,
        fields: {
          ...record.fields,
          ...systemRecordFields,
        },
      };
    });

    // Persist tracked Last Modified Time columns that are not generated
    for (const [columnName, recordIds] of Object.entries(trackedLastModifiedColumnUpdates)) {
      const nativeQuery = this.knex(dbTableName)
        .update({
          [columnName]: timeStr,
        })
        .whereIn('__id', recordIds)
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(nativeQuery);
    }

    return updatedRecords;
  }
}
