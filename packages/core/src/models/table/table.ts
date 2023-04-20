import type { ITableVo } from './interface';

export class TableCore implements ITableVo {
  id!: string;

  name!: string;

  icon?: string;

  description?: string;

  order!: number;
}
