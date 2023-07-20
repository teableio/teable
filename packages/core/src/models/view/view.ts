import type { ViewType } from './constant';
import type { IViewVo } from './view.schema';

export abstract class ViewCore implements IViewVo {
  id!: string;

  name!: string;

  abstract type: ViewType;

  description?: string;

  filter!: unknown;

  sort!: unknown;

  order!: number;

  abstract options: unknown;
}
