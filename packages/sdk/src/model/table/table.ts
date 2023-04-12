import type {
  IRecordFields,
  IRecordSnapshot,
  ITableSnapshot,
  IViewSnapshot,
  IViewVo,
  ViewType,
} from '@teable-group/core';
import {
  generateRecordId,
  generateViewId,
  IdPrefix,
  OpBuilder,
  TableCore,
} from '@teable-group/core';
import type { Connection, Doc } from '@teable/sharedb/lib/client';

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
    const doc = this.connection.get(`${IdPrefix.View}_${this.id}`, viewData.id);
    return new Promise<Doc<IViewSnapshot>>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        console.log(`create view succeed!`, viewData);
        resolve(doc);
      });
    });
  }

  async createRecord(recordFields: IRecordFields) {
    const recordSnapshot: IRecordSnapshot = {
      record: {
        id: generateRecordId(),
        fields: recordFields,
      },
      recordOrder: {},
    };
    const createSnapshot = OpBuilder.creator.addRecord.build(recordSnapshot);
    const doc = this.connection.get(`${IdPrefix.Record}_${this.id}`, recordSnapshot.record.id);
    return new Promise<Doc<IViewSnapshot>>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        resolve(doc);
      });
    });
  }
}
