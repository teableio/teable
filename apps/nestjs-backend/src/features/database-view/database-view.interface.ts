import type { TableDomain } from '@teable/core';

export interface IDatabaseView {
  createView(table: TableDomain): Promise<void>;
  // Recreate view definition safely. For Postgres uses MV swap; SQLite uses regular view replacement
  recreateView(table: TableDomain): Promise<void>;
  dropView(tableId: string): Promise<void>;
}
