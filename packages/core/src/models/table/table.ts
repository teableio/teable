import type { ITableVo } from './table.schema';

export class TableCore implements ITableVo {
  id!: string;

  name!: string;

  icon?: string;

  description?: string;

  order!: number;

  lastModifiedTime!: string;

  defaultViewId!: string;
}
