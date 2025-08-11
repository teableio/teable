import type { IFormColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';
import type { IFormViewOptions } from './form-view-option.schema';

export interface IFormView extends IViewVo {
  type: ViewType.Form;
  options: IFormViewOptions;
}

export class FormViewCore extends ViewCore {
  type!: ViewType.Form;

  options!: IFormViewOptions;

  columnMeta!: IFormColumnMeta;
}
