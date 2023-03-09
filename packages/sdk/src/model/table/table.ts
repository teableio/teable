import {
  generateViewId,
  ITableSnapshot,
  IViewVo,
  OpBuilder,
  TableCore,
  ViewType,
} from '@teable-group/core';
import { Connection, Doc } from 'sharedb/lib/client';

export class Table extends TableCore {
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
    const viewData: IViewVo = {
      id: generateViewId(),
      name,
      type,
    };

    const createSnapshot = OpBuilder.creator.addView.build(viewData);
    const doc = this.connection.get(this.id, viewData.id);
    return new Promise<Doc>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        console.log(`create view succeed!`, viewData);
        resolve(doc);
      });
    });
  }
}
