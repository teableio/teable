import type { ViewType } from './constant';
import type { IFilter, ISort, IViewVo } from './interface';

export abstract class ViewCore implements IViewVo {
  id!: string;

  name!: string;

  abstract type: ViewType;

  description?: string;

  filter!: IFilter;

  sort!: ISort;

  order!: number;

  abstract options: unknown;
}
