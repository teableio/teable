import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ISelectFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Prisma, Field } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { isString } from 'lodash';
import { Events, RecordUpdateEvent } from '../events';

// eslint-disable-next-line @typescript-eslint/naming-convention
const SELECT_FIELD_TYPE_SET = new Set([FieldType.SingleSelect, FieldType.MultipleSelect]);

@Injectable()
export class RecordHistoryListener {
  constructor(private readonly prismaService: PrismaService) {}

  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  async recordUpdateListener(event: RecordUpdateEvent) {
    const { payload, context } = event;
    const { user } = context;
    const { tableId, oldField: _oldField } = payload;
    let records = payload.record;
    const userId = user?.id;

    if (!Array.isArray(records)) {
      records = [records];
    }

    const fieldIdSet = new Set<string>();

    records.forEach((record) => {
      const { fields } = record;

      Object.keys(fields).forEach((fieldId) => {
        fieldIdSet.add(fieldId);
      });
    });

    const fieldIds = Array.from(fieldIdSet);

    const applyFields = await this.prismaService.field.findMany({
      where: {
        id: { in: fieldIds },
      },
      select: {
        id: true,
        type: true,
        name: true,
        options: true,
        cellValueType: true,
        isComputed: true,
      },
    });
    const fields = applyFields.map(({ options, ...rest }) => ({
      ...rest,
      options: options ? JSON.parse(options) : options,
    }));

    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const recordHistoryList: Prisma.RecordHistoryCreateManyInput[] = [];

    records.forEach((record) => {
      const { id: recordId, fields } = record;

      Object.entries(fields).forEach(([fieldId, changeValue]) => {
        const field = fieldMap.get(fieldId);

        if (!field) return null;

        const oldField = _oldField ?? field;
        const { type, name, cellValueType, isComputed } = field;
        const { oldValue, newValue } = changeValue;

        if (oldField.isComputed && isComputed) {
          return null;
        }

        recordHistoryList.push({
          tableId,
          recordId,
          fieldId,
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
          createdBy: userId as string,
        });
      });
    });

    await this.prismaService.recordHistory.createMany({
      data: recordHistoryList,
    });
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
