import type {
  IRecordFields,
  IRecordSnapshot,
  IFieldRo,
  IFieldVo,
  IJsonApiSuccessResponse,
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
import axios from 'axios';

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
    const data: IViewVo = {
      id: generateViewId(),
      name,
      type,
    };

    const createSnapshot = OpBuilder.creator.addView.build(data);
    const doc = this.connection.get(`${IdPrefix.View}_${this.id}`, data.id);
    return new Promise<Doc<IViewSnapshot>>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        console.log(`create view succeed!`, data);
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
    return new Promise<Doc<IRecordSnapshot>>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        resolve(doc);
      });
    });
  }

  async createField(fieldRo: IFieldRo) {
    const response = await axios.post<IJsonApiSuccessResponse<IFieldVo>>(
      `/api/table/${this.id}/field`,
      fieldRo
    );
    return response.data.data;
  }

  // async updateRecord({
  //   fieldId,
  //   recordId,
  //   value,
  // }: {
  //   fieldId: string;
  //   recordId: string;
  //   value: unknown;
  // }) {
  //   const operation = OpBuilder.editor.setRecord.build({
  //     fieldId,
  //     newCellValue,
  //     oldCellValue,
  //   });

  //   rowData.submitOp([operation], { undoable: true }, (error) => {
  //     if (error) {
  //       console.error('row data submit error: ', error);
  //     }
  //   });
  //   return rowData;
  // }
}
