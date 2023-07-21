import type {
  ICreateRecordsRo,
  IJsonApiSuccessResponse,
  IRecord,
  IGetRecordsQuery,
  IRecordsVo,
  IUpdateRecordByIndexRo,
} from '@teable-group/core';
import { RecordOpBuilder, RecordCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import axios from 'axios';
import type { IFieldInstance } from '../field/factory';
export class Record extends RecordCore {
  static async createRecords(tableId: string, recordRo: ICreateRecordsRo) {
    const response = await axios.post<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/record`,
      recordRo
    );
    return response.data.data;
  }

  static async getRecords(tableId: string, recordsRo: IGetRecordsQuery) {
    const response = await axios.get<IJsonApiSuccessResponse<IRecordsVo>>(
      `/api/table/${tableId}/record`,
      {
        params: recordsRo,
      }
    );
    return response.data.data;
  }

  static async updateRecordByIndex(tableId: string, recordRo: IUpdateRecordByIndexRo) {
    const response = await axios.put<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/record`,
      recordRo
    );
    return response.data.data;
  }

  constructor(
    protected doc: Doc<IRecord>,
    protected fieldMap: { [fieldId: string]: IFieldInstance }
  ) {
    super(fieldMap);
  }

  async clearCell(fieldId: string) {
    const operation = RecordOpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: null,
      oldCellValue: this.fields[fieldId],
    });

    return new Promise((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateCell(fieldId: string, cellValue: unknown) {
    const operation = RecordOpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: cellValue,
      oldCellValue: this.fields[fieldId],
    });

    return new Promise((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
