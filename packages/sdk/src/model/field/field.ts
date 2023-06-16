import type { IColumnMeta, IFieldSnapshot } from '@teable-group/core';
import { FieldCore, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';

export abstract class FieldOperations extends FieldCore {
  doc!: Doc<IFieldSnapshot>;

  updateName(name: string): Promise<void> {
    const fieldOperation = OpBuilder.editor.setFieldName.build({
      newName: name,
      oldName: this.name,
    });

    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([fieldOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateColumnWidth(viewId: string, width: number): Promise<void> {
    const newColumnMeta = this.columnMeta;

    newColumnMeta[viewId]['width'] = width;

    return this.updateColumnMeta(newColumnMeta, this.columnMeta);
  }

  async updateColumnHidden(viewId: string, hidden: boolean): Promise<void> {
    const newColumnMeta = {
      ...this.columnMeta,
      [viewId]: {
        ...this.columnMeta[viewId],
        hidden,
      },
    };

    return this.updateColumnMeta(newColumnMeta, this.columnMeta);
  }

  async delete(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.doc.del({}, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateColumnMeta(newMetaValue: IColumnMeta, oldMetaValue?: IColumnMeta) {
    const fieldOperation = OpBuilder.editor.setColumnMeta.build({
      newMetaValue: newMetaValue,
      oldMetaValue: oldMetaValue,
    });

    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([fieldOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
