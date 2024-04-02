/* eslint-disable @typescript-eslint/naming-convention */
import type { IRecord } from '@teable/core';
import { RecordOpBuilder, RecordCore } from '@teable/core';
import {
  createRecords,
  getRecords,
  updateRecord,
  updateRecordOrders,
  updateRecordWithOrder,
} from '@teable/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';
import type { IFieldInstance } from '../field/factory';

export class Record extends RecordCore {
  static createRecords = requestWrap(createRecords);

  static getRecords = requestWrap(getRecords);

  static updateRecord = requestWrap(updateRecord);

  static updateRecordOrders = requestWrap(updateRecordOrders);

  static updateRecordWithOrder = requestWrap(updateRecordWithOrder);

  constructor(
    protected doc: Doc<IRecord>,
    protected fieldMap: { [fieldId: string]: IFieldInstance }
  ) {
    super(fieldMap);
  }

  async updateCell(fieldId: string, cellValue: unknown) {
    const operation = RecordOpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: cellValue,
      oldCellValue: this.fields[fieldId],
    });

    try {
      return await new Promise((resolve, reject) => {
        this.doc.submitOp([operation], undefined, (error) => {
          error ? reject(error) : resolve(undefined);
        });
      });
    } catch (error) {
      return error;
    }
  }
}
