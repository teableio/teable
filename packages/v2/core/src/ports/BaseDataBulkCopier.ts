import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

/**
 * A link cell column on a source table whose values need special handling
 * during a physical copy: cross-base and disconnected links are downgraded to
 * their title text, and the column's self key drives the legacy allow-list for
 * `__row_*` / `__fk_*` source columns.
 */
export interface BulkCopyLinkValueColumn {
  dbFieldName: string;
  selfKeyName: string;
  isMultipleCellValue: boolean;
}

/**
 * Physical link storage info of a source (non-lookup) link field, pre-filtered
 * by the host with the same rules the legacy copier applied: cross-base links
 * are excluded when cross-base references are not allowed, and disconnected
 * links (foreign table not part of the duplication) are excluded as well.
 */
export interface BulkCopySourceLinkField {
  /** Source table id that owns the link field. */
  tableId: string;
  fieldId: string;
  fkHostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
}

export interface BulkCopyTableInput {
  sourceTableId: string;
  targetTableId: string;
  targetTableName: string;
  /** Fully qualified `schema.table` of the source physical table. */
  sourceDbTableName: string;
  /** Fully qualified `schema.table` of the freshly created target table. */
  targetDbTableName: string;
  /**
   * Physical target columns that must not receive inserted values: computed
   * fields (generated columns reject INSERT) and button fields. Stored computed
   * values are recomputed by the computed pipeline after the copy.
   */
  excludedTargetColumns: ReadonlyArray<string>;
  /** Link value columns of this source table (empty for ordinary tables). */
  linkValueColumns: ReadonlyArray<BulkCopyLinkValueColumn>;
}

export interface BulkCopyJunctionInput {
  sourceJunctionDbTableName: string;
  targetJunctionDbTableName: string;
  sourceSelfKeyName: string;
  sourceForeignKeyName: string;
  targetSelfKeyName: string;
  targetForeignKeyName: string;
}

export interface BaseDataBulkCopyPlan {
  tables: ReadonlyArray<BulkCopyTableInput>;
  junctions: ReadonlyArray<BulkCopyJunctionInput>;
  /** source view id -> target view id (drives `__row_*` column remapping). */
  viewIdMap: Record<string, string>;
  /** source field id -> target field id (drives `__fk_*` column remapping). */
  fieldIdMap: Record<string, string>;
  batchSize: number;
}

export interface BaseDataBulkCopyProgress {
  phase: 'table_data_start' | 'table_data_progress' | 'table_data_done';
  tableId?: string;
  tableName?: string;
  processedRows: number;
  totalRows: number;
  batchProcessedRows?: number;
  currentBatch?: number;
}

export interface BaseDataBulkCopyResult {
  recordsLength: number;
}

/**
 * Physical same-database base data copier.
 *
 * Duplicating a base clones records verbatim — including computed values, link
 * storage columns and junction tables — so routing rows through the domain
 * model would buy no invariant and cost a full hydrate per record. This port
 * owns the set-based fast path (INSERT…SELECT with an FK drop/rebuild cycle)
 * so the duplicate command handler does not depend on host services. It is
 * only usable when the source schema is reachable from the target base's data
 * connection; callers fall back to row streaming otherwise.
 */
export interface IBaseDataBulkCopier {
  /**
   * Physical preflight: true when every source schema in the plan is reachable
   * from the current data connection (i.e. source and target share a database).
   */
  isSupported(
    context: IExecutionContext,
    plan: BaseDataBulkCopyPlan
  ): Promise<Result<boolean, DomainError>>;

  /**
   * Copies all table rows and link junction rows of the plan inside a single
   * transaction. Foreign keys on source and target tables are dropped first
   * and rebuilt afterwards with their original ON DELETE action.
   */
  copyBaseData(
    context: IExecutionContext,
    plan: BaseDataBulkCopyPlan,
    onProgress?: (progress: BaseDataBulkCopyProgress) => void
  ): Promise<Result<BaseDataBulkCopyResult, DomainError>>;
}
