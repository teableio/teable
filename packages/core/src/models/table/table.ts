import type { ITableVo } from './interface';

export class Table {
  constructor(private readonly tableData: ITableVo) {}
  get name() {
    return this.tableData.name;
  }

  get id() {
    return this.tableData.id;
  }
}
