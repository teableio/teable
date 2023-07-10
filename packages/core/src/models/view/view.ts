import type { ViewType } from './constant';
import type { IFilter } from './filter';
import type { ISort, IViewVo, IGroup } from './interface';

export abstract class ViewCore implements IViewVo {
  id!: string;

  name!: string;

  abstract type: ViewType;

  description?: string;

  filter?: IFilter;

  sort?: ISort;

  group?: IGroup;

  order!: number;

  abstract options: unknown;
}
