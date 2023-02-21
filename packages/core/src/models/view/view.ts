import type { ViewType } from './constant';
import type { IFilter, ISort, IViewBase } from './interface';

export class ViewCore implements IViewBase {
  id!: string;

  name!: string;

  type!: ViewType;

  description?: string | undefined;

  filter?: IFilter | undefined;

  sort?: ISort | undefined;

  order!: number;

  options?: unknown;
}
