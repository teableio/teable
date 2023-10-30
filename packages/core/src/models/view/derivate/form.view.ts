import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface IFormView extends IViewVo {
  type: ViewType.Form;
  options: FormViewOptions;
}

export class FormViewOptions {
  coverUrl?: string;
}

export class FormViewCore extends ViewCore {
  type!: ViewType.Form;

  options!: FormViewOptions;
}
