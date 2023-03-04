import {
  IFieldSnapshot,
  ITableSnapshot,
  NumberFieldCore,
  OpBuilder,
  TableCore,
} from '@teable-group/core';
import { Doc } from 'sharedb/lib/client';

export class Table extends TableCore {
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
}
