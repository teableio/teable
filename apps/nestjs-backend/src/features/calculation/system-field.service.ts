/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import type { LastModifiedByFieldCore, LastModifiedTimeFieldCore } from '@teable/core';
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
    const auditUserValue =
      user &&
      UserFieldDto.fullAvatarUrl({
        id: user.id,
        title: user.name,
        email: user.email,
      });
    const cloneAuditUserValue = () => (auditUserValue ? { ...auditUserValue } : null);
    const sanitizeAuditUserValue = () => {
      const cloned = cloneAuditUserValue();
      if (cloned && typeof cloned === 'object' && 'avatarUrl' in cloned) {
        delete (cloned as { avatarUrl?: string }).avatarUrl;
      }
      return cloned;
    };

    const dbTableName = table.dbTableName;
    const trackedLastModifiedColumnUpdates: Record<string, string[]> = {};
    const trackedLastModifiedByColumnUpdates: Record<string, string[]> = {};

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
            const trackedIds = lmtField.getTrackedFieldIds();
            const validTrackedIds = trackedIds.filter((id) => table.hasField(id));
            const configTrackAll = lmtField.isTrackAll();
            const effectiveTrackAll = configTrackAll || validTrackedIds.length === 0;
            const shouldUpdate =
              effectiveTrackAll || validTrackedIds.some((id) => changedFieldIds.has(id));
            if (shouldUpdate) {
              pre[field[fieldKeyType]] = timeStr;
              // Persist column when not using generated/system value
              if (!configTrackAll) {
                const ids = trackedLastModifiedColumnUpdates[field.dbFieldName] || [];
                ids.push(record.id);
                trackedLastModifiedColumnUpdates[field.dbFieldName] = ids;
              }
            }
          }

          if (type === FieldType.LastModifiedBy) {
            const lmbField = field as LastModifiedByFieldCore;
            const trackedIds = lmbField.getTrackedFieldIds();
            const validTrackedIds = trackedIds.filter((id) => table.hasField(id));
            const configTrackAll = lmbField.isTrackAll();
            const effectiveTrackAll = configTrackAll || validTrackedIds.length === 0;
            const shouldUpdate =
              effectiveTrackAll || validTrackedIds.some((id) => changedFieldIds.has(id));
            if (shouldUpdate) {
              const value = sanitizeAuditUserValue();
              pre[field[fieldKeyType]] = value;
              // Persist column when not using system column
              if (!configTrackAll) {
                const ids = trackedLastModifiedByColumnUpdates[field.dbFieldName] || [];
                ids.push(record.id);
                trackedLastModifiedByColumnUpdates[field.dbFieldName] = ids;
              }
            }
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

    // Persist tracked Last Modified By columns that are not generated from the system column
    if (Object.keys(trackedLastModifiedByColumnUpdates).length) {
      const persistedUserValue = sanitizeAuditUserValue();
      const serializedUserValue = persistedUserValue ? JSON.stringify(persistedUserValue) : null;
      for (const [columnName, recordIds] of Object.entries(trackedLastModifiedByColumnUpdates)) {
        const nativeQuery = this.knex(dbTableName)
          .update({
            [columnName]: serializedUserValue,
          })
          .whereIn('__id', recordIds)
          .toQuery();
        await this.prismaService.txClient().$executeRawUnsafe(nativeQuery);
      }
    }

    return updatedRecords;
  }
}
