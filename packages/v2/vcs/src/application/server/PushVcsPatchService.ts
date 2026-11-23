import { randomUUID } from 'node:crypto';
import {
  v2CoreTokens,
  type BaseId,
  type DomainError,
  type IBaseRepository,
  type ICommandBus,
  type IDomainWriteTransaction,
  type IExecutionContext,
  type IQueryBus,
  type LinkField,
  type Table,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { countPatchRecordOps, MAX_SINGLE_TX_PUSH_RECORD_OPS } from '../../domain/chunkPatch';
import { isEmptyPatch, summarizePatch } from '../../domain/diffSnapshots';
import { vcsDomainError } from '../../domain/errors';
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
} from '../../ports/server';
import { v2VcsServerTokens } from '../../ports/tokens';
import {
  buildTableVcsSnapshot,
  listSelectedTableRecordsForVcs,
  mapTableFieldsToVcsSnapshots,
  mapTableViewsFromDomain,
} from '../../snapshot/tableToVcsSnapshot';
import { listLiveTablesInBase, resolveExistingBase } from './serverHelpers';

export const pushVcsPatchInputSchema = baseVcsPushRequestSchema.extend({
  baseId: z.string().min(1),
});

export type IPushVcsPatchInput = z.input<typeof pushVcsPatchInputSchema>;
type IParsedPushInput = z.output<typeof pushVcsPatchInputSchema>;

const DRY_RUN_ROLLBACK_CODE = 'vcs.dry_run_rollback';

const resolveMaxSingleTxPushOps = (): number => {
  const raw = Number(process.env.TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS);
  return Number.isInteger(raw) && raw > 0 ? raw : MAX_SINGLE_TX_PUSH_RECORD_OPS;
};

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

const collectMetadataLockTargets = (patch: IBaseVcsPatch): IVcsPushMetadataLockTargets => {
  const tableIds = Array.from(
    new Set([
      ...patch.tablesDeleted.map((t) => t.tableId),
      ...patch.tablesUpdated.map((t) => t.tableId),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const fieldIds = Array.from(
    new Set([
      ...patch.tablesUpdated.flatMap((tp) => [
        ...tp.fieldsUpdated.map((f) => f.fieldId),
        ...tp.fieldsDeleted.map((f) => f.fieldId),
      ]),
      ...patch.tablesDeleted.flatMap((d) => d.before.fields.map((f) => f.id)),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const viewIds = Array.from(
    new Set([
      ...patch.tablesUpdated.flatMap((tp) => [
        ...tp.viewsUpdated.map((v) => v.viewId),
        ...tp.viewsDeleted.map((v) => v.viewId),
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
        ...tp.recordsUpdated.map((r) => r.recordId),
        ...tp.recordsDeleted.map((r) => r.recordId),
      ])
    ).sort((a, b) => a.localeCompare(b));
    if (touchedRecordIds.length === 0) continue;
    physicalLocks.push({
      dbTableName: dbNameRes.value,
      recordIds: touchedRecordIds,
    });
    collectLinkTableLocks(liveTable, dbNameRes.value, touchedRecordIds, physicalLocks);
  }

  return physicalLocks;
};

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
    private readonly accessPolicy: IVcsAccessPolicy
  ) {}

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
    summary: IBaseVcsPatchSummary
  ): Promise<Result<IVcsPushResult, DomainError>> {
    return this.domainWriteTransaction.withBatchTransaction<IVcsPushResult>(
      ctx,
      async (batchCtx) => {
        const lockedHeadRes = await this.logRepository.lockPushMetadata(batchCtx, baseId, {
          tableIds: [],
          fieldIds: [],
          viewIds: [],
        });
        if (lockedHeadRes.isErr()) return err(lockedHeadRes.error);

        const headRevision = lockedHeadRes.value.headRevision;
        if (input.baseRevision > headRevision) {
          return err(
            vcsDomainError.conflict({
              code: 'vcs.non_fast_forward',
              message: `Client baseRevision (${input.baseRevision}) exceeds remote headRevision (${headRevision}).`,
              details: {
                baseId: input.baseId,
                baseRevision: input.baseRevision,
                headRevision,
                overlappingKeys: [],
              },
            })
          );
        }

        return ok({
          ok: true,
          dryRun: Boolean(input.dryRun),
          baseId: input.baseId,
          baseRevision: input.baseRevision,
          newRevision: headRevision,
          rebased: false,
          summary,
        });
      },
      { scope: 'data' }
    );
  }

  private async executePushInTransaction(params: {
    readonly batchCtx: IExecutionContext;
    readonly baseId: BaseId;
    readonly baseName: string;
    readonly input: IParsedPushInput;
    readonly originPushId: string;
    readonly summary: IBaseVcsPatchSummary;
    readonly setDryRunResult: (result: IVcsPushResult) => void;
  }): Promise<Result<IVcsPushResult, DomainError>> {
    const { batchCtx, baseId, baseName, input, originPushId, summary, setDryRunResult } = params;

    const authRes = await this.accessPolicy.assertCanApplyPatch(batchCtx, baseId, input.patch);
    if (authRes.isErr()) return err(authRes.error);

    const replayInTx = await this.logRepository.findCommitByOriginPushId(
      batchCtx,
      baseId,
      originPushId
    );
    if (replayInTx.isErr()) return err(replayInTx.error);
    if (replayInTx.value) {
      return ok(commitToPushResult(replayInTx.value, input.baseRevision));
    }

    const metaTargets = collectMetadataLockTargets(input.patch);
    const lockedHeadRes = await this.logRepository.lockPushMetadata(batchCtx, baseId, metaTargets);
    if (lockedHeadRes.isErr()) return err(lockedHeadRes.error);
    const headRevision = lockedHeadRes.value.headRevision;

    if (input.baseRevision > headRevision) {
      return err(
        vcsDomainError.conflict({
          code: 'vcs.non_fast_forward',
          message: `Client baseRevision (${input.baseRevision}) exceeds remote headRevision (${headRevision}).`,
          details: {
            baseId: input.baseId,
            baseRevision: input.baseRevision,
            headRevision,
            overlappingKeys: [],
          },
        })
      );
    }

    // Read table/field/view metadata AFTER locking base_vcs_head + table_meta + field + view rows.
    const tablesRes = await listLiveTablesInBase(this.queryBus, batchCtx, baseId);
    if (tablesRes.isErr()) return err(tablesRes.error);
    const liveTableMap = new Map(tablesRes.value.map((t) => [t.id().toString(), t]));

    const physicalLocks = collectPhysicalLockTargets(input.patch, liveTableMap);
    const physLockRes = await this.logRepository.lockPushPhysicalTargets(
      batchCtx,
      baseId,
      physicalLocks
    );
    if (physLockRes.isErr()) return err(physLockRes.error);

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

    const adapter = new V2EngineSyncAdapter({
      commandBus: this.commandBus,
      queryBus: this.queryBus,
      executionContext: batchCtx,
    });
    const applyRes = await adapter.applyPatch(input.baseId, input.patch, {
      baseName,
      context: batchCtx,
      skipCaptureSnapshot: true,
    });
    if (applyRes.isErr()) return err(applyRes.error);

    const commitRes = await this.logRepository.appendCommit(batchCtx, baseId, {
      expectedHeadRevision: headRevision,
      originPushId,
      actorId: batchCtx.actorId.toString(),
      ...(input.message !== undefined ? { message: input.message } : {}),
      summary,
    });
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
    rawInput: unknown
  ): Promise<Result<IVcsPushResult, DomainError>> {
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
    const authRes = await this.accessPolicy.assertCanApplyPatch(ctx, baseId, input.patch);
    if (authRes.isErr()) return err(authRes.error);

    const maxSingleTxOps = resolveMaxSingleTxPushOps();
    const patchRecordOps = countPatchRecordOps(input.patch);
    if (patchRecordOps > maxSingleTxOps) {
      return err(
        vcsDomainError.validation({
          code: 'vcs.patch_too_large_for_single_tx',
          message: `VCS patch record operation count (${String(patchRecordOps)}) exceeds single-transaction limit (${String(maxSingleTxOps)}); split the push into smaller topological batches.`,
          details: { patchRecordOps, maxSingleTxOps },
        })
      );
    }

    const originPushId = input.originPushId ?? `vcsp_${randomUUID().replace(/-/g, '')}`;
    const summary = summarizePatch(input.patch);

    const replayRes = await this.logRepository.findCommitByOriginPushId(ctx, baseId, originPushId);
    if (replayRes.isErr()) return err(replayRes.error);
    if (replayRes.value) {
      return ok(commitToPushResult(replayRes.value, input.baseRevision));
    }

    if (isEmptyPatch(input.patch)) {
      return this.handleEmptyPatch(ctx, baseId, input, summary);
    }

    let dryRunResult: IVcsPushResult | undefined;
    const txRes = await this.domainWriteTransaction.withBatchTransaction(
      ctx,
      async (batchCtx) =>
        this.executePushInTransaction({
          batchCtx,
          baseId,
          baseName: base.name().toString(),
          input,
          originPushId,
          summary,
          setDryRunResult: (res) => {
            dryRunResult = res;
          },
        }),
      { scope: 'data' }
    );

    if (txRes.isErr() && txRes.error.code === DRY_RUN_ROLLBACK_CODE && dryRunResult) {
      return ok(dryRunResult);
    }

    return txRes;
  }
}
