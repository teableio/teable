import type { IOtOperation } from '../models';
import { AddColumnBuilder } from './field/add-column';
import { AddFieldBuilder } from './field/add-field';
import { DeleteColumnBuilder } from './field/delete-column';
import { DeleteFieldBuilder } from './field/delete-field';
import { AddRecordBuilder } from './record/add-record';
import { AddRowBuilder } from './record/add-row';
import { DeleteRecordBuilder } from './record/delete-record';
import { DeleteRowBuilder } from './record/delete-row';
import { SetRecordBuilder } from './record/set-record';

export type { IAddColumnOpContext } from './field/add-column';
export type { IAddFieldOpContext } from './field/add-field';
export type { IDeleteColumnOpContext } from './field/delete-column';
export type { IDeleteFieldOpContext } from './field/delete-field';
export type { IAddRecordOpContext } from './record/add-record';
export type { IAddRowOpContext } from './record/add-row';
export type { IDeleteRecordOpContext } from './record/delete-record';
export type { IDeleteRowOpContext } from './record/delete-row';
export type { ISetRecordOpContext } from './record/set-record';

export class OpBuilder {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static items = {
    addRecord: new AddRecordBuilder(),
    setRecord: new SetRecordBuilder(),
    deleteRecord: new DeleteRecordBuilder(),
    addRow: new AddRowBuilder(),
    deleteRow: new DeleteRowBuilder(),

    addField: new AddFieldBuilder(),
    deleteField: new DeleteFieldBuilder(),
    addColumn: new AddColumnBuilder(),
    deleteColumn: new DeleteColumnBuilder(),
  };

  static ops2Contexts(ops: IOtOperation[]) {
    return ops.map((op) => {
      const result = this.detect(op);
      if (!result) {
        throw new Error(`can't detect op: ${op}`);
      }
      return result;
    });
  }

  static detect(op: IOtOperation) {
    for (const builder of Object.values(this.items)) {
      const result = builder.detect(op);
      if (result) {
        return result;
      }
    }
    return null;
  }
}
