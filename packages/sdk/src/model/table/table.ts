import type {
  IRecordFields,
  IFieldRo,
  IFieldVo,
  IJsonApiSuccessResponse,
  ITableSnapshot,
  ICreateRecordsRo,
  IRecordsVo,
  IRecordsRo,
  IUpdateRecordByIndexRo,
  IViewRo,
} from '@teable-group/core';
import { OpBuilder, TableCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import axios from 'axios';

export class Table extends TableCore {
  protected doc!: Doc<ITableSnapshot>;
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

  static async getFields(tableId: string, viewId?: string) {
    const params = viewId ? { viewId } : {};
    const response = await axios.get<IJsonApiSuccessResponse<IFieldVo[]>>(
      `/api/table/${tableId}/field`,
      {
        params,
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

  static async updateFieldById(params: IFieldRo & { id: string; tableId: string }): Promise<void> {
    const { id, tableId, ...fieldRo } = params;
    const response = await axios.put<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/field/${id}`,
      fieldRo
    );
    return response.data.data;
  }

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

  async createView(params: IViewRo & { tableId: string }) {
    const { tableId, ...viewRo } = params;

    const response = await axios.post<IJsonApiSuccessResponse<IFieldVo>>(
      `/api/table/${tableId}/view`,
      viewRo
    );
    return response.data.data;
  }

  async deleteView(params: { tableId: string; viewId: string }) {
    const { tableId, viewId } = params;

    const response = await axios.delete<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/view/${viewId}`
    );
    return response.data.data;
  }

  async createRecord(recordFields: IRecordFields) {
    const response = await axios.post<IJsonApiSuccessResponse<IRecordsVo>>(
      `/api/table/${this.id}/record`,
      {
        records: [
          {
            fields: recordFields,
          },
        ],
      }
    );
    return response.data.data;
  }

  async createField(fieldRo: IFieldRo) {
    return Table.createField({ ...fieldRo, tableId: this.id });
  }

  async updateOrder(order: number) {
    const fieldOperation = OpBuilder.editor.setTableOrder.build({
      newOrder: order,
      oldOrder: this.order,
    });

    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([fieldOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
