export abstract class TableMutationCacheInvalidator {
  abstract invalidateDroppedTable(dbTableName: string): Promise<void>;
}
