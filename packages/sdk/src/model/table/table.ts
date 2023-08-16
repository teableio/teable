import type {
  ICreateTableRo,
  IFieldRo,
  IFieldVo,
  IJsonApiSuccessResponse,
  IRecord,
  ITableVo,
  IViewRo,
} from '@teable-group/core';
import { TableOpBuilder, FieldKeyType, TableCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import { axios } from '../../config/axios';
import { Field } from '../field/field';
import { Record } from '../record/record';
import { View } from '../view';

export class Table extends TableCore {
  static async createTable(tableRo?: ICreateTableRo) {
    const response = await axios.post<IJsonApiSuccessResponse<ITableVo>>(
      '/api/table',
      tableRo ?? {}
    );
    return response.data.data;
  }

  static async deleteTable(tableId: string) {
    const response = await axios.delete<IJsonApiSuccessResponse<void>>(`/api/table/${tableId}`);
    return response.data.data;
  }

  protected doc!: Doc<ITableVo>;

  async getViews() {
    return View.getViews(this.id);
  }

  async updateName(name: string) {
    const fieldOperation = TableOpBuilder.editor.setTableName.build({
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

  async createRecord(recordFields: IRecord['fields']) {
    return await Record.createRecords(this.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: recordFields,
        },
      ],
    });
  }

  async createField(fieldRo: IFieldRo) {
    return Field.createField(this.id, fieldRo);
  }

  async updateField(fieldId: string, fieldRo: IFieldRo) {
    return Field.updateField(this.id, fieldId, fieldRo);
  }

  async deleteField(fieldId: string) {
    return Field.deleteField(this.id, fieldId);
  }

  async updateOrder(order: number) {
    const fieldOperation = TableOpBuilder.editor.setTableOrder.build({
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
