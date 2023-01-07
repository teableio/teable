import type { IFieldBase, IFieldSnapshot } from '../../models';
import { OpName } from '../common';
import type { ICreateOpBuilder } from '../interface';

export class AddFieldBuilder implements ICreateOpBuilder {
  name: OpName.AddField = OpName.AddField;

  build(field: IFieldBase): IFieldSnapshot {
    return {
      field: field,
      columnMeta: {},
    };
  }
}
