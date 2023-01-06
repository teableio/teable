export interface ITable {
  id: string;
  name: string;
  description: string;
}

export interface ITableSnapshot {
  table: ITable;
}
