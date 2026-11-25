/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ISelectFieldOptions } from '@teable/core';
import { FieldType, generateRecordHistoryId } from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import type { RecordInitiator } from '@teable/v2-core';
import { isEqual, isObject, isString } from 'lodash';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { DataLoaderService } from '../../features/data-loader/data-loader.service';
import { rawField2FieldObj } from '../../features/field/model/factory';
import { DatabaseRouter } from '../../global/database-router.service';
import { EventEmitterService, RECORD_HISTORY_PERSIST } from '../event-emitter.service';
import type { IRecordHistoryPersistRequest } from '../event-emitter.service';
import { Events, RecordUpdateEvent } from '../events';

// eslint-disable-next-line @typescript-eslint/naming-convention
const SELECT_FIELD_TYPE_SET = new Set([FieldType.SingleSelect, FieldType.MultipleSelect]);

@Injectable()
export class RecordHistoryListener {
  constructor(
    private readonly databaseRouter: DatabaseRouter,
    private readonly eventEmitterService: EventEmitterService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    private readonly dataLoaderService: DataLoaderService
  ) {}

  @OnEvent(RECORD_HISTORY_PERSIST, { suppressErrors: false })
  async persistRecordUpdates({ event, execute }: IRecordHistoryPersistRequest): Promise<void> {
    await this.writeRecordHistory(event, execute);
  }

  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  async recordUpdateListener(event: RecordUpdateEvent) {
    if (this.baseConfig.recordHistoryDisabled) return;
    if (!event.context.recordHistoryPersisted) {
      await this.writeRecordHistory(event);
    }
    const records = Array.isArray(event.payload.record)
      ? event.payload.record
      : [event.payload.record];
    this.eventEmitterService.emit(Events.RECORD_HISTORY_CREATE, {
      recordIds: records.map((record) => record.id),
    });
  }

  private async writeRecordHistory(
    event: RecordUpdateEvent,
    execute?: (sql: string) => Promise<unknown>
  ): Promise<void> {
    if (this.baseConfig.recordHistoryDisabled) return;
    const { payload, context } = event;
    const { user } = context;
    const { tableId, oldField: _oldField } = payload;
    const userId = user?.id;
    const payloadRecord = payload.record;
    const records = !Array.isArray(payloadRecord) ? [payloadRecord] : payloadRecord;

    const fieldIdSet = new Set<string>();

    records.forEach((record) => {
      const { fields } = record;

      Object.keys(fields).forEach((fieldId) => {
        fieldIdSet.add(fieldId);
      });
    });

    const fieldIds = Array.from(fieldIdSet);

    const fields = await this.dataLoaderService.field.load(tableId, {
      id: fieldIds,
    });

    const fieldMap = new Map(fields.map((field) => [field.id, rawField2FieldObj(field)]));

    const batchSize = 200;
    const totalCount = records.length;
    // The column is timestamp without time zone: bind UTC text, not a driver-local Date.
    const occurredAt = event.occurredAt.toISOString();

    for (let i = 0; i < totalCount; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const recordHistoryList: {
        id: string;
        table_id: string;
        record_id: string;
        field_id: string;
        before: string;
        after: string;
        created_by: string;
        actor_type: RecordInitiator['type'] | null;
        actor_id: string | null;
        created_time: string;
      }[] = [];

      batch.forEach((record) => {
        const { id: recordId, fields } = record;
        Object.entries(fields).forEach(([fieldId, changeValue]) => {
          const field = fieldMap.get(fieldId);

          if (!field || !changeValue || !isObject(changeValue)) {
            return null;
          }

          if (!('oldValue' in changeValue) || !('newValue' in changeValue)) {
            return null;
          }

          const oldField = _oldField ?? field;
          const { type, name, cellValueType, isComputed } = field;
          const { oldValue, newValue } = changeValue;

          // Skip no-op changes to avoid duplicate history entries
          if (isEqual(oldValue, newValue)) {
            return null;
          }

          if (oldField.isComputed && isComputed) {
            return null;
          }

          recordHistoryList.push({
            id: generateRecordHistoryId(),
            table_id: tableId,
            record_id: recordId,
            field_id: fieldId,
            before: JSON.stringify({
              meta: {
                type: oldField.type,
                name: oldField.name,
                options: this.minimizeFieldOptions(oldValue, oldField),
                cellValueType: oldField.cellValueType,
              },
              data: oldValue,
            }),
            after: JSON.stringify({
              meta: {
                type,
                name,
                options: this.minimizeFieldOptions(newValue, field),
                cellValueType,
              },
              data: newValue,
            }),
            created_by: userId as string,
            actor_type: context.recordInitiator?.type ?? null,
            actor_id: context.recordInitiator?.id ?? null,
            created_time: occurredAt,
          });
        });
      });

      if (recordHistoryList.length) {
        const dataKnex = await this.databaseRouter.dataKnexForTable(tableId);
        const dataDbUrl = await this.databaseRouter.getDataDatabaseUrlForTable(tableId);
        const dataDbInternalSchema = new URL(dataDbUrl).searchParams.get('schema') || 'public';
        for (let offset = 0; offset < recordHistoryList.length; offset += batchSize) {
          const query = dataKnex
            .withSchema(dataDbInternalSchema)
            .insert(recordHistoryList.slice(offset, offset + batchSize))
            .into('record_history')
            .toQuery();
          if (execute) {
            await execute(query);
          } else {
            await this.databaseRouter.executeDataPrismaForTable(tableId, query);
          }
        }
      }
    }
  }

  private minimizeFieldOptions(
    value: unknown,
    field: Pick<Field, 'type'> & {
      options: Record<string, unknown> | null;
    }
  ) {
    const { type, options: _options } = field;

    if (SELECT_FIELD_TYPE_SET.has(type as FieldType)) {
      const options = _options as ISelectFieldOptions;
      const { choices } = options;

      if (value == null) {
        return { ...options, choices: [] };
      }

      if (isString(value)) {
        return { ...options, choices: choices.filter(({ name }) => name === value) };
      }

      if (Array.isArray(value)) {
        const valueSet = new Set(value);
        return { ...options, choices: choices.filter(({ name }) => valueSet.has(name)) };
      }
    }

    return _options;
  }
}
