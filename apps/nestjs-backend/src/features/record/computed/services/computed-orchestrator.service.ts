/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICellContext } from '../../../calculation/utils/changes';
import { ComputedDependencyCollectorService } from './computed-dependency-collector.service';
import type {
  IComputedImpactByTable,
  IFieldChangeSource,
} from './computed-dependency-collector.service';
import { ComputedEvaluatorService } from './computed-evaluator.service';
import { buildResultImpact } from './computed-utils';

@Injectable()
export class ComputedOrchestratorService {
  constructor(
    private readonly collector: ComputedDependencyCollectorService,
    private readonly evaluator: ComputedEvaluatorService,
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
   * Computes a unified impact once, executes the update callback, and then
   * re-evaluates computed fields in batches while publishing ShareDB ops.
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

    // 2) Perform the actual base update(s) if provided
    await update();

    // 3) Evaluate and publish computed values
    const total = await this.evaluator.evaluate(impactMerged, {
      excludeFieldIds: changedFieldIds,
    });

    return { publishedOps: total, impact: buildResultImpact(impactMerged) };
  }

  /**
   * Compute and publish cell changes when field definitions are UPDATED.
   * - Collects impacted fields and records based on changed field ids (pre-update)
   * - Executes the provided update callback within the same tx (schema/meta update)
   * - Recomputes values via updateFromSelect, publishing ops with the latest values
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

    await update();
    const total = await this.evaluator.evaluate(impactPre, {
      versionBaseline: 'current',
    });

    return { publishedOps: total, impact: buildResultImpact(impactPre) };
  }

  /**
   * Compute and publish cell changes when fields are being DELETED.
   * - Collects impacted fields and records based on the fields-to-delete (pre-delete)
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

    await update();

    // After update, some fields may be deleted; build a post-update impact that only
    // includes fields still present to avoid selecting/updating non-existent columns.
    const impactPost: IComputedImpactByTable = {};
    for (const [tid, group] of Object.entries(impactPre)) {
      const ids = Array.from(group.fieldIds);
      if (!ids.length) continue;
      const rows = await this.prismaService.txClient().field.findMany({
        where: { tableId: tid, id: { in: ids }, deletedTime: null },
        select: { id: true },
      });
      const existing = new Set(rows.map((r) => r.id));
      const kept = new Set(Array.from(group.fieldIds).filter((fid) => existing.has(fid)));
      if (kept.size && group.recordIds.size) {
        impactPost[tid] = { fieldIds: kept, recordIds: new Set(group.recordIds) };
      }
    }

    if (!Object.keys(impactPost).length) {
      return { publishedOps: 0, impact: {} };
    }

    // Also exclude the source (deleted) field ids when publishing
    const startFieldIds = new Set<string>(sources.flatMap((s) => s.fieldIds || []));

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

    const total = await this.evaluator.evaluate(impactPost, {
      versionBaseline: 'current',
      excludeFieldIds: exclude,
    });

    return { publishedOps: total, impact: buildResultImpact(impactPost) };
  }

  /**
   * Compute and publish cell changes when new fields are CREATED within the same tx.
   * - Executes the provided update callback first to persist new field definitions.
   * - Collects impacted fields/records post-update (includes the new fields themselves).
   * - Evaluates new values via updateFromSelect and publishes ops.
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

    const total = await this.evaluator.evaluate(impact, {
      versionBaseline: 'current',
      preferAutoNumberPaging: true,
    });

    return { publishedOps: total, impact: buildResultImpact(impact) };
  }
}
