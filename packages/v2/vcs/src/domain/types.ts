import { z } from 'zod';

export type VcsRemoteMode = 'v2-vcs' | 'openapi-readonly';

export type VcsEntityType = 'table' | 'field' | 'view' | 'record';

export type VcsChangeOpKind = 'upsert' | 'delete' | 'create' | 'update';

export interface IVcsStoredChange {
  readonly seq: number;
  readonly txId: string;
  readonly baseId: string;
  readonly revision?: number | null;
  readonly originPushId?: string | null;
  readonly tableId: string;
  readonly entityType: VcsEntityType;
  readonly entityId: string;
  readonly fieldId?: string | null;
  readonly opKind: VcsChangeOpKind;
  readonly beforeValue: unknown;
  readonly afterValue: unknown;
  readonly actorId?: string | null;
  readonly createdAt?: string;
}

export interface IVcsPushCasConflict {
  readonly key: string;
  readonly tableId: string;
  readonly entityType: VcsEntityType | 'cell';
  readonly entityId: string;
  readonly fieldId?: string;
  readonly before: unknown;
  readonly current: unknown;
}

export type VcsMultiValueStrategy = 'strict' | 'set';

export type VcsConflictKind =
  | 'table_delete_modify'
  | 'field_delete_modify'
  | 'field_schema_conflict'
  | 'view_delete_modify'
  | 'view_schema_conflict'
  | 'record_delete_modify'
  | 'cell_edit_edit'
  | 'constraint_conflict';

export type VcsConflictResolutionStrategy = 'ours' | 'theirs' | 'manual';

export interface IFieldVcsSnapshot {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly options?: Record<string, unknown>;
  readonly notNull?: boolean;
  readonly unique?: boolean;
  readonly description?: string | null;
  readonly aiConfig?: unknown;
  readonly isLookup?: boolean;
  readonly isConditionalLookup?: boolean;
  readonly isPrimary: boolean;
  readonly isComputed: boolean;
}

export interface IViewVcsSnapshot {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly description?: string | null;
  readonly columnMeta?: Record<string, unknown>;
  readonly options?: Record<string, unknown>;
  readonly query?: {
    readonly filter?: unknown;
    readonly sort?: unknown;
    readonly group?: unknown;
    readonly manualSort?: boolean;
  };
  readonly order?: number;
}

export interface IRecordVcsSnapshot {
  readonly id: string;
  readonly fields: Record<string, unknown>;
  readonly orders?: Record<string, number>;
  /** Storage order used by views without a materialized manual order column. */
  readonly autoNumber?: number;
  readonly version?: number;
}

export interface ITableAccessScope {
  readonly tableId: string;
  readonly readableFieldIds?: readonly string[];
  readonly isRowFiltered?: boolean;
}

export interface IBaseVcsAccessScope {
  readonly tables: Record<string, ITableAccessScope>;
}

export interface ITableVcsSnapshot {
  readonly id: string;
  readonly name: string;
  readonly dbTableName?: string;
  readonly primaryFieldId: string;
  readonly fields: readonly IFieldVcsSnapshot[];
  readonly views: readonly IViewVcsSnapshot[];
  readonly records: readonly IRecordVcsSnapshot[];
}

export interface IBaseVcsSnapshot {
  readonly formatVersion: 1;
  readonly baseId: string;
  readonly baseName: string;
  readonly revision: number;
  readonly cursor?: string;
  readonly capturedAt: string;
  readonly tables: readonly ITableVcsSnapshot[];
  readonly accessScope?: IBaseVcsAccessScope;
}

export interface IFieldUpdatePatch {
  readonly fieldId: string;
  readonly before: IFieldVcsSnapshot;
  readonly after: IFieldVcsSnapshot;
}

export interface IViewUpdatePatch {
  readonly viewId: string;
  readonly before: IViewVcsSnapshot;
  readonly after: IViewVcsSnapshot;
}

export interface ICellChangePatch {
  readonly fieldId: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface IRecordUpdatePatch {
  readonly recordId: string;
  readonly cellChanges: readonly ICellChangePatch[];
  readonly orderChanges?: readonly {
    readonly viewId: string;
    readonly before: number | null;
    readonly after: number;
  }[];
}

export interface ITableVcsPatch {
  readonly tableId: string;
  readonly nameChange?: {
    readonly from: string;
    readonly to: string;
  };
  readonly fieldsAdded: readonly IFieldVcsSnapshot[];
  readonly fieldsUpdated: readonly IFieldUpdatePatch[];
  readonly fieldsDeleted: readonly {
    readonly fieldId: string;
    readonly before: IFieldVcsSnapshot;
  }[];
  readonly viewsAdded: readonly IViewVcsSnapshot[];
  readonly viewsUpdated: readonly IViewUpdatePatch[];
  readonly viewsDeleted: readonly { readonly viewId: string; readonly before: IViewVcsSnapshot }[];
  readonly recordsAdded: readonly IRecordVcsSnapshot[];
  readonly recordsUpdated: readonly IRecordUpdatePatch[];
  readonly recordsDeleted: readonly {
    readonly recordId: string;
    readonly before: IRecordVcsSnapshot & { readonly version: number };
  }[];
}

export interface IDeletedTableVcsPatch {
  readonly tableId: string;
  readonly tableName?: string;
  readonly before: ITableVcsSnapshot;
}

export interface IBaseVcsPatch {
  readonly tablesAdded: readonly ITableVcsSnapshot[];
  readonly tablesDeleted: readonly IDeletedTableVcsPatch[];
  readonly tablesUpdated: readonly ITableVcsPatch[];
}

export interface IBaseVcsPatchSummary {
  readonly tablesAdded: number;
  readonly tablesDeleted: number;
  readonly tablesRenamed: number;
  readonly fieldsAdded: number;
  readonly fieldsUpdated: number;
  readonly fieldsDeleted: number;
  readonly viewsAdded: number;
  readonly viewsUpdated: number;
  readonly viewsDeleted: number;
  readonly recordsAdded: number;
  readonly recordsUpdated: number;
  readonly recordsDeleted: number;
  readonly cellChanges: number;
}

export interface IComputedImpactCellChange {
  readonly tableId: string;
  readonly tableName: string;
  readonly recordId: string;
  readonly fieldId: string;
  readonly fieldName: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface IComputedImpactReport {
  readonly changes: readonly IComputedImpactCellChange[];
  readonly totalAffectedCells: number;
}

export interface IVcsConflict {
  readonly id: string;
  readonly kind: VcsConflictKind;
  readonly tableId: string;
  readonly entityId: string;
  readonly fieldId?: string;
  readonly baseValue: unknown;
  readonly oursValue: unknown;
  readonly theirsValue: unknown;
  readonly message: string;
}

export interface IVcsConflictResolution {
  readonly strategy: VcsConflictResolutionStrategy;
  readonly manualValue?: unknown;
}

export interface IVcsWorkspaceConfig {
  readonly formatVersion: 1;
  readonly baseId: string;
  readonly baseName: string;
  readonly endpoint?: string;
  readonly remoteMode: VcsRemoteMode;
  readonly pgliteDir?: string;
  readonly headlessUrl?: string;
  readonly selectedTables?: readonly string[];
  readonly multiValueStrategy?: VcsMultiValueStrategy;
  readonly pullCursor?: string;
  readonly lastOriginPushId?: string;
  readonly lastOriginPushIds?: readonly string[];
  readonly schemaOnly?: boolean;
  readonly clonedAt?: string;
  /** Historical checkouts keep their clone revision and cannot be edited or synchronized. */
  readonly readOnly?: boolean;
  readonly cloneRevision?: number;
  readonly lastPulledAt?: string;
  readonly lastPushedAt?: string;
}

export interface IVcsCloneRecordsChunk {
  readonly tableId: string;
  readonly records: readonly IRecordVcsSnapshot[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export interface IVcsWorkingTableDelta {
  readonly tableId: string;
  readonly schemaChanged: boolean;
  readonly dirtyRecordIds: readonly string[];
  readonly upsertedRecords: readonly IRecordVcsSnapshot[];
  readonly deletedRecordIds: readonly string[];
}

export interface IVcsWorkingDelta {
  readonly isCompleteDelta: boolean;
  readonly schemaSnapshot: IBaseVcsSnapshot;
  readonly tableDeltas: ReadonlyMap<string, IVcsWorkingTableDelta>;
}

export interface IVcsMergeState {
  readonly baseSnapshot: IBaseVcsSnapshot;
  readonly oursSnapshot: IBaseVcsSnapshot;
  readonly theirsSnapshot: IBaseVcsSnapshot;
  readonly workingSnapshot: IBaseVcsSnapshot;
  readonly conflicts: readonly IVcsConflict[];
}

export interface IThreeWayMergeResult {
  readonly mergedSnapshot: IBaseVcsSnapshot;
  readonly conflicts: readonly IVcsConflict[];
  readonly autoMergedCount: number;
}

export interface IVcsDirtyKey {
  readonly revision: number;
  readonly tableId: string;
  readonly entityType: VcsEntityType;
  readonly entityId: string;
  readonly opKind: VcsChangeOpKind;
  readonly actorId?: string | null;
  readonly createdAt?: string;
}

export interface IVcsTableRecordDelta {
  readonly tableId: string;
  readonly upserts: readonly IRecordVcsSnapshot[];
  readonly deletes: readonly string[];
}

export interface IVcsIncrementalChanges {
  readonly baseId: string;
  readonly baseName: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly nextCursor?: string;
  readonly hasChanges?: boolean;
  readonly hasMore?: boolean;
  readonly originPushIds?: readonly string[];
  readonly requiresFullSync: boolean;
  readonly fullSnapshot?: IBaseVcsSnapshot;
  readonly upsertedTables: readonly ITableVcsSnapshot[];
  readonly deletedTableIds: readonly string[];
  readonly recordDeltas: readonly IVcsTableRecordDelta[];
  readonly accessScope?: IBaseVcsAccessScope;
}

export interface IVcsHeadInfo {
  readonly baseId: string;
  readonly baseName: string;
  readonly headRevision: number;
  readonly vcsEnabled?: boolean;
  readonly remoteMode: VcsRemoteMode;
}

export interface IVcsPushRequest {
  readonly baseId: string;
  readonly baseRevision: number;
  readonly patch: IBaseVcsPatch;
  readonly message?: string;
  readonly originPushId?: string;
  readonly dryRun?: boolean;
}

export interface IVcsPushResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly baseId: string;
  readonly baseRevision: number;
  readonly newRevision: number;
  readonly commitId?: string;
  readonly originPushId?: string;
  readonly rebased: boolean;
  readonly completedBatches?: number;
  readonly totalBatches?: number;
  readonly summary: IBaseVcsPatchSummary;
  readonly conflictError?: {
    readonly code: 'vcs.cas_conflict' | 'vcs.non_fast_forward';
    readonly message: string;
    readonly headRevision: number;
    readonly overlappingKeys: readonly string[];
    readonly conflicts?: readonly IVcsPushCasConflict[];
  };
}

export interface IVcsEngineApplyResult {
  readonly applied: boolean;
  readonly recomputedCells: number;
  readonly snapshot?: IBaseVcsSnapshot;
}

export const fieldVcsSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  options: z.record(z.string(), z.unknown()).optional(),
  notNull: z.boolean().optional(),
  unique: z.boolean().optional(),
  description: z.string().nullable().optional(),
  aiConfig: z.unknown().optional(),
  isLookup: z.boolean().optional(),
  isConditionalLookup: z.boolean().optional(),
  isPrimary: z.boolean(),
  isComputed: z.boolean(),
});

export const viewVcsSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  description: z.string().nullable().optional(),
  columnMeta: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  query: z
    .object({
      filter: z.unknown().optional(),
      sort: z.unknown().optional(),
      group: z.unknown().optional(),
      manualSort: z.boolean().optional(),
    })
    .optional(),
  order: z.number().optional(),
});

export const recordVcsSnapshotSchema = z.object({
  id: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
  orders: z.record(z.string(), z.number()).optional(),
  autoNumber: z.number().int().optional(),
  version: z.number().int().nonnegative().optional(),
});

export const tableVcsSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dbTableName: z.string().optional(),
  primaryFieldId: z.string().min(1),
  fields: z.array(fieldVcsSnapshotSchema),
  views: z.array(viewVcsSnapshotSchema),
  records: z.array(recordVcsSnapshotSchema),
});

export const baseVcsSnapshotSchema = z.object({
  formatVersion: z.literal(1),
  baseId: z.string().min(1),
  baseName: z.string().min(1),
  revision: z.number().int().nonnegative(),
  cursor: z.string().optional(),
  capturedAt: z.string().min(1),
  tables: z.array(tableVcsSnapshotSchema),
  accessScope: z
    .object({
      tables: z.record(
        z.string(),
        z.object({
          tableId: z.string().min(1),
          readableFieldIds: z.array(z.string()).optional(),
          isRowFiltered: z.boolean().optional(),
        })
      ),
    })
    .optional(),
});

export const MAX_VCS_PATCH_TABLES = 200;
export const MAX_VCS_PATCH_FIELDS_PER_TABLE = 500;
export const MAX_VCS_PATCH_VIEWS_PER_TABLE = 200;
export const MAX_VCS_PATCH_RECORDS_PER_TABLE = 10_000;
export const MAX_VCS_PATCH_TOTAL_RECORDS = 10_000;

export const tableVcsPatchSchema = z.object({
  tableId: z.string().min(1),
  nameChange: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .optional(),
  fieldsAdded: z.array(fieldVcsSnapshotSchema).max(MAX_VCS_PATCH_FIELDS_PER_TABLE),
  fieldsUpdated: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        before: fieldVcsSnapshotSchema,
        after: fieldVcsSnapshotSchema,
      })
    )
    .max(MAX_VCS_PATCH_FIELDS_PER_TABLE),
  fieldsDeleted: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        before: fieldVcsSnapshotSchema,
      })
    )
    .max(MAX_VCS_PATCH_FIELDS_PER_TABLE),
  viewsAdded: z.array(viewVcsSnapshotSchema).max(MAX_VCS_PATCH_VIEWS_PER_TABLE),
  viewsUpdated: z
    .array(
      z.object({
        viewId: z.string().min(1),
        before: viewVcsSnapshotSchema,
        after: viewVcsSnapshotSchema,
      })
    )
    .max(MAX_VCS_PATCH_VIEWS_PER_TABLE),
  viewsDeleted: z
    .array(
      z.object({
        viewId: z.string().min(1),
        before: viewVcsSnapshotSchema,
      })
    )
    .max(MAX_VCS_PATCH_VIEWS_PER_TABLE),
  recordsAdded: z.array(recordVcsSnapshotSchema).max(MAX_VCS_PATCH_RECORDS_PER_TABLE),
  recordsUpdated: z
    .array(
      z.object({
        recordId: z.string().min(1),
        cellChanges: z.array(
          z.object({
            fieldId: z.string().min(1),
            before: z.unknown(),
            after: z.unknown(),
          })
        ),
        orderChanges: z
          .array(
            z.object({
              viewId: z.string().min(1),
              before: z.number().nullable(),
              after: z.number(),
            })
          )
          .max(MAX_VCS_PATCH_VIEWS_PER_TABLE)
          .optional(),
      })
    )
    .max(MAX_VCS_PATCH_RECORDS_PER_TABLE),
  recordsDeleted: z
    .array(
      z.object({
        recordId: z.string().min(1),
        before: recordVcsSnapshotSchema.extend({
          version: z.number().int().nonnegative(),
        }),
      })
    )
    .max(MAX_VCS_PATCH_RECORDS_PER_TABLE),
});

export const baseVcsPatchSchema = z
  .object({
    tablesAdded: z.array(tableVcsSnapshotSchema).max(MAX_VCS_PATCH_TABLES),
    tablesDeleted: z
      .array(
        z.object({
          tableId: z.string().min(1),
          tableName: z.string().optional(),
          before: tableVcsSnapshotSchema,
        })
      )
      .max(MAX_VCS_PATCH_TABLES),
    tablesUpdated: z.array(tableVcsPatchSchema).max(MAX_VCS_PATCH_TABLES),
  })
  .superRefine((patch, ctx) => {
    let totalRecordOps = 0;
    for (const table of patch.tablesAdded) {
      totalRecordOps += table.records.length;
    }
    for (const tp of patch.tablesUpdated) {
      totalRecordOps +=
        tp.recordsAdded.length + tp.recordsUpdated.length + tp.recordsDeleted.length;
    }
    if (totalRecordOps > MAX_VCS_PATCH_TOTAL_RECORDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `VCS patch record operation count (${String(totalRecordOps)}) exceeds limit (${String(MAX_VCS_PATCH_TOTAL_RECORDS)})`,
      });
    }
  });

export const baseVcsPushRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  patch: baseVcsPatchSchema,
  message: z.string().max(500).optional(),
  originPushId: z.string().max(128).optional(),
  dryRun: z.boolean().optional(),
});

export const vcsHydrateRecordsBodySchema = z.object({
  baseId: z.string().min(1),
  tableId: z.string().min(1),
  records: z.array(recordVcsSnapshotSchema),
  mode: z.enum(['scalar-insert', 'link-update']).optional(),
});
