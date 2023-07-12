import type { IFieldSnapshot } from '@teable-group/core';
import { FieldCore, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';

export abstract class FieldOperations extends FieldCore {
  doc!: Doc<IFieldSnapshot>;

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

  async updateColumnOrder(viewId: string, order: number): Promise<void> {
    const fieldOperation = OpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'order',
      newMetaValue: order,
      oldMetaValue: this.columnMeta[viewId].order,
    });

    return await this.submitOperation(fieldOperation);
  }

  async delete(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.doc.del({}, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
