import type { IFieldSnapshot, IFieldVo } from '../../models';
import { OpName } from '../common';
import type { ICreateOpBuilder } from '../interface';

export class AddFieldBuilder implements ICreateOpBuilder {
  name: OpName.AddField = OpName.AddField;

  build(field: IFieldVo): IFieldSnapshot {
    return {
      field,
    };
  }
}
