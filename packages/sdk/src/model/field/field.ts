/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IFieldVo, StatisticsFunc } from '@teable-group/core';
import { FieldCore, FieldOpBuilder } from '@teable-group/core';
import { createField, deleteField, getFieldList, updateField } from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';

export abstract class Field extends FieldCore {
  tableId!: string;

  static getFields = getFieldList;

  static createField = createField;

  static updateField = updateField;

  static deleteField = deleteField;

  protected doc!: Doc<IFieldVo>;

  private async submitOperation(operation: unknown) {
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

  async updateColumnWidth(viewId: string, width: number) {
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'width',
      newMetaValue: width,
      oldMetaValue: this.columnMeta[viewId]?.width,
    });

    return this.submitOperation(fieldOperation);
  }

  async updateColumnHidden(viewId: string, hidden: boolean) {
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'hidden',
      newMetaValue: hidden,
      oldMetaValue: this.columnMeta[viewId]?.hidden,
    });

    return this.submitOperation(fieldOperation);
  }

  async updateColumnOrder(viewId: string, order: number) {
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'order',
      newMetaValue: order,
      oldMetaValue: this.columnMeta[viewId].order,
    });

    return this.submitOperation(fieldOperation);
  }

  async updateColumnStatistic(viewId: string, statisticFunc?: StatisticsFunc | null) {
    if (statisticFunc === this.columnMeta[viewId]?.statisticFunc) {
      return;
    }
    const fieldOperation = FieldOpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'statisticFunc',
      newMetaValue: statisticFunc,
      oldMetaValue: this.columnMeta[viewId]?.statisticFunc,
    });
    return this.submitOperation(fieldOperation);
  }

  async update(fieldRo: IFieldRo) {
    return Field.updateField(this.tableId, this.id, fieldRo);
  }

  async delete() {
    return Field.deleteField(this.tableId, this.id);
  }
}
