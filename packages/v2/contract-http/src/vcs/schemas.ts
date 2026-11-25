import {
  baseVcsPatchSchema,
  baseVcsPushRequestSchema,
  baseVcsSnapshotSchema,
  recordVcsSnapshotSchema,
  tableVcsSnapshotSchema,
  type IBaseVcsPatch,
  type IBaseVcsSnapshot,
  type IVcsCloneRecordsChunk,
  type IVcsHeadInfo,
  type IVcsIncrementalChanges,
  type IVcsPushResult,
  type VcsRemoteMode,
} from '@teable/v2-vcs';
import { z } from 'zod';

export const vcsRemoteModeSchema = z.enum(['v2-vcs', 'openapi-readonly']);

export const vcsEnableInputSchema = z.object({
  baseId: z.string().min(1),
});

export const vcsEnableOutputSchema = z.object({
  baseId: z.string().min(1),
  enabled: z.boolean(),
  headRevision: z.number().int().nonnegative(),
  enabledAtRevision: z.number().int().nonnegative(),
});

export const vcsHeadInputSchema = z.object({
  baseId: z.string().min(1),
});

export const vcsHeadInfoSchema: z.ZodType<IVcsHeadInfo> = z.object({
  baseId: z.string().min(1),
  baseName: z.string().min(1),
  headRevision: z.number().int().nonnegative(),
  vcsEnabled: z.boolean().optional(),
  remoteMode: vcsRemoteModeSchema,
});

export const vcsCloneInputSchema = z.object({
  baseId: z.string().min(1),
  tables: z.union([z.string(), z.array(z.string())]).optional(),
  tableIds: z.union([z.string(), z.array(z.string())]).optional(),
  includeRecords: z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).optional(),
});

export const vcsCloneOutputSchema: z.ZodType<{
  readonly snapshot: IBaseVcsSnapshot;
  readonly remoteMode: VcsRemoteMode;
}> = z.object({
  snapshot: baseVcsSnapshotSchema,
  remoteMode: vcsRemoteModeSchema,
});

export const vcsCloneRecordsInputSchema = z.object({
  baseId: z.string().min(1),
  tableId: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(2_000).optional(),
});

export const vcsCloneRecordsOutputSchema: z.ZodType<IVcsCloneRecordsChunk> = z.object({
  tableId: z.string().min(1),
  records: z.array(recordVcsSnapshotSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
});

export const vcsChangesInputSchema = z.object({
  baseId: z.string().min(1),
  cursor: z.string().trim().min(1),
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(10_000).optional(),
  tables: z.union([z.string(), z.array(z.string())]).optional(),
  tableIds: z.union([z.string(), z.array(z.string())]).optional(),
});

export const vcsTableRecordDeltaSchema = z.object({
  tableId: z.string().min(1),
  upserts: z.array(recordVcsSnapshotSchema),
  deletes: z.array(z.string()),
});

export const vcsAccessScopeSchema = z.object({
  tables: z.record(
    z.string(),
    z.object({
      tableId: z.string().min(1),
      readableFieldIds: z.array(z.string()).optional(),
      isRowFiltered: z.boolean().optional(),
    })
  ),
});

export const vcsIncrementalChangesSchema: z.ZodType<IVcsIncrementalChanges> = z.object({
  baseId: z.string().min(1),
  baseName: z.string().min(1),
  fromRevision: z.number().int().nonnegative(),
  toRevision: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional(),
  hasChanges: z.boolean().optional(),
  originPushIds: z.array(z.string()).optional(),
  requiresFullSync: z.boolean(),
  fullSnapshot: baseVcsSnapshotSchema.optional(),
  upsertedTables: z.array(tableVcsSnapshotSchema),
  deletedTableIds: z.array(z.string()),
  recordDeltas: z.array(vcsTableRecordDeltaSchema),
  accessScope: vcsAccessScopeSchema.optional(),
});

export interface IVcsPushHttpInput {
  readonly baseId: string;
  readonly baseRevision: number;
  readonly patch: IBaseVcsPatch;
  readonly message?: string;
  readonly originPushId?: string;
  readonly dryRun?: boolean;
}

export const vcsPushInputSchema: z.ZodType<IVcsPushHttpInput> = baseVcsPushRequestSchema.extend({
  baseId: z.string().min(1),
});

export const vcsPatchSummarySchema = z.object({
  tablesAdded: z.number().int().nonnegative(),
  tablesDeleted: z.number().int().nonnegative(),
  tablesRenamed: z.number().int().nonnegative(),
  fieldsAdded: z.number().int().nonnegative(),
  fieldsUpdated: z.number().int().nonnegative(),
  fieldsDeleted: z.number().int().nonnegative(),
  viewsAdded: z.number().int().nonnegative(),
  viewsUpdated: z.number().int().nonnegative(),
  viewsDeleted: z.number().int().nonnegative(),
  recordsAdded: z.number().int().nonnegative(),
  recordsUpdated: z.number().int().nonnegative(),
  recordsDeleted: z.number().int().nonnegative(),
  cellChanges: z.number().int().nonnegative(),
});

export const vcsPushCasConflictSchema = z.object({
  key: z.string(),
  tableId: z.string(),
  entityType: z.enum(['table', 'field', 'view', 'record', 'cell']),
  entityId: z.string(),
  fieldId: z.string().optional(),
  before: z.unknown(),
  current: z.unknown(),
});

export const vcsPushResultSchema: z.ZodType<IVcsPushResult> = z.object({
  ok: z.boolean(),
  dryRun: z.boolean(),
  baseId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  newRevision: z.number().int().nonnegative(),
  commitId: z.string().optional(),
  originPushId: z.string().optional(),
  rebased: z.boolean(),
  completedBatches: z.number().int().nonnegative().optional(),
  totalBatches: z.number().int().positive().optional(),
  summary: vcsPatchSummarySchema,
  conflictError: z
    .object({
      code: z.enum(['vcs.cas_conflict', 'vcs.non_fast_forward']),
      message: z.string(),
      headRevision: z.number().int().nonnegative(),
      overlappingKeys: z.array(z.string()),
      conflicts: z.array(vcsPushCasConflictSchema).optional(),
    })
    .optional(),
});

export type IVcsEnableHttpInput = z.input<typeof vcsEnableInputSchema>;
export type IVcsEnableHttpOutput = z.output<typeof vcsEnableOutputSchema>;
export type IVcsHeadHttpInput = z.input<typeof vcsHeadInputSchema>;
export type IVcsCloneHttpInput = z.input<typeof vcsCloneInputSchema>;
export type IVcsCloneRecordsHttpInput = z.input<typeof vcsCloneRecordsInputSchema>;
export type IVcsChangesHttpInput = z.input<typeof vcsChangesInputSchema>;

const revision = z.number().int().nonnegative().safe();
const queryRevision = z.union([
  revision,
  z.string().regex(/^\d+$/).transform(Number).pipe(revision),
]);

export const vcsCheckoutInputSchema = vcsHeadInputSchema
  .extend({ revision: queryRevision })
  .strict();
export const vcsDiffInputSchema = vcsHeadInputSchema
  .extend({ from: queryRevision, to: queryRevision })
  .strict();
export const vcsRollbackInputSchema = vcsHeadInputSchema
  .extend({
    revision,
    confirmation: z.string().min(1).max(256).optional(),
    originPushId: z.string().min(1).max(128).optional(),
  })
  .strict();

const historyPatch: z.ZodType<IBaseVcsPatch> = baseVcsPatchSchema;

export const vcsDiffOutputSchema = z.object({
  from: revision,
  to: revision,
  mergeBase: revision.nullable(),
  patch: historyPatch,
  summary: vcsPatchSummarySchema,
});

export const vcsRollbackOutputSchema = z.discriminatedUnion('dryRun', [
  z.object({
    dryRun: z.literal(true),
    headRevision: revision,
    revision,
    confirmation: z.string(),
    patch: historyPatch,
    summary: vcsPatchSummarySchema,
  }),
  z.object({ dryRun: z.literal(false), result: vcsPushResultSchema }),
]);
export type IVcsCheckoutInput = z.output<typeof vcsCheckoutInputSchema>;
export type IVcsDiffInput = z.output<typeof vcsDiffInputSchema>;
export type IVcsRollbackInput = z.output<typeof vcsRollbackInputSchema>;

export type IVcsHistoryDiffOutput = z.output<typeof vcsDiffOutputSchema>;
export type IVcsRollbackOutput = z.output<typeof vcsRollbackOutputSchema>;
