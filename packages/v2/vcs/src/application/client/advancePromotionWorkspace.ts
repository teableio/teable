import type { DomainError } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { applyPatchToSnapshot } from '../../adapters/memory';
import { diffSnapshots, isEmptyPatch } from '../../domain/diffSnapshots';
import { vcsDomainError } from '../../domain/errors';
import { threeWayMerge } from '../../domain/threeWayMerge';
import {
  baseVcsPatchSchema,
  baseVcsSnapshotSchema,
  type IBaseVcsPatch,
  type IBaseVcsSnapshot,
} from '../../domain/types';
import type { IVcsLocalEnginePort, IVcsStateRepository } from '../../ports';
import { alignSourceSnapshot } from './DiffBaseVcsService';
import { alignPromotionWorkingSnapshot, loadVcsWorkspace } from './workspaceHelpers';

export const promotionAdvanceSchema = z.object({
  snapshot: baseVcsSnapshotSchema,
  applied: z
    .array(
      z.object({
        baseRevision: z.number().int().nonnegative(),
        appliedRevision: z.number().int().positive(),
        patch: baseVcsPatchSchema,
      })
    )
    .min(1),
});

/** A row restored from the target may collide with a row created independently in PGlite. */
function allocateLocalRecordNumbers(
  patch: IBaseVcsPatch,
  working: IBaseVcsSnapshot,
  merged: IBaseVcsSnapshot
): IBaseVcsPatch {
  if (!patch.tablesUpdated.some((table) => table.recordsAdded.length > 0)) return patch;
  const workingTables = new Map(working.tables.map((table) => [table.id, table]));
  const mergedTables = new Map(merged.tables.map((table) => [table.id, table]));
  return {
    ...patch,
    tablesUpdated: patch.tablesUpdated.map((table) => {
      if (!table.recordsAdded.length) return table;
      const local = workingTables.get(table.tableId)!;
      const views = mergedTables.get(table.tableId)!.views;
      // The engine restores additions before deleting old rows, so reserve every current number.
      const occupied = new Set<number>();
      let nextNumber = 0;
      for (const { autoNumber } of local.records) {
        if (autoNumber === undefined) continue;
        occupied.add(autoNumber);
        nextNumber = Math.max(nextNumber, autoNumber);
      }
      for (const { autoNumber } of table.recordsAdded) {
        if (autoNumber !== undefined) nextNumber = Math.max(nextNumber, autoNumber);
      }
      return {
        ...table,
        recordsAdded: table.recordsAdded.map((record) => {
          const { autoNumber } = record;
          if (autoNumber === undefined || !occupied.has(autoNumber)) return record;
          const orders = Object.fromEntries(
            views.map(({ id }) => [id, record.orders?.[id] ?? autoNumber])
          );
          return { ...record, autoNumber: ++nextNumber, orders };
        }),
      };
    }),
  };
}

export async function advancePromotionWorkspace(
  state: IVcsStateRepository,
  engine: IVcsLocalEnginePort,
  input: z.infer<typeof promotionAdvanceSchema>,
  applyAtomically: (baseId: string, patch: IBaseVcsPatch) => Promise<Result<void, DomainError>>
): Promise<Result<number, DomainError>> {
  const loaded = await loadVcsWorkspace(state, engine);
  if (loaded.isErr()) return err(loaded.error);
  const { config, baseSnapshot, workingSnapshot, conflicts } = loaded.value;
  const { snapshot, applied } = input;
  if (
    config.baseId !== snapshot.baseId ||
    baseSnapshot.baseId !== snapshot.baseId ||
    config.promotionBaselineRevision === undefined ||
    config.promotionBaselineRevision > baseSnapshot.revision ||
    config.remoteMode !== 'v2-vcs' ||
    config.headlessUrl ||
    config.selectedTables !== undefined ||
    config.schemaOnly ||
    config.readOnly ||
    baseSnapshot.accessScope ||
    snapshot.accessScope ||
    conflicts.length ||
    !state.writePromotionSnapshot ||
    applied.at(-1)?.appliedRevision !== snapshot.revision ||
    applied.some(
      (receipt, i) =>
        receipt.baseRevision >= receipt.appliedRevision ||
        (i > 0 && receipt.appliedRevision <= applied[i - 1]!.appliedRevision)
    )
  ) {
    return err(
      vcsDomainError.validation({
        code: 'vcs.invalid_promotion_workspace',
        message:
          'A complete Builder working copy and ordered applied Data PR receipts are required.',
      })
    );
  }
  if (baseSnapshot.revision >= snapshot.revision) return ok(baseSnapshot.revision);

  // The reviewed values are the merge ancestor for promoted paths. Everything excluded keeps
  // its original ancestor, so unselected edits and changes made after review both survive.
  let ancestor = baseSnapshot;
  for (const receipt of applied) {
    if (receipt.appliedRevision > baseSnapshot.revision) {
      ancestor = applyPatchToSnapshot(ancestor, receipt.patch, { preserveComputed: true });
    }
  }
  const target = alignSourceSnapshot(snapshot, ancestor);
  const merge = threeWayMerge({
    base: ancestor,
    ours: alignPromotionWorkingSnapshot(workingSnapshot, ancestor),
    theirs: target,
  });
  if (merge.conflicts.length) {
    const first = merge.conflicts[0]!;
    return err(
      vcsDomainError.conflict({
        code: 'vcs.promotion_merge_conflicts',
        message: `Data PR applied, but the Builder working copy needs attention. Resolve the overlapping change at ${first.tableId}/${first.entityId}${first.fieldId ? `/${first.fieldId}` : ''} locally, then retry. Your local edits are intact.`,
      })
    );
  }
  // The merge compares logical rows, while writes must use their actual local view orders.
  const workingPatch = diffSnapshots(workingSnapshot, merge.mergedSnapshot);
  if (!isEmptyPatch(workingPatch)) {
    const result = await applyAtomically(
      config.baseId,
      allocateLocalRecordNumbers(workingPatch, workingSnapshot, merge.mergedSnapshot)
    );
    if (result.isErr()) return err(result.error);
  }
  const saved = await state.writePromotionSnapshot(snapshot);
  return saved.isErr() ? err(saved.error) : ok(target.revision);
}
