import type { IFieldVo } from '../../models';
import { OpName } from '../common';
import type { ICreateOpBuilder } from '../interface';

export class AddFieldBuilder implements ICreateOpBuilder {
  name: OpName.AddField = OpName.AddField;

  build(field: IFieldVo): IFieldVo {
    return field;
  }
}
