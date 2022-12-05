import type { Table } from 'models/table/table';

export class View {
  constructor(private readonly ctx: React.Context<Table>) {}

  getCellValue(row: number, column: number) {
    return `${row} ${column}`;
  }
}
