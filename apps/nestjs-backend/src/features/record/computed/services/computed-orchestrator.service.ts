/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable } from '@nestjs/common';
import { IdPrefix, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { isEqual } from 'lodash';
import { RawOpType } from '../../../../share-db/interface';
import { BatchService } from '../../../calculation/batch.service';
import type { ICellContext } from '../../../calculation/utils/changes';
import { ComputedDependencyCollectorService } from './computed-dependency-collector.service';
import type { IFieldChangeSource } from './computed-dependency-collector.service';
import {
  ComputedEvaluatorService,
  type IEvaluatedComputedValues,
} from './computed-evaluator.service';
import { buildResultImpact } from './computed-utils';

@Injectable()
export class ComputedOrchestratorService {
  constructor(
    private readonly collector: ComputedDependencyCollectorService,
    private readonly evaluator: ComputedEvaluatorService,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService
  ) {}

  /**
   * Publish-only computed pipeline executed within the current transaction.
   * - Collects affected computed fields across tables via dependency closure (SQL CTE).
   * - Resolves impacted recordIds per table (same-table = changed records; cross-table = link backrefs).
   * - Reads latest values via RecordService snapshots (projection of impacted computed fields).
   * - Builds setRecord ops and saves them as raw ops; no DB writes, no __version bump here.
   * - Raw ops are picked up by ShareDB publisher after the outer tx commits.
   *
   * Returns: { publishedOps } — total number of field set ops enqueued.
   */
  async computeCellChangesForRecords(
    tableId: string,
    cellContexts: ICellContext[],
    update: () => Promise<void>
  ): Promise<{
    publishedOps: number;
    impact: Record<string, { fieldIds: string[]; recordIds: string[] }>;
  }> {
    // With update callback, switch to the new dual-select (old/new) mode
    return this.computeCellChangesForRecordsMulti([{ tableId, cellContexts }], update);
  }

  /**
   * Multi-source variant: accepts changes originating from multiple tables.
   * Computes a unified impact once, optionally executes an update callback
   * between selecting old values and computing new values, and publishes ops
   * with both old and new cell values.
   */
  async computeCellChangesForRecordsMulti(
    sources: Array<{ tableId: string; cellContexts: ICellContext[] }>,
    update: () => Promise<void>
  ): Promise<{
    publishedOps: number;
    impact: Record<string, { fieldIds: string[]; recordIds: string[] }>;
  }> {
    const filtered = sources.filter((s) => s.cellContexts?.length);
    if (!filtered.length) {
      await update();
      return { publishedOps: 0, impact: {} };
    }

    // Collect base changed field ids to avoid re-publishing base ops via computed
    const changedFieldIds = new Set<string>();
    for (const s of filtered) {
      for (const ctx of s.cellContexts) changedFieldIds.add(ctx.fieldId);
    }

    // 1) Collect impact per source and merge once
    const exclude = Array.from(changedFieldIds);
    const impacts = await Promise.all(
      filtered.map(async ({ tableId, cellContexts }) => {
        return this.collector.collect(tableId, cellContexts, exclude);
      })
    );

    const impactMerged = impacts.reduce(
      (acc, cur) => {
        for (const [tid, group] of Object.entries(cur)) {
          const target = (acc[tid] ||= {
            fieldIds: new Set<string>(),
            recordIds: new Set<string>(),
          });
          group.fieldIds.forEach((f) => target.fieldIds.add(f));
          group.recordIds.forEach((r) => target.recordIds.add(r));
        }
        return acc;
      },
      {} as Awaited<ReturnType<typeof this.collector.collect>>
    );

    const impactedTables = Object.keys(impactMerged);
    if (!impactedTables.length) {
      await update();
      return { publishedOps: 0, impact: {} };
    }

    for (const tid of impactedTables) {
      const group = impactMerged[tid];
      if (!group.fieldIds.size || !group.recordIds.size) delete impactMerged[tid];
    }
    if (!Object.keys(impactMerged).length) {
      await update();
      return { publishedOps: 0, impact: {} };
    }

    // 2) Read old values once
    const oldValues = await this.evaluator.selectValues(impactMerged);

    // 3) Perform the actual base update(s) if provided
    await update();

    // 4) Evaluate new values + persist computed values where applicable
    const newValues = await this.evaluator.evaluate(impactMerged);

    // 5) Publish ops with old/new values
    const total = this.publishOpsWithOldNew(impactMerged, oldValues, newValues, changedFieldIds);

    return { publishedOps: total, impact: buildResultImpact(impactMerged) };
  }

  /**
   * Compute and publish cell changes when field definitions are UPDATED.
   * - Collects impacted fields and records based on changed field ids (pre-update)
   * - Selects old values
   * - Executes the provided update callback within the same tx (schema/meta update)
   * - Evaluates new values via updateFromSelect and publishes ops
   */
  async computeCellChangesForFields(
    sources: IFieldChangeSource[],
    update: () => Promise<void>
  ): Promise<{
    publishedOps: number;
    impact: Record<string, { fieldIds: string[]; recordIds: string[] }>;
  }> {
    const impactPre = await this.collector.collectForFieldChanges(sources);

    // If nothing impacted, still run update
    if (!Object.keys(impactPre).length) {
      await update();
      return { publishedOps: 0, impact: {} };
    }

    const oldValues = await this.evaluator.selectValues(impactPre);
    await update();
    const newValues = await this.evaluator.evaluate(impactPre, { versionBaseline: 'current' });

    // For field changes, there are no base cell ops to exclude
    const total = this.publishOpsWithOldNew(impactPre, oldValues, newValues, new Set());

    return { publishedOps: total, impact: buildResultImpact(impactPre) };
  }

  /**
   * Compute and publish cell changes when fields are being DELETED.
   * - Collects impacted fields and records based on the fields-to-delete (pre-delete)
   * - Selects old values
   * - Executes the provided update callback within the same tx to delete fields and dependencies
   * - Evaluates new values and publishes ops for impacted fields EXCEPT the deleted ones
   *   (and any fields that no longer exist after the update, e.g., symmetric link fields).
   */
  async computeCellChangesForFieldsBeforeDelete(
    sources: IFieldChangeSource[],
    update: () => Promise<void>
  ): Promise<{
    publishedOps: number;
    impact: Record<string, { fieldIds: string[]; recordIds: string[] }>;
  }> {
    const impactPre = await this.collector.collectForFieldChanges(sources);

    if (!Object.keys(impactPre).length) {
      await update();
      return { publishedOps: 0, impact: {} };
    }

    const oldValues = await this.evaluator.selectValues(impactPre);

    await update();

    // After update, some fields may be deleted; exclude them from publishing.
    // Also exclude the source (deleted) field ids as they no longer exist.
    const startFieldIds = new Set<string>(sources.flatMap((s) => s.fieldIds || []));

    const newValues = await this.evaluator.evaluate(impactPre, { versionBaseline: 'current' });

    // Determine which impacted fieldIds were actually deleted (no longer exist post-update)
    const actuallyDeleted = new Set<string>();
    for (const [tid, group] of Object.entries(impactPre)) {
      const ids = Array.from(group.fieldIds);
      if (!ids.length) continue;
      const rows = await this.prismaService.txClient().field.findMany({
        where: { tableId: tid, id: { in: ids }, deletedTime: null },
        select: { id: true },
      });
      const existing = new Set(rows.map((r) => r.id));
      for (const fid of ids) if (!existing.has(fid)) actuallyDeleted.add(fid);
    }

    const exclude = new Set<string>([...startFieldIds, ...actuallyDeleted]);

    const total = this.publishOpsWithOldNew(impactPre, oldValues, newValues, exclude);

    return { publishedOps: total, impact: buildResultImpact(impactPre) };
  }

  /**
   * Compute and publish cell changes when new fields are CREATED within the same tx.
   * - Executes the provided update callback first to persist new field definitions.
   * - Collects impacted fields/records post-update (includes the new fields themselves).
   * - Evaluates new values via updateFromSelect and publishes ops (old values are empty).
   */
  async computeCellChangesForFieldsAfterCreate(
    sources: IFieldChangeSource[],
    update: () => Promise<void>
  ): Promise<{
    publishedOps: number;
    impact: Record<string, { fieldIds: string[]; recordIds: string[] }>;
  }> {
    await update();

    const impact = await this.collector.collectForFieldChanges(sources);
    if (!Object.keys(impact).length) return { publishedOps: 0, impact: {} };

    const newValues = await this.evaluator.evaluate(impact, { versionBaseline: 'current' });

    // Publish ops comparing against empty old-values map
    const emptyOld: IEvaluatedComputedValues = {};
    const total = this.publishOpsWithOldNew(impact, emptyOld, newValues, new Set());

    return { publishedOps: total, impact: buildResultImpact(impact) };
  }

  private publishOpsWithOldNew(
    impact: Awaited<ReturnType<typeof this.collector.collect>>,
    oldVals: IEvaluatedComputedValues,
    newVals: IEvaluatedComputedValues,
    changedFieldIds: Set<string>
  ) {
    const tasks = Object.keys(impact).map((tid) => {
      const recordsNew = newVals[tid] || {};
      const recordsOld = oldVals[tid] || {};
      const recordIdSet = new Set<string>([...Object.keys(recordsNew), ...Object.keys(recordsOld)]);
      if (!recordIdSet.size) return 0;

      const impactedFieldIds = impact[tid]?.fieldIds || new Set<string>();

      const opDataList = Array.from(recordIdSet)
        .map((rid) => {
          const version = recordsNew[rid]?.version ?? recordsOld[rid]?.version;
          const fieldsNew = recordsNew[rid]?.fields || {};
          const fieldsOld = recordsOld[rid]?.fields || {};
          // candidate fields: union of new/old keys, further limited to impacted set
          const unionKeys = new Set<string>([...Object.keys(fieldsNew), ...Object.keys(fieldsOld)]);
          const fieldIds = Array.from(unionKeys).filter((fid) => impactedFieldIds.has(fid));

          const ops = fieldIds
            .filter((fid) => !changedFieldIds.has(fid))
            .map((fid) => {
              const oldCellValue = fieldsOld[fid];
              // When new map is missing a field that existed before, treat as null (deletion)
              const hasNew = Object.prototype.hasOwnProperty.call(fieldsNew, fid);
              const newCellValue = hasNew
                ? fieldsNew[fid]
                : oldCellValue !== undefined
                  ? null
                  : undefined;
              if (newCellValue === undefined && oldCellValue === undefined) return undefined;
              if (isEqual(newCellValue, oldCellValue)) return undefined;
              return RecordOpBuilder.editor.setRecord.build({
                fieldId: fid,
                oldCellValue,
                newCellValue,
              });
            })
            .filter(Boolean) as ReturnType<typeof RecordOpBuilder.editor.setRecord.build>[];

          if (version == null || ops.length === 0) return null;
          return { docId: rid, version, data: ops, count: ops.length } as const;
        })
        .filter(Boolean) as { docId: string; version: number; data: unknown; count: number }[];

      if (!opDataList.length) return 0;

      this.batchService.saveRawOps(
        tid,
        RawOpType.Edit,
        IdPrefix.Record,
        opDataList.map(({ docId, version, data }) => ({ docId, version, data }))
      );

      return opDataList.reduce((sum, x) => sum + x.count, 0);
    });

    return tasks.reduce((a, b) => a + b, 0);
  }
}
