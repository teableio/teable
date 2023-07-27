import type { ITableOp } from '../../models';
import { OpName } from '../common';
import type { ICreateOpBuilder } from '../interface';

export class AddTableBuilder implements ICreateOpBuilder {
  name: OpName.AddTable = OpName.AddTable;

  build(table: ITableOp): ITableOp {
    return table;
  }
}
