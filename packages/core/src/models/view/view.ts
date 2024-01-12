import type { IColumnMeta } from './column-meta.schema';
import type { ViewType } from './constant';
import type { IFilter } from './filter';
import type { IGroup } from './group';
import type { ISort } from './sort';
import type { IShareViewMeta, IViewVo } from './view.schema';

export abstract class ViewCore implements IViewVo {
  id!: string;

  name!: string;

  abstract type: ViewType;

  description?: string;

  filter?: IFilter;

  sort?: ISort;

  group?: IGroup;

  order!: number;

  shareId?: string;

  enableShare?: boolean;

  shareMeta?: IShareViewMeta;

  abstract options: unknown;

  createdBy!: string;

  lastModifiedBy!: string;

  createdTime!: string;

  lastModifiedTime!: string;

  columnMeta!: IColumnMeta;
}
