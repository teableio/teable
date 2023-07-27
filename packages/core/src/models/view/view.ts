import type { ViewType } from './constant';
import type { IFilter } from './filter';
import type { IViewVo } from './view.schema';

export abstract class ViewCore implements IViewVo {
  id!: string;

  name!: string;

  abstract type: ViewType;

  description?: string;

  filter?: IFilter;

  sort?: unknown;

  group?: unknown;

  order!: number;

  abstract options: unknown;
}
