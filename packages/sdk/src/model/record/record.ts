/* eslint-disable @typescript-eslint/naming-convention */
import type { IRecord } from '@teable/core';
import { RecordCore, FieldKeyType, RecordOpBuilder, FieldType } from '@teable/core';
import type {
  ICreateRecordsRo,
  IGetRecordsRo,
  IRecordInsertOrderRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import {
  createRecords,
  duplicateRecord,
  getRecords,
  updateRecord,
  updateRecordOrders,
  updateRecords,
} from '@teable/openapi';
import { isEqual } from 'lodash';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';
import type { IFieldInstance } from '../field/factory';

export class Record extends RecordCore {
  private _title?: {
    value?: string;
  };

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

  static updateRecords = requestWrap((tableId: string, recordsRo: IUpdateRecordsRo) =>
    updateRecords(tableId, recordsRo)
  );

  static duplicateRecord = requestWrap(
    (tableId: string, recordId: string, order: IRecordInsertOrderRo) =>
      duplicateRecord(tableId, recordId, order)
  );

  static updateRecordOrders = requestWrap(updateRecordOrders);

  constructor(
    protected doc: Doc<IRecord>,
    protected fieldMap: { [fieldId: string]: IFieldInstance }
  ) {
    super(fieldMap);
  }

  get title() {
    if (!this.fieldMap) {
      return undefined;
    }
    if (!this._title) {
      const primaryFieldId = Object.values(this.fieldMap).find((field) => field.isPrimary)?.id;
      const primaryField = primaryFieldId ? this.fieldMap[primaryFieldId] : undefined;
      if (!primaryFieldId || !primaryField) {
        return undefined;
      }
      this._title = {
        value: primaryField.cellValue2String(this.fields[primaryFieldId]),
      };
    }
    return this._title.value;
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
    const changeCellFieldIds = fieldIds.filter(
      (fieldId) => !isEqual(this.fields[fieldId], record.fields[fieldId])
    );
    if (!changeCellFieldIds.length) {
      return;
    }
    changeCellFieldIds.forEach((fieldId) => {
      this.doc.data.fields[fieldId] = record.fields[fieldId];
    });
    this.doc.emit('op batch', [], false);
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
            // you have to set null to clear the value
            [fieldId]: cellValue === undefined ? null : cellValue,
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
