import type { ITableVo } from './table.schema';

export class TableCore implements Partial<ITableVo> {
  id!: string;

  name!: string;

  icon?: string;

  description?: string;

  order!: number;
}
