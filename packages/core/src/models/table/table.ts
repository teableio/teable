import type { ITable } from './interface';

export class Table {
  constructor(private readonly tableData: ITable) {}
  get name() {
    return this.tableData.name;
  }

  get id() {
    return this.tableData.id;
  }
}
