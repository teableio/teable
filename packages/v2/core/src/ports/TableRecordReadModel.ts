export type TableRecordReadModel = {
  id: string;
  fields: Record<string, unknown>;
  /**
   * The record's version number.
   * Used for ShareDB realtime synchronization.
   */
  version: number;
  /**
   * Optional system columns for undo/redo support.
   * These are populated when querying with mode='stored'.
   */
  autoNumber?: number;
  createdTime?: string;
  createdBy?: string;
  lastModifiedTime?: string;
  lastModifiedBy?: string;
  /**
   * View order values: viewId -> order number.
   * Populated when querying with includeOrders=true.
   * Used for undo/redo support to restore record positions.
   */
  orders?: Record<string, number>;
};
