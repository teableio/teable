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
  IRecordsVo,
  IRecordsRo,
  IUpdateRecordByIndexRo,
} from '@teable-group/core';
import {
  generateRecordId,
  generateViewId,
  IdPrefix,
  OpBuilder,
  TableCore,
} from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import axios from 'axios';

export class Table extends TableCore {
  static async updateRecordByIndex(params: IUpdateRecordByIndexRo & { tableId: string }) {
    const { tableId, ...recordRo } = params;
    const response = await axios.put<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/record`,
      recordRo
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

  static async getRecords(params: IRecordsRo & { tableId: string }) {
    const { tableId, ...recordsRo } = params;
    const response = await axios.get<IJsonApiSuccessResponse<IRecordsVo>>(
      `/api/table/${tableId}/record`,
      {
        params: recordsRo,
      }
    );
    return response.data.data;
  }

  protected doc!: Doc<ITableSnapshot>;

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

  async createView(name: string, type: ViewType, order: number) {
    const data: IViewVo = {
      id: generateViewId(),
      name,
      type,
      order,
    };

    const createSnapshot = OpBuilder.creator.addView.build(data);
    const connection = this.doc.connection;
    const doc = connection.get(`${IdPrefix.View}_${this.id}`, data.id);
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
        recordOrder: {},
      },
    };
    const createSnapshot = OpBuilder.creator.addRecord.build(recordSnapshot);
    const connection = this.doc.connection;
    const doc = connection.get(`${IdPrefix.Record}_${this.id}`, recordSnapshot.record.id);
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
}
