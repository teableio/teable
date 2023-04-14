import type {
  IRecordFields,
  IRecordSnapshot,
  IFieldRo,
  IFieldVo,
  IJsonApiSuccessResponse,
  ITableSnapshot,
  IViewSnapshot,
  IViewVo,
  ViewType,
  ICreateRecordsRo,
  IRecord,
} from '@teable-group/core';
import {
  generateRecordId,
  generateViewId,
  IdPrefix,
  OpBuilder,
  TableCore,
} from '@teable-group/core';
import type { Connection, Doc } from '@teable/sharedb/lib/client';
import axios from 'axios';

export class Table extends TableCore {
  static async updateRecord({
    tableId,
    viewId,
    index,
    fieldName,
    value,
  }: {
    tableId: string;
    viewId: string;
    index: number;
    fieldName: string;
    value: unknown;
  }) {
    const response = await axios.put<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/record`,
      {
        viewId,
        index,
        record: {
          fields: {
            [fieldName]: value,
          },
        },
      }
    );
    return response.data.data;
  }

  static async createField(params: IFieldRo & { tableId: string }) {
    const { tableId, ...fieldRo } = params;
    const response = await axios.post<IJsonApiSuccessResponse<IFieldVo>>(
      `/api/table/${tableId}/field`,
      fieldRo
    );
    return response.data.data;
  }

  static async getFields(tableId: string, viewId: string) {
    const response = await axios.get<IJsonApiSuccessResponse<IFieldVo[]>>(
      `/api/table/${tableId}/field`,
      {
        params: {
          viewId,
        },
      }
    );
    return response.data.data;
  }

  static async createRecords(params: ICreateRecordsRo & { tableId: string }) {
    const { tableId, ...recordRo } = params;
    const response = await axios.post<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/record`,
      recordRo
    );
    return response.data.data;
  }

  static async selectRecords(tableId: string, viewId: string, query?: { fieldKey: string }) {
    const { fieldKey } = query || {};
    const response = await axios.get<IJsonApiSuccessResponse<{ records: IRecord[] }>>(
      `/api/table/${tableId}/record`,
      {
        params: {
          viewId,
          fieldKey,
        },
      }
    );
    return response.data.data.records;
  }

  protected doc!: Doc<ITableSnapshot>;
  protected connection!: Connection;

  async updateName(name: string) {
    const fieldOperation = OpBuilder.editor.setTableName.build({
      newName: name,
      oldName: this.name,
    });

    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([fieldOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async createView(name: string, type: ViewType) {
    const data: IViewVo = {
      id: generateViewId(),
      name,
      type,
    };

    const createSnapshot = OpBuilder.creator.addView.build(data);
    const doc = this.connection.get(`${IdPrefix.View}_${this.id}`, data.id);
    return new Promise<Doc<IViewSnapshot>>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        console.log(`create view succeed!`, data);
        resolve(doc);
      });
    });
  }

  async createRecord(recordFields: IRecordFields) {
    const recordSnapshot: IRecordSnapshot = {
      record: {
        id: generateRecordId(),
        fields: recordFields,
      },
      recordOrder: {},
    };
    const createSnapshot = OpBuilder.creator.addRecord.build(recordSnapshot);
    const doc = this.connection.get(`${IdPrefix.Record}_${this.id}`, recordSnapshot.record.id);
    return new Promise<Doc<IRecordSnapshot>>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        resolve(doc);
      });
    });
  }

  async createField(fieldRo: IFieldRo) {
    return Table.createField({ ...fieldRo, tableId: this.id });
  }

  async updateRecord(params: { fieldName: string; viewId: string; index: number; value: unknown }) {
    return Table.updateRecord({
      ...params,
      tableId: this.id,
    });
  }
}
