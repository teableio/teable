/* eslint-disable @typescript-eslint/naming-convention */
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddTableBuilder } from './add-table';
import { SetTableNameBuilder } from './set-table-name';
import { SetTableOrderBuilder } from './set-table-order';

export class TableOpBuilder {
  static editor = {
    setTableName: new SetTableNameBuilder(),
    setTableOrder: new SetTableOrderBuilder(),
  };

  static creator = new AddTableBuilder();

  static ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static detect = OpBuilderAbstract.detect;
}
