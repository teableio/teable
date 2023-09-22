import type { IFieldRo, IFieldVo, StatisticsFunc } from '@teable-group/core';
import { FieldCore, FieldOpBuilder } from '@teable-group/core';
import type { Doc } from 'sharedb/lib/client';
import { axios } from '../../config/axios';

export abstract class Field extends FieldCore {
  tableId!: string;

  static async getFields(tableId: string, viewId?: string) {
    const params = viewId ? { viewId } : {};
    const response = await axios.get<IFieldVo[]>(`/table/${tableId}/field`, {
      params,
    });
    return response.data;
  }

  static async createField(tableId: string, fieldRo: IFieldRo) {
    const response = await axios.post<IFieldVo>(`/table/${tableId}/field`, fieldRo);
    return response.data;
  }

  static async updateField(tableId: string, fieldId: string, fieldRo: IFieldRo): Promise<void> {
    const response = await axios.put<void>(`/table/${tableId}/field/${fieldId}`, fieldRo);
    return response.data;
  }

  static async deleteField(tableId: string, fieldId: string): Promise<void> {
    const response = await axios.delete<void>(`/table/${tableId}/field/${fieldId}`);
    return response.data;
  }

  protected doc!: Doc<IFieldVo>;

  private async submitOperation(operation: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateColumnWidth(viewId: string, width: number): Promise<void> {
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'width',
      newMetaValue: width,
      oldMetaValue: this.columnMeta[viewId]?.width,
    });

    return await this.submitOperation(fieldOperation);
  }

  async updateColumnHidden(viewId: string, hidden: boolean): Promise<void> {
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'hidden',
      newMetaValue: hidden,
      oldMetaValue: this.columnMeta[viewId]?.hidden,
    });

    return await this.submitOperation(fieldOperation);
  }

  async updateColumnOrder(viewId: string, order: number): Promise<void> {
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'order',
      newMetaValue: order,
      oldMetaValue: this.columnMeta[viewId].order,
    });

    return await this.submitOperation(fieldOperation);
  }

  async updateColumnStatistic(
    viewId: string,
    statisticFunc?: StatisticsFunc | null
  ): Promise<void> {
    if (statisticFunc === this.columnMeta[viewId]?.statisticFunc) {
      return;
    }
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'statisticFunc',
      newMetaValue: statisticFunc,
      oldMetaValue: this.columnMeta[viewId]?.statisticFunc,
    });
    return await this.submitOperation(fieldOperation);
  }

  async update(fieldRo: IFieldRo) {
    return await Field.updateField(this.tableId, this.id, fieldRo);
  }

  async delete(): Promise<void> {
    return await Field.deleteField(this.tableId, this.id);
  }
}
