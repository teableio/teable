import type { TableDomain } from '@teable/core';

export interface IDatabaseView {
  createView(table: TableDomain): Promise<void>;
  // Recreate view definition safely using the Postgres materialized-view swap flow.
  recreateView(table: TableDomain): Promise<void>;
  dropView(tableId: string): Promise<void>;
}
