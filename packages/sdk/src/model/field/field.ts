import type { IFieldRo, IFieldVo, IJsonApiSuccessResponse } from '@teable-group/core';
import { FieldCore, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import axios from 'axios';

export abstract class Field extends FieldCore {
  tableId!: string;

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

  static async createField(tableId: string, fieldRo: IFieldRo) {
    const response = await axios.post<IJsonApiSuccessResponse<IFieldVo>>(
      `/api/table/${tableId}/field`,
      fieldRo
    );
    return response.data.data;
  }

  static async updateFieldById(tableId: string, fieldId: string, fieldRo: IFieldRo): Promise<void> {
    const response = await axios.put<IJsonApiSuccessResponse<void>>(
      `/api/table/${tableId}/field/${fieldId}`,
      fieldRo
    );
    return response.data.data;
  }

  protected doc!: Doc<IFieldVo>;

  private async submitOperation(operation: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateName(name: string): Promise<void> {
    const fieldOperation = OpBuilder.editor.setFieldName.build({
      newName: name,
      oldName: this.name,
    });

    return await this.submitOperation(fieldOperation);
  }

  async updateColumnWidth(viewId: string, width: number): Promise<void> {
    const fieldOperation = OpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'width',
      newMetaValue: width,
      oldMetaValue: this.columnMeta[viewId]?.width,
    });

    return await this.submitOperation(fieldOperation);
  }

  async updateColumnHidden(viewId: string, hidden: boolean): Promise<void> {
    const fieldOperation = OpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'hidden',
      newMetaValue: hidden,
      oldMetaValue: this.columnMeta[viewId]?.hidden,
    });

    return await this.submitOperation(fieldOperation);
  }

  async update(fieldRo: IFieldRo) {
    return await Field.updateFieldById(this.tableId, this.id, fieldRo);
  }

  async delete(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.doc.del({}, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
