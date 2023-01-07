import type { IOtOperation } from '../models';
import { AddFieldBuilder } from './field/add-field';
import { DeleteFieldBuilder } from './field/delete-field';
import { SetColumnMetaBuilder } from './field/set-column-meta';
import { AddRecordBuilder } from './record/add-record';
import { DeleteRecordBuilder } from './record/delete-record';
import { SetRecordBuilder } from './record/set-record';
import { SetRecordOrderBuilder } from './record/set-record-order';

export type { IAddFieldOpContext } from './field/add-field';
export type { IDeleteFieldOpContext } from './field/delete-field';
export type { IAddRecordOpContext } from './record/add-record';
export type { IAddRowOpContext } from './record/set-record-order';
export type { IDeleteRecordOpContext } from './record/delete-record';
export type { ISetRecordOpContext } from './record/set-record';
export type { ISetColumnMetaOpContext } from './field/set-column-meta';

export class OpBuilder {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static items = {
    addRecord: new AddRecordBuilder(),
    setRecord: new SetRecordBuilder(),
    deleteRecord: new DeleteRecordBuilder(),
    setRecordOrder: new SetRecordOrderBuilder(),

    addField: new AddFieldBuilder(),
    deleteField: new DeleteFieldBuilder(),
    setColumnMeta: new SetColumnMetaBuilder(),
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
