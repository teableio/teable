import type { IViewVo } from '../../models';
import { OpName } from '../common';
import type { ICreateOpBuilder } from '../interface';

export class AddViewBuilder implements ICreateOpBuilder {
  name: OpName.AddView = OpName.AddView;

  build(view: IViewVo): IViewVo {
    return view;
  }
}
