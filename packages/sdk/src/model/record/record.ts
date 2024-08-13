/* eslint-disable @typescript-eslint/naming-convention */
import type { IRecord } from '@teable/core';
import { RecordCore, FieldKeyType, RecordOpBuilder, FieldType } from '@teable/core';
import type { ICreateRecordsRo, IGetRecordsRo, IUpdateRecordRo } from '@teable/openapi';
import { createRecords, getRecords, updateRecord, updateRecordOrders } from '@teable/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';
import type { IFieldInstance } from '../field/factory';

export class Record extends RecordCore {
  static createRecords = requestWrap((tableId: string, recordsRo: ICreateRecordsRo) =>
    createRecords(tableId, recordsRo)
  );

  static getRecords = requestWrap((tableId: string, query?: IGetRecordsRo) =>
    getRecords(tableId, query)
  );

  static updateRecord = requestWrap(
    (tableId: string, recordId: string, recordRo: IUpdateRecordRo) =>
      updateRecord(tableId, recordId, recordRo)
  );

  static updateRecordOrders = requestWrap(updateRecordOrders);

  constructor(
    protected doc: Doc<IRecord>,
    protected fieldMap: { [fieldId: string]: IFieldInstance }
  ) {
    super(fieldMap);
  }

  private onCommitLocal(fieldId: string, cellValue: unknown, undo?: boolean) {
    const oldCellValue = this.fields[fieldId];
    const operation = RecordOpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: cellValue,
      oldCellValue,
    });
    this.doc.data.fields[fieldId] = cellValue;
    this.doc.emit('op batch', [operation], false);
    if (this.doc.version) {
      undo ? this.doc.version-- : this.doc.version++;
    }
    this.fields[fieldId] = cellValue;
  }

  private updateComputedField = async (fieldIds: string[], record: IRecord) => {
    const operations = fieldIds
      .filter(
        (fieldId) =>
          JSON.stringify(record.fields[fieldId]) !== JSON.stringify(this.doc.data.fields[fieldId])
      )
      .map((fieldId) => {
        const operation = RecordOpBuilder.editor.setRecord.build({
          fieldId,
          newCellValue: record.fields[fieldId],
          oldCellValue: this.doc.data.fields[fieldId],
        });
        this.doc.data.fields[fieldId] = record.fields[fieldId];
        return operation;
      });
    this.doc.emit('op batch', operations, false);
  };

  async updateCell(fieldId: string, cellValue: unknown) {
    const oldCellValue = this.fields[fieldId];
    try {
      this.onCommitLocal(fieldId, cellValue);
      this.fields[fieldId] = cellValue;
      const [, tableId] = this.doc.collection.split('_');
      const res = await Record.updateRecord(tableId, this.doc.id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [fieldId]: cellValue,
          },
        },
      });
      const computedField = Object.keys(this.fieldMap).filter(
        (fieldId) =>
          this.fieldMap[fieldId].type === FieldType.Link || this.fieldMap[fieldId].isComputed
      );
      if (computedField.length) {
        this.updateComputedField(computedField, res.data);
      }
    } catch (error) {
      this.onCommitLocal(fieldId, oldCellValue, true);
      return error;
    }
  }
}
