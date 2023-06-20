import type { IOtOperation } from '../models';
import { AddColumnMetaBuilder } from './field/add-column-meta';
import { AddFieldBuilder } from './field/add-field';
import { DeleteColumnMetaBuilder } from './field/delete-column-meta';
import { SetColumnMetaBuilder } from './field/set-column-meta';
import { SetFieldDefaultValueBuilder } from './field/set-field-default-value';
import { SetFieldDescriptionBuilder } from './field/set-field-description';
import { SetFieldNameBuilder } from './field/set-field-name';
import { SetFieldOptionsBuilder } from './field/set-field-options';
import { SetFieldTypeBuilder } from './field/set-field-type';
import { AddRecordBuilder } from './record/add-record';
import { DeleteRecordBuilder } from './record/delete-record';
import { SetRecordBuilder } from './record/set-record';
import { SetRecordOrderBuilder } from './record/set-record-order';
import { AddTableBuilder } from './table/add-table';
import { SetTableNameBuilder } from './table/set-table-name';
import { SetTableOrderBuilder } from './table/set-table-order';
import { AddViewBuilder } from './view/add-view';
import { SetViewNameBuilder } from './view/set-view-name';

export type { ISetRecordOrderOpContext } from './record/set-record-order';
export type { IDeleteRecordOpContext } from './record/delete-record';
export type { ISetRecordOpContext } from './record/set-record';
export type { ISetColumnMetaOpContext } from './field/set-column-meta';
export type { IAddColumnMetaOpContext } from './field/add-column-meta';
export type { ISetFieldNameOpContext } from './field/set-field-name';
export type { ISetViewNameOpContext } from './view/set-view-name';
export type { ISetTableNameOpContext } from './table/set-table-name';
export type { ISetTableOrderOpContext } from './table/set-table-order';

export class OpBuilder {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static editor = {
    setRecord: new SetRecordBuilder(),
    deleteRecord: new DeleteRecordBuilder(),
    setRecordOrder: new SetRecordOrderBuilder(),

    addColumnMeta: new AddColumnMetaBuilder(),
    deleteColumnMeta: new DeleteColumnMetaBuilder(),
    setColumnMeta: new SetColumnMetaBuilder(),
    setFieldName: new SetFieldNameBuilder(),
    setFieldDescription: new SetFieldDescriptionBuilder(),
    setFieldOptions: new SetFieldOptionsBuilder(),
    setFieldDefaultValue: new SetFieldDefaultValueBuilder(),
    setFieldType: new SetFieldTypeBuilder(),

    setViewName: new SetViewNameBuilder(),

    setTableName: new SetTableNameBuilder(),
    setTableOrder: new SetTableOrderBuilder(),
  };

  // eslint-disable-next-line @typescript-eslint/naming-convention
  static creator = {
    addField: new AddFieldBuilder(),
    addRecord: new AddRecordBuilder(),
    addView: new AddViewBuilder(),
    addTable: new AddTableBuilder(),
  };

  static ops2Contexts(ops: IOtOperation[]) {
    return ops.map((op) => {
      const result = this.detect(op);
      if (!result) {
        throw new Error(`can't detect op: ${JSON.stringify(op)}`);
      }
      return result;
    });
  }

  static detect(op: IOtOperation) {
    for (const builder of Object.values(this.editor)) {
      const result = builder.detect(op);
      if (result) {
        return result;
      }
    }
    return null;
  }
}
