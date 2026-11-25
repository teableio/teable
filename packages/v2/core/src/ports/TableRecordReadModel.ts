import type { IExecutionContext } from './ExecutionContext';

export type TableRecordReadModel = {
  id: string;
  fields: Record<string, unknown>;
  /** Display name, only present when the primary cell survives response projection. */
  name?: string;
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
  readonly createdByActorType: NonNullable<IExecutionContext['initiator']>['type'] | null;
  readonly createdByActorId: string | null;
  readonly lastModifiedByActorType: NonNullable<IExecutionContext['initiator']>['type'] | null;
  readonly lastModifiedByActorId: string | null;
  /**
   * View order values: viewId -> order number.
   * Populated when querying with includeOrders=true.
   * Used for undo/redo support to restore record positions.
   */
  orders?: Record<string, number>;
  /** Optional authority-derived capabilities for the returned field projection. */
  permissions?: Record<string, Record<string, boolean>>;
  /** Present only when a policy evaluator supplied a delete decision. */
  undeletable?: boolean;
};
