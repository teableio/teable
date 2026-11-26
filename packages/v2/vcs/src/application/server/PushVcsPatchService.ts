import { randomUUID } from 'node:crypto';
import {
  GetTableByIdQuery,
  RenameViewCommand,
  RestoreTableCommand,
  Table,
  TableId,
  UpdateFieldCommand,
  ViewId,
  failBatchResultIfActive,
  getUnitOfWorkTransaction,
  v2CoreTokens,
  withTableSchemaCoordination,
  type BaseId,
  type DomainError,
  type GetTableByIdResult,
  type IBaseRepository,
  type ICommandBus,
  type IDomainWriteTransaction,
  type IExecutionContext,
  type IQueryBus,
  type IRecordOrderColumnPreparer,
  type ITableRepository,
  type ITableSchemaCoordination,
  type IUpdateFieldCommandInput,
  type LinkField,
  type RestoreTableResult,
  type TableSchemaCoordinationMode,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { collectVcsPatchAddedIds } from '../../domain/accessPolicy';
import { countPatchRecordOps, MAX_SINGLE_TX_PUSH_RECORD_OPS } from '../../domain/chunkPatch';
import { isEmptyPatch, summarizePatch } from '../../domain/diffSnapshots';
import { vcsDomainError, vcsWriteBusyError } from '../../domain/errors';
import {
  collectDeletedTableCasConflicts,
  collectTableFieldCasConflicts,
  collectTableRecordCasConflicts,
  collectTableViewCasConflicts,
} from '../../domain/liveCas';
import {
  baseVcsPushRequestSchema,
  type IBaseVcsPatch,
  type IBaseVcsPatchSummary,
  type IDeletedTableVcsPatch,
  type ITableVcsPatch,
  type IVcsPushCasConflict,
  type IVcsPushResult,
} from '../../domain/types';
import { V2EngineSyncAdapter } from '../../engine/V2EngineSyncAdapter';
import type {
  IBaseVcsLogRepository,
  IVcsAccessPolicy,
  IVcsCommit,
  IVcsPushMetadataLockTargets,
  IVcsPushPhysicalTableLockTarget,
  IVcsRollbackRestore,
} from '../../ports/server';
import { v2VcsServerTokens } from '../../ports/tokens';
import { BaseVcsCheckpointReader } from '../../snapshot/BaseVcsCheckpointReader';
import {
  buildTableVcsSnapshot,
  listSelectedTableRecordsForVcs,
  mapTableFieldsToVcsSnapshots,
  mapTableViewsFromDomain,
} from '../../snapshot/tableToVcsSnapshot';
import {
  listLiveTablesInBase,
  listTableDeletionDependencies,
  resolveExistingBase,
} from './serverHelpers';

export const pushVcsPatchInputSchema = baseVcsPushRequestSchema.extend({
  baseId: z.string().min(1),
});

export type IPushVcsPatchInput = z.input<typeof pushVcsPatchInputSchema>;
type IParsedPushInput = z.output<typeof pushVcsPatchInputSchema>;

function checkPushHead(input: IParsedPushInput, headRevision: number, requireExactHead: boolean) {
  if (
    input.baseRevision > headRevision ||
    (requireExactHead && input.baseRevision !== headRevision)
  ) {
    return err(
      vcsDomainError.conflict({
        code: 'vcs.non_fast_forward',
        message: `Client revision ${input.baseRevision} cannot be applied to head ${headRevision}.`,
        details: {
          baseId: input.baseId,
          baseRevision: input.baseRevision,
          headRevision,
          overlappingKeys: [],
        },
      })
    );
  }
  return ok(undefined);
}

const DRY_RUN_ROLLBACK_CODE = 'vcs.dry_run_rollback';

const notEnabled = (baseId: BaseId) =>
  vcsDomainError.conflict({
    code: 'vcs.not_enabled',
    message: 'Base VCS is not enabled on this base; enable VCS first.',
    details: { baseId: baseId.toString() },
  });

const originPushIdUsed = () =>
  vcsDomainError.conflict({
    code: 'vcs.origin_push_id_used',
    message: 'An exact-head push requires an unused origin push ID.',
  });

export function validateSingleTxPushRecordOps(patch: IBaseVcsPatch): Result<void, DomainError> {
  const configured = Number(process.env.TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS);
  const maxSingleTxOps =
    Number.isInteger(configured) && configured > 0 ? configured : MAX_SINGLE_TX_PUSH_RECORD_OPS;
  const patchRecordOps = countPatchRecordOps(patch);
  if (patchRecordOps <= maxSingleTxOps) return ok(undefined);
  return err(
    vcsDomainError.validation({
      code: 'vcs.patch_too_large_for_single_tx',
      message: `VCS patch record operation count (${String(patchRecordOps)}) exceeds single-transaction limit (${String(maxSingleTxOps)}); split the push into smaller topological batches.`,
      details: { patchRecordOps, maxSingleTxOps },
    })
  );
}

const commitToPushResult = (commit: IVcsCommit, baseRevision: number): IVcsPushResult => ({
  ok: true,
  dryRun: false,
  baseId: commit.baseId,
  baseRevision,
  newRevision: commit.revision,
  commitId: commit.commitId,
  ...(commit.originPushId ? { originPushId: commit.originPushId } : {}),
  rebased: commit.parentRevision > baseRevision,
  summary: commit.summary,
});

const collectMetadataLockTargets = (
  patch: IBaseVcsPatch,
  restore?: IVcsRollbackRestore
): IVcsPushMetadataLockTargets => {
  const added = restore && collectVcsPatchAddedIds(patch);
  const tableIds = Array.from(
    new Set([
      ...(added?.tableIds ?? []),
      ...patch.tablesDeleted.map((t) => t.tableId),
      ...patch.tablesUpdated.map((t) => t.tableId),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const fieldIds = Array.from(
    new Set([
      ...(added?.fieldIds ?? []),
      ...patch.tablesUpdated.flatMap((tp) => [
        ...tp.fieldsUpdated.map((f) => f.fieldId),
        ...tp.fieldsDeleted.map((f) => f.fieldId),
      ]),
      ...patch.tablesDeleted.flatMap((d) => d.before.fields.map((f) => f.id)),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const viewIds = Array.from(
    new Set([
      ...(added?.viewIds ?? []),
      ...patch.tablesUpdated.flatMap((tp) => [
        ...tp.viewsUpdated.map((v) => v.viewId),
        ...tp.viewsDeleted.map((v) => v.viewId),
        ...tp.recordsUpdated.flatMap((row) =>
          (row.orderChanges ?? []).map((change) => change.viewId)
        ),
      ]),
      ...patch.tablesDeleted.flatMap((d) => d.before.views.map((v) => v.id)),
    ])
  ).sort((a, b) => a.localeCompare(b));

  return { tableIds, fieldIds, viewIds };
};

const collectLinkTableLocks = (
  liveTable: Table,
  dbTableName: string,
  touchedRecordIds: string[],
  physicalLocks: IVcsPushPhysicalTableLockTarget[]
): void => {
  for (const field of liveTable.getFields()) {
    if (field.type().toString() !== 'link') continue;
    const cfgRes = (field as unknown as LinkField).configDto();
    if (cfgRes.isErr()) continue;
    const { fkHostTableName, selfKeyName } = cfgRes.value;
    if (fkHostTableName && selfKeyName && fkHostTableName !== dbTableName) {
      physicalLocks.push({
        dbTableName: fkHostTableName,
        recordIds: touchedRecordIds,
        keyColumn: selfKeyName,
      });
    }
  }
};

const collectPhysicalLockTargets = (
  patch: IBaseVcsPatch,
  liveTableMap: ReadonlyMap<string, Table>
): IVcsPushPhysicalTableLockTarget[] => {
  const physicalLocks: IVcsPushPhysicalTableLockTarget[] = [];
  for (const delTable of [...patch.tablesDeleted].sort((a, b) =>
    a.tableId.localeCompare(b.tableId)
  )) {
    const dbNameRes = liveTableMap
      .get(delTable.tableId)
      ?.dbTableName()
      .andThen((n) => n.value());
    if (dbNameRes?.isOk()) {
      physicalLocks.push({ dbTableName: dbNameRes.value });
    }
  }

  for (const tp of [...patch.tablesUpdated].sort((a, b) => a.tableId.localeCompare(b.tableId))) {
    const liveTable = liveTableMap.get(tp.tableId);
    const dbNameRes = liveTable?.dbTableName().andThen((n) => n.value());
    if (!liveTable || !dbNameRes?.isOk()) continue;
    const touchedRecordIds = Array.from(
      new Set([
        ...tp.recordsAdded.map((r) => r.id),
        ...tp.recordsUpdated.map((r) => r.recordId),
        ...tp.recordsDeleted.map((r) => r.recordId),
      ])
    ).sort((a, b) => a.localeCompare(b));
    if (touchedRecordIds.length === 0) continue;
    physicalLocks.push({ dbTableName: dbNameRes.value, recordIds: touchedRecordIds });
    collectLinkTableLocks(liveTable, dbNameRes.value, touchedRecordIds, physicalLocks);
  }

  return physicalLocks;
};

function effectivePushPatch(patch: IBaseVcsPatch, restore?: IVcsRollbackRestore): IBaseVcsPatch {
  if (!restore?.tableIds.length) return patch;
  // Restoring a trashed table brings back its retained rows. Only the delta from
  // those rows to the historical target generates record operations.
  const restored = new Set(restore.tableIds);
  return {
    ...patch,
    tablesAdded: patch.tablesAdded.filter((table) => !restored.has(table.id)),
    tablesUpdated: [...patch.tablesUpdated, ...restore.tableChanges],
  };
}

function patchCoordinationMode(patch: IBaseVcsPatch): TableSchemaCoordinationMode {
  const changesSchema =
    patch.tablesAdded.length > 0 ||
    patch.tablesDeleted.length > 0 ||
    patch.tablesUpdated.some(
      (table) =>
        table.nameChange !== undefined ||
        table.fieldsAdded.length > 0 ||
        table.fieldsUpdated.length > 0 ||
        table.fieldsDeleted.length > 0 ||
        table.viewsAdded.length > 0 ||
        table.viewsUpdated.length > 0 ||
        table.viewsDeleted.length > 0
    );
  return changesSchema ? 'exclusive' : 'shared';
}

function* displacedRollbackViews(patch: IBaseVcsPatch, tables: ReadonlyMap<string, Table>) {
  for (const change of patch.tablesUpdated) {
    const targets = new Map([
      ...change.viewsAdded.map((view) => [view.name, view.id] as const),
      ...change.viewsUpdated.map(({ after }) => [after.name, after.id] as const),
    ]);
    if (!targets.size) continue;
    const views = tables.get(change.tableId)?.views() ?? [];
    const reserved = new Set([...targets.keys(), ...views.map((v) => v.name().toString())]);
    let suffix = 0;
    for (const view of views) {
      const id = view.id().toString();
      const targetId = targets.get(view.name().toString());
      if (targetId === undefined || targetId === id) continue;
      let name: string;
      do {
        name = `__vcs_rollback_${suffix++}`;
      } while (reserved.has(name));
      reserved.add(name);
      yield { tableId: change.tableId, viewId: id, name };
    }
  }
}

// A restored field may need its historical values before NOT NULL or UNIQUE can be
// enforced. Its name may also be held by a field that the inverse renames or deletes.
function prepareRollbackFields(patch: IBaseVcsPatch, tables: ReadonlyMap<string, Table>) {
  const finish: IUpdateFieldCommandInput[] = [];
  const tablesUpdated = patch.tablesUpdated.map((change) => {
    if (!change.fieldsAdded.length) return change;
    const occupied = new Set(
      tables
        .get(change.tableId)
        ?.getFields()
        .map((field) => field.name().toString())
    );
    const reserved = new Set([
      ...occupied,
      ...change.fieldsAdded.map((f) => f.name),
      ...change.fieldsUpdated.map((f) => f.after.name),
    ]);
    const fieldsAdded = change.fieldsAdded.map((field) => {
      const rename = occupied.has(field.name);
      if (!rename && !field.notNull && !field.unique) return field;
      let name = field.name;
      if (rename) {
        name = field.id;
        while (reserved.has(name)) name += '_';
        reserved.add(name);
      }
      finish.push({
        tableId: change.tableId,
        fieldId: field.id,
        field: {
          ...(rename && { name: field.name }),
          ...(field.notNull && { notNull: true }),
          ...(field.unique && { unique: true }),
        },
      });
      return { ...field, name, notNull: false, unique: false };
    });
    return { ...change, fieldsAdded };
  });
  return { patch: { ...patch, tablesUpdated }, finish };
}

@injectable()
export class PushVcsPatchService {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: IBaseRepository,
    @inject(v2CoreTokens.commandBus)
    private readonly commandBus: ICommandBus,
    @inject(v2CoreTokens.queryBus)
    private readonly queryBus: IQueryBus,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction,
    @inject(v2VcsServerTokens.logRepository)
    private readonly logRepository: IBaseVcsLogRepository,
    @inject(v2VcsServerTokens.accessPolicy)
    private readonly accessPolicy: IVcsAccessPolicy,
    @inject(BaseVcsCheckpointReader)
    private readonly checkpoints: BaseVcsCheckpointReader,
    @inject(v2CoreTokens.recordOrderColumnPreparer)
    private readonly orderColumns: IRecordOrderColumnPreparer,
    @inject(v2CoreTokens.tableRepository)
    private readonly tables: ITableRepository,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly coordination: ITableSchemaCoordination
  ) {}

  async withWriteCoordination<T>(
    context: IExecutionContext,
    tableIds: readonly string[],
    deletedTableIds: readonly string[],
    mode: TableSchemaCoordinationMode,
    work: (context: IExecutionContext) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    const dependencies = await listTableDeletionDependencies(this.tables, context, deletedTableIds);
    if (dependencies.isErr()) return failBatchResultIfActive(context, err(dependencies.error));
    const result = await withTableSchemaCoordination(
      context,
      this.coordination,
      [...tableIds, ...dependencies.value],
      mode,
      work
    );
    // Deletion can coordinate tables outside the caller's visible base.
    if (result.isErr() && result.error.code.startsWith('schema_coordination.')) {
      const { code, message, tags } = result.error;
      const publicError = tags.includes('conflict')
        ? vcsDomainError.conflict
        : tags.includes('invariant')
          ? vcsDomainError.invariant
          : vcsDomainError.infrastructure;
      return failBatchResultIfActive(
        context,
        err(publicError({ code, message, cause: result.error }))
      );
    }
    return failBatchResultIfActive(context, result);
  }

  async prepareRollbackOrderColumns(
    ctx: IExecutionContext,
    baseId: BaseId,
    targets: ReadonlyMap<string, ReadonlySet<string>>
  ): Promise<Result<void, DomainError>> {
    for (const [tableId, viewIds] of targets) {
      const id = TableId.create(tableId);
      if (id.isErr()) return err(id.error);
      const builder = Table.specs(baseId);
      builder.byIds([id.value]);
      const spec = builder.build();
      if (spec.isErr()) return err(spec.error);
      // A retained table still owns its physical rows while it is in the trash.
      const table = await this.tables.findOne(ctx, spec.value, { state: 'all' });
      if (table.isErr()) return err(table.error);
      for (const viewId of viewIds) {
        const view = ViewId.create(viewId);
        if (view.isErr()) return err(view.error);
        const prepared = await this.orderColumns.prepareOrderColumn(ctx, table.value, view.value);
        if (prepared.isErr()) return err(prepared.error);
      }
    }
    return ok(undefined);
  }

  private async prepareExistingOrderColumns(
    ctx: IExecutionContext,
    baseId: string,
    patch: IBaseVcsPatch
  ): Promise<Result<ReadonlyMap<string, ReadonlySet<string>>, DomainError>> {
    const newViewOrders = new Map<string, Set<string>>();
    for (const tp of patch.tablesUpdated) {
      const viewIds = new Set<string>();
      for (const row of tp.recordsAdded) {
        for (const viewId of Object.keys(row.orders ?? {})) viewIds.add(viewId);
      }
      for (const row of tp.recordsUpdated) {
        for (const change of row.orderChanges ?? []) viewIds.add(change.viewId);
      }
      for (const view of tp.viewsAdded) {
        if (!viewIds.delete(view.id)) continue;
        let added = newViewOrders.get(tp.tableId);
        if (!added) {
          added = new Set<string>();
          newViewOrders.set(tp.tableId, added);
        }
        added.add(view.id);
      }
      if (!viewIds.size) continue;
      const query = GetTableByIdQuery.create({ baseId, tableId: tp.tableId });
      if (query.isErr()) return err(query.error);
      const result = await this.queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
        ctx,
        query.value
      );
      if (result.isErr()) return err(result.error);
      const { table } = result.value;
      for (const rawId of viewIds) {
        const id = ViewId.create(rawId);
        if (id.isErr()) return err(id.error);
        const view = table.getView(id.value);
        if (view.isErr()) return err(view.error);
        const prepared = await this.orderColumns.prepareOrderColumn(ctx, table, id.value);
        if (prepared.isErr()) return err(prepared.error);
      }
    }
    return ok(newViewOrders);
  }

  private async collectRecordUpdateCasConflicts(params: {
    readonly ctx: IExecutionContext;
    readonly tp: ITableVcsPatch;
    readonly liveTable: Table;
    readonly liveFields: readonly import('../../domain/types').IFieldVcsSnapshot[];
    readonly liveFieldMap: ReadonlyMap<string, import('../../domain/types').IFieldVcsSnapshot>;
  }): Promise<Result<IVcsPushCasConflict[], DomainError>> {
    const { ctx, tp, liveTable, liveFields, liveFieldMap } = params;
    const recordIdsToCheck = Array.from(
      new Set([
        ...tp.recordsAdded.map((r) => r.id),
        ...tp.recordsUpdated.map((r) => r.recordId),
        ...tp.recordsDeleted.map((r) => r.recordId),
      ])
    );
    if (recordIdsToCheck.length === 0) {
      return ok([]);
    }

    // Read unmasked live records under lock so hidden fields/version bumps cannot be bypassed in CAS.
    const liveRecordsRes = await listSelectedTableRecordsForVcs(
      this.queryBus,
      ctx,
      liveTable,
      recordIdsToCheck,
      undefined
    );
    if (liveRecordsRes.isErr()) {
      return err(liveRecordsRes.error);
    }

    return ok(
      collectTableRecordCasConflicts(
        tp.tableId,
        tp,
        liveFieldMap,
        liveFields,
        new Map(liveRecordsRes.value.map((r) => [r.id, r]))
      )
    );
  }

  private async evaluateTableDeleteCas(
    ctx: IExecutionContext,
    delTable: IDeletedTableVcsPatch,
    liveTable: Table | undefined
  ): Promise<Result<IVcsPushCasConflict[], DomainError>> {
    if (!liveTable) {
      return ok(collectDeletedTableCasConflicts(delTable, undefined));
    }

    const liveSnapRes = await buildTableVcsSnapshot({
      queryBus: this.queryBus,
      context: ctx,
      table: liveTable,
      includeRecords: true,
    });
    if (liveSnapRes.isErr()) {
      return err(liveSnapRes.error);
    }

    return ok(collectDeletedTableCasConflicts(delTable, liveSnapRes.value));
  }

  private async evaluateTableUpdateCas(params: {
    readonly ctx: IExecutionContext;
    readonly tp: ITableVcsPatch;
    readonly liveTable: Table | undefined;
  }): Promise<Result<IVcsPushCasConflict[], DomainError>> {
    const { ctx, tp, liveTable } = params;
    if (!liveTable) {
      return ok([
        {
          key: `${tp.tableId}:table:${tp.tableId}`,
          tableId: tp.tableId,
          entityType: 'table',
          entityId: tp.tableId,
          before: tp,
          current: null,
        },
      ]);
    }

    const conflicts: IVcsPushCasConflict[] = [];
    if (tp.nameChange && liveTable.name().toString() !== tp.nameChange.from) {
      conflicts.push({
        key: `${tp.tableId}:table:${tp.tableId}`,
        tableId: tp.tableId,
        entityType: 'table',
        entityId: tp.tableId,
        before: tp.nameChange.from,
        current: liveTable.name().toString(),
      });
    }

    const liveFieldsRes = mapTableFieldsToVcsSnapshots(liveTable);
    if (liveFieldsRes.isErr()) return err(liveFieldsRes.error);
    const liveFields = liveFieldsRes.value;
    const liveFieldMap = new Map(liveFields.map((f) => [f.id, f]));
    conflicts.push(...collectTableFieldCasConflicts(tp.tableId, tp, liveFieldMap));

    if (tp.viewsAdded.length > 0 || tp.viewsUpdated.length > 0 || tp.viewsDeleted.length > 0) {
      const liveViewsRes = mapTableViewsFromDomain(liveTable);
      if (liveViewsRes.isErr()) return err(liveViewsRes.error);
      conflicts.push(
        ...collectTableViewCasConflicts(
          tp.tableId,
          tp,
          new Map(liveViewsRes.value.map((v) => [v.id, v]))
        )
      );
    }

    const recConflictsRes = await this.collectRecordUpdateCasConflicts({
      ctx,
      tp,
      liveTable,
      liveFields,
      liveFieldMap,
    });
    if (recConflictsRes.isErr()) return err(recConflictsRes.error);
    conflicts.push(...recConflictsRes.value);

    return ok(conflicts);
  }

  private async evaluateLiveCas(params: {
    readonly ctx: IExecutionContext;
    readonly patch: IBaseVcsPatch;
    readonly liveTableMap: ReadonlyMap<string, Table>;
  }): Promise<Result<IVcsPushCasConflict[], DomainError>> {
    const { ctx, patch, liveTableMap } = params;
    const conflicts: IVcsPushCasConflict[] = [];

    for (const addTable of patch.tablesAdded) {
      const liveTable = liveTableMap.get(addTable.id);
      if (liveTable) {
        conflicts.push({
          key: `${addTable.id}:table:${addTable.id}`,
          tableId: addTable.id,
          entityType: 'table',
          entityId: addTable.id,
          before: null,
          current: { id: liveTable.id().toString(), name: liveTable.name().toString() },
        });
      }
    }

    for (const delTable of patch.tablesDeleted) {
      const delCasRes = await this.evaluateTableDeleteCas(
        ctx,
        delTable,
        liveTableMap.get(delTable.tableId)
      );
      if (delCasRes.isErr()) return err(delCasRes.error);
      conflicts.push(...delCasRes.value);
    }

    for (const tp of patch.tablesUpdated) {
      const tblConflictsRes = await this.evaluateTableUpdateCas({
        ctx,
        tp,
        liveTable: liveTableMap.get(tp.tableId),
      });
      if (tblConflictsRes.isErr()) return err(tblConflictsRes.error);
      conflicts.push(...tblConflictsRes.value);
    }

    return ok(conflicts);
  }

  private async handleEmptyPatch(
    ctx: IExecutionContext,
    baseId: BaseId,
    input: IParsedPushInput,
    summary: IBaseVcsPatchSummary,
    requireExactHead: boolean
  ): Promise<Result<IVcsPushResult, DomainError>> {
    const head = await this.logRepository.getHead(ctx, baseId, { requireAtomicStorage: true });
    if (head.isErr()) return err(head.error);
    if (!head.value.enabled) return err(notEnabled(baseId));

    const headRevision = head.value.headRevision;
    const checked = checkPushHead(input, headRevision, requireExactHead);
    if (checked.isErr()) return err(checked.error);

    return ok({
      ok: true,
      dryRun: Boolean(input.dryRun),
      baseId: input.baseId,
      baseRevision: input.baseRevision,
      newRevision: headRevision,
      rebased: false,
      summary,
    });
  }

  private async executePushInTransaction(params: {
    readonly batchCtx: IExecutionContext;
    readonly baseId: BaseId;
    readonly baseName: string;
    readonly input: IParsedPushInput;
    readonly effectivePatch: IBaseVcsPatch;
    readonly originPushId: string;
    readonly summary: IBaseVcsPatchSummary;
    readonly requireExactHead: boolean;
    readonly rollbackCommitId?: string;
    readonly restore?: IVcsRollbackRestore;
    readonly borrowedTransaction: boolean;
    readonly newViewOrders?: ReadonlyMap<string, ReadonlySet<string>>;
    readonly setDryRunResult: (result: IVcsPushResult) => void;
  }): Promise<Result<IVcsPushResult, DomainError>> {
    const { batchCtx, baseId, baseName, input, originPushId, summary, setDryRunResult } = params;

    const head = await this.logRepository.getHead(batchCtx, baseId, { requireAtomicStorage: true });
    if (head.isErr()) return err(head.error);
    if (!head.value.enabled) return err(notEnabled(baseId));

    const authRes = await this.accessPolicy.assertCanApplyPatch(
      batchCtx,
      baseId,
      input.patch,
      params.restore
    );
    if (authRes.isErr()) return err(authRes.error);

    const replayInTx = await this.logRepository.findCommitByOriginPushId(
      batchCtx,
      baseId,
      originPushId
    );
    if (replayInTx.isErr()) return err(replayInTx.error);
    if (replayInTx.value) {
      if (params.requireExactHead) return err(originPushIdUsed());
      return ok(commitToPushResult(replayInTx.value, input.baseRevision));
    }

    // Resolve physical names from the batch snapshot, then lock data before metadata and head.
    const tablesRes = await listLiveTablesInBase(this.queryBus, batchCtx, baseId);
    if (tablesRes.isErr()) return err(tablesRes.error);
    let liveTableMap = new Map(tablesRes.value.map((t) => [t.id().toString(), t]));
    const physLockRes = await this.logRepository.lockPushPhysicalTargets(
      batchCtx,
      baseId,
      collectPhysicalLockTargets(input.patch, liveTableMap),
      { waitForFirstTarget: !params.borrowedTransaction }
    );
    if (physLockRes.isErr()) return err(physLockRes.error);

    const metaTargets = collectMetadataLockTargets(input.patch, params.restore);
    const lockedHeadRes = await this.logRepository.lockPushMetadata(batchCtx, baseId, metaTargets);
    if (lockedHeadRes.isErr()) return err(lockedHeadRes.error);
    const headRevision = lockedHeadRes.value.headRevision;
    if (params.borrowedTransaction) {
      const stillAuthorized = await this.accessPolicy.assertCanApplyPatch(
        batchCtx,
        baseId,
        input.patch,
        params.restore
      );
      if (stillAuthorized.isErr()) return err(stillAuthorized.error);
      const committed = await this.logRepository.findCommitByOriginPushId(
        batchCtx,
        baseId,
        originPushId
      );
      if (committed.isErr()) return err(committed.error);
      if (committed.value) {
        if (params.requireExactHead) return err(originPushIdUsed());
        return ok(commitToPushResult(committed.value, input.baseRevision));
      }
    }
    const checked = checkPushHead(input, headRevision, params.requireExactHead);
    if (checked.isErr()) return err(checked.error);

    // A caller-owned batch need not use repeatable read. Re-resolve physical names behind
    // the metadata locks and try any changed targets without waiting while holding the head.
    if (params.borrowedTransaction) {
      const lockedTables = await listLiveTablesInBase(this.queryBus, batchCtx, baseId);
      if (lockedTables.isErr()) return err(lockedTables.error);
      liveTableMap = new Map(lockedTables.value.map((t) => [t.id().toString(), t]));
      const lockedPhysical = await this.logRepository.lockPushPhysicalTargets(
        batchCtx,
        baseId,
        collectPhysicalLockTargets(input.patch, liveTableMap)
      );
      if (lockedPhysical.isErr()) return err(lockedPhysical.error);
    }

    const casRes = await this.evaluateLiveCas({
      ctx: batchCtx,
      patch: input.patch,
      liveTableMap,
    });
    if (casRes.isErr()) return err(casRes.error);

    if (casRes.value.length > 0) {
      const overlappingKeys = casRes.value.map((c) => c.key);
      return err(
        vcsDomainError.conflict({
          code: 'vcs.cas_conflict',
          message: 'Live data differs from patch before values; pull and resolve conflicts first.',
          details: {
            baseId: input.baseId,
            baseRevision: input.baseRevision,
            headRevision,
            overlappingKeys,
            conflicts: casRes.value,
          },
        })
      );
    }

    const rebased = input.baseRevision < headRevision;
    if (input.dryRun) {
      setDryRunResult({
        ok: true,
        dryRun: true,
        baseId: input.baseId,
        baseRevision: input.baseRevision,
        newRevision: headRevision,
        rebased,
        summary,
      });
      return err(
        vcsDomainError.invariant({
          code: DRY_RUN_ROLLBACK_CODE,
          message: 'Dry run push rolled back after CAS validation',
        })
      );
    }

    const patch = params.effectivePatch;
    if (params.restore?.tableIds.length) {
      for (const tableId of params.restore.tableIds) {
        const command = RestoreTableCommand.create({ baseId: input.baseId, tableId });
        if (command.isErr()) return err(command.error);
        const result = await this.commandBus.execute<RestoreTableCommand, RestoreTableResult>(
          batchCtx,
          command.value
        );
        if (result.isErr()) return err(result.error);
        liveTableMap.set(tableId, result.value.table);
      }
    }

    if (params.restore) {
      // Free occupied names before upserting the target views, including name swaps.
      for (const rename of displacedRollbackViews(patch, liveTableMap)) {
        const command = RenameViewCommand.create(rename);
        if (command.isErr()) return err(command.error);
        const result = await this.commandBus.execute(batchCtx, command.value);
        if (result.isErr()) return err(result.error);
      }
    }

    if (params.newViewOrders?.size) {
      const targets = [];
      for (const [tableId, viewIds] of params.newViewOrders) {
        const table = liveTableMap.get(tableId);
        if (!table) {
          return err(
            vcsDomainError.invariant({ message: `Missing order target table ${tableId}.` })
          );
        }
        const dbName = table.dbTableName().andThen((name) => name.value());
        if (dbName.isErr()) return err(dbName.error);
        targets.push({
          table,
          viewIds,
          dbTableName: dbName.value,
          newViewOrderColumnCount: viewIds.size,
        });
      }
      // Only take the DDL lock after CAS and the bounded backfill admission check.
      // Upgrades must never wait while the transaction holds metadata and head locks.
      const locked = await this.logRepository.lockPushPhysicalTargets(batchCtx, baseId, targets);
      if (locked.isErr()) return err(locked.error);
      for (const { table, viewIds } of targets) {
        for (const viewId of viewIds) {
          const id = ViewId.create(viewId);
          if (id.isErr()) return err(id.error);
          const prepared = await this.orderColumns.prepareOrderColumn(batchCtx, table, id.value, {
            inTransaction: true,
          });
          if (prepared.isErr()) return err(prepared.error);
        }
      }
    }

    const adapter = new V2EngineSyncAdapter({
      commandBus: this.commandBus,
      queryBus: this.queryBus,
      executionContext: batchCtx,
      preserveAutoNumbers: params.rollbackCommitId !== undefined,
    });
    const fields = params.restore ? prepareRollbackFields(patch, liveTableMap) : undefined;
    const applyRes = await adapter.applyPatch(input.baseId, fields?.patch ?? patch, {
      baseName,
      context: batchCtx,
      skipCaptureSnapshot: true,
    });
    if (applyRes.isErr()) return err(applyRes.error);
    for (const update of fields?.finish ?? []) {
      const command = UpdateFieldCommand.create(update, { allowNoop: true });
      if (command.isErr()) return err(command.error);
      const result = await this.commandBus.execute(batchCtx, command.value);
      if (result.isErr()) return err(result.error);
    }

    const commitRes = await this.logRepository.appendCommit(
      batchCtx,
      baseId,
      {
        expectedHeadRevision: headRevision,
        commitId: params.rollbackCommitId,
        originPushId,
        actorId: batchCtx.actorId.toString(),
        ...(input.message !== undefined ? { message: input.message } : {}),
        summary,
      },
      this.checkpoints.capture
    );
    if (commitRes.isErr()) return err(commitRes.error);

    return ok({
      ok: true,
      dryRun: false,
      baseId: input.baseId,
      baseRevision: input.baseRevision,
      newRevision: commitRes.value.revision,
      commitId: commitRes.value.commitId,
      originPushId,
      rebased,
      summary,
    });
  }

  async execute(
    ctx: IExecutionContext,
    rawInput: unknown,
    options: {
      readonly requireExactHead?: boolean;
      readonly rollbackCommitId?: string;
      readonly restore?: IVcsRollbackRestore;
    } = {}
  ): Promise<Result<IVcsPushResult, DomainError>> {
    // Only internal confirmed rollback supplies a receipt, including for an empty inverse patch.
    const { rollbackCommitId } = options;
    const requireExactHead = options.requireExactHead === true || rollbackCommitId !== undefined;
    const parsed = pushVcsPatchInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return err(
        vcsDomainError.validation({
          code: 'vcs.invalid_push_payload',
          message: parsed.error.issues[0]?.message ?? 'Invalid VCS push payload',
          details: { issues: parsed.error.issues },
        })
      );
    }

    const input = parsed.data;
    const resolved = await resolveExistingBase(this.baseRepository, ctx, input.baseId);
    if (resolved.isErr()) return err(resolved.error);
    const { baseId, base } = resolved.value;

    // Authorization check runs BEFORE originPushId deduplication so unauthorized callers cannot probe commit receipts.
    const authRes = await this.accessPolicy.assertCanApplyPatch(
      ctx,
      baseId,
      input.patch,
      options.restore
    );
    if (authRes.isErr()) return err(authRes.error);

    const effectivePatch = effectivePushPatch(input.patch, options.restore);
    const size = validateSingleTxPushRecordOps(effectivePatch);
    if (size.isErr()) return err(size.error);

    const originPushId = input.originPushId ?? `vcsp_${randomUUID().replace(/-/g, '')}`;
    const summary = summarizePatch(input.patch);

    const replayRes = await this.logRepository.findCommitByOriginPushId(ctx, baseId, originPushId);
    if (replayRes.isErr()) return err(replayRes.error);
    if (replayRes.value) {
      if (requireExactHead) return err(originPushIdUsed());
      return ok(commitToPushResult(replayRes.value, input.baseRevision));
    }

    if (isEmptyPatch(input.patch) && rollbackCommitId === undefined) {
      return this.handleEmptyPatch(ctx, baseId, input, summary, requireExactHead);
    }

    let newViewOrders: ReadonlyMap<string, ReadonlySet<string>> | undefined;
    // Ordinary pushes can be the first writer to materialize a view's order column.
    // Historical rollback reuses the columns retained with the table.
    if (!options.restore && !input.dryRun) {
      const prepared = await this.prepareExistingOrderColumns(ctx, input.baseId, input.patch);
      if (prepared.isErr()) return err(prepared.error);
      newViewOrders = prepared.value;
    }

    let dryRunResult: IVcsPushResult | undefined;
    const apply = (context: IExecutionContext) =>
      this.domainWriteTransaction.withBatchTransaction(
        context,
        async (batchCtx) => {
          dryRunResult = undefined;
          return this.executePushInTransaction({
            batchCtx,
            baseId,
            baseName: base.name().toString(),
            input,
            effectivePatch,
            originPushId,
            summary,
            requireExactHead,
            rollbackCommitId,
            restore: options.restore,
            newViewOrders,
            borrowedTransaction: Boolean(
              getUnitOfWorkTransaction(context, 'data') || getUnitOfWorkTransaction(context, 'meta')
            ),
            setDryRunResult: (res) => {
              dryRunResult = res;
            },
          });
        },
        { scope: 'data', isolationLevel: 'repeatable read', onRetryExhausted: vcsWriteBusyError }
      );
    const txRes = input.dryRun
      ? await apply(ctx)
      : await this.withWriteCoordination(
          ctx,
          [
            ...input.patch.tablesAdded.map((table) => table.id),
            ...input.patch.tablesUpdated.map((table) => table.tableId),
            ...input.patch.tablesDeleted.map((table) => table.tableId),
          ],
          input.patch.tablesDeleted.map((table) => table.tableId),
          patchCoordinationMode(input.patch),
          apply
        );

    if (txRes.isErr() && txRes.error.code === DRY_RUN_ROLLBACK_CODE && dryRunResult) {
      return ok(dryRunResult);
    }
    if (
      txRes.isErr() &&
      txRes.error.code === 'schema_coordination.busy' &&
      input.originPushId &&
      !requireExactHead
    ) {
      // A duplicate request can commit before its coordination lease is released.
      const access = await this.accessPolicy.assertCanApplyPatch(ctx, baseId, input.patch);
      if (access.isErr()) return err(access.error);
      const receipt = await this.logRepository.findCommitByOriginPushId(ctx, baseId, originPushId);
      if (receipt.isErr()) return err(receipt.error);
      if (receipt.value) return ok(commitToPushResult(receipt.value, input.baseRevision));
    }

    return txRes;
  }
}
