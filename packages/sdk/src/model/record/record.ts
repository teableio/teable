/* eslint-disable @typescript-eslint/naming-convention */
import type { IRecord } from '@teable/core';
import { RecordCore, FieldKeyType, RecordOpBuilder } from '@teable/core';
import { createRecords, getRecords, updateRecord, updateRecordOrders } from '@teable/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';
import type { IFieldInstance } from '../field/factory';

export class Record extends RecordCore {
  static createRecords = requestWrap(createRecords);

  static getRecords = requestWrap(getRecords);

  static updateRecord = requestWrap(updateRecord);

  static updateRecordOrders = requestWrap(updateRecordOrders);

  constructor(
    protected doc: Doc<IRecord>,
    protected fieldMap: { [fieldId: string]: IFieldInstance }
  ) {
    super(fieldMap);
  }

  private onCommitLocal(fieldId: string, cellValue: unknown) {
    const oldCellValue = this.fields[fieldId];
    const operation = RecordOpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: cellValue,
      oldCellValue,
    });
    this.doc.data.fields[fieldId] = cellValue;
    this.doc.emit('op', [operation], false, '');
    this.fields[fieldId] = cellValue;
  }

  async updateCell(fieldId: string, cellValue: unknown) {
    const oldCellValue = this.fields[fieldId];
    try {
      this.onCommitLocal(fieldId, cellValue);
      this.fields[fieldId] = cellValue;
      const [, tableId] = this.doc.collection.split('_');
      await Record.updateRecord(tableId, this.doc.id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [fieldId]: cellValue,
          },
        },
      });
    } catch (error) {
      this.onCommitLocal(fieldId, oldCellValue);
      return error;
    }
  }
}
