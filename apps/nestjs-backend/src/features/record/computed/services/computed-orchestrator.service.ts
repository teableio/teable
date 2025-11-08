/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { TableDomain } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICellContext } from '../../../calculation/utils/changes';
import { TableDomainQueryService } from '../../../table-domain/table-domain-query.service';
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
    private readonly prismaService: PrismaService,
    private readonly tableDomainQueryService: TableDomainQueryService
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
    const results = await Promise.all(
      filtered.map(({ tableId, cellContexts }) =>
        this.collector.collect(tableId, cellContexts, exclude)
      )
    );

    const tableDomainSeeds = new Map<string, TableDomain>();
    const impactMerged: IComputedImpactByTable = {};

    for (const { impact, tableDomains } of results) {
      for (const [tid, group] of Object.entries(impact)) {
        const target = (impactMerged[tid] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        });
        group.fieldIds.forEach((f) => target.fieldIds.add(f));
        group.recordIds.forEach((r) => target.recordIds.add(r));
        if (group.preferAutoNumberPaging) {
          target.preferAutoNumberPaging = true;
        }
      }
      for (const [tid, domain] of tableDomains) {
        if (!tableDomainSeeds.has(tid)) {
          tableDomainSeeds.set(tid, domain);
        }
      }
    }

    const impactedTables = Object.keys(impactMerged);
    if (!impactedTables.length) {
      await update();
      return { publishedOps: 0, impact: {} };
    }

    for (const tid of impactedTables) {
      const group = impactMerged[tid];
      if (!group.fieldIds.size || (!group.recordIds.size && !group.preferAutoNumberPaging)) {
        delete impactMerged[tid];
      }
    }
    if (!Object.keys(impactMerged).length) {
      await update();
      return { publishedOps: 0, impact: {} };
    }

    const tableDomains = await this.resolveTableDomains(impactMerged, tableDomainSeeds);

    // 2) Perform the actual base update(s) if provided
    await update();

    // 3) Evaluate and publish computed values
    const total = await this.evaluator.evaluate(impactMerged, {
      excludeFieldIds: changedFieldIds,
      tableDomains,
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
    const tableDomains = await this.resolveTableDomains(impactPre);
    const total = await this.evaluator.evaluate(impactPre, {
      versionBaseline: 'current',
      tableDomains,
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

    const startFieldIdList = Array.from(new Set(sources.flatMap((s) => s.fieldIds || [])));

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
      const hasRecords = group.recordIds.size > 0;
      const preferAuto = group.preferAutoNumberPaging === true;
      if (kept.size && (hasRecords || preferAuto)) {
        impactPost[tid] = {
          fieldIds: kept,
          recordIds: new Set(group.recordIds),
          ...(preferAuto ? { preferAutoNumberPaging: true } : {}),
        };
      }
    }

    if (startFieldIdList.length) {
      const existingStartFields = await this.prismaService.txClient().field.findMany({
        where: { id: { in: startFieldIdList }, deletedTime: null },
        select: { id: true },
      });
      const existingSet = new Set(existingStartFields.map((r) => r.id));
      const deletedStartIds = startFieldIdList.filter((id) => !existingSet.has(id));

      if (deletedStartIds.length) {
        const dependents = await this.collector.getConditionalSortDependents(deletedStartIds);
        if (dependents.length) {
          for (const { tableId, fieldId } of dependents) {
            const group = impactPost[tableId];
            if (!group) continue;
            group.fieldIds.delete(fieldId);
            if (!group.fieldIds.size) {
              delete impactPost[tableId];
            }
          }
        }
      }
    }

    if (!Object.keys(impactPost).length) {
      return { publishedOps: 0, impact: {} };
    }

    // Also exclude the source (deleted) field ids when publishing
    const startFieldIds = new Set<string>(startFieldIdList);

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

    const tableDomains = await this.resolveTableDomains(impactPost);
    const total = await this.evaluator.evaluate(impactPost, {
      versionBaseline: 'current',
      excludeFieldIds: exclude,
      tableDomains,
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

    const publishTargetIds = new Set<string>();
    for (const source of sources) {
      if (!source.fieldIds?.length) continue;
      for (const fid of source.fieldIds) publishTargetIds.add(fid);
    }

    const impact = await this.collector.collectForFieldChanges(sources);
    if (!Object.keys(impact).length) return { publishedOps: 0, impact: {} };
    const tableDomains = await this.resolveTableDomains(impact);

    const exclude = new Set<string>();
    if (publishTargetIds.size) {
      for (const group of Object.values(impact)) {
        for (const fid of group.fieldIds) {
          if (!publishTargetIds.has(fid)) exclude.add(fid);
        }
      }
    }

    const total = await this.evaluator.evaluate(impact, {
      versionBaseline: 'current',
      preferAutoNumberPaging: true,
      ...(exclude.size ? { excludeFieldIds: exclude } : {}),
      tableDomains,
    });

    return { publishedOps: total, impact: buildResultImpact(impact) };
  }

  private async resolveTableDomains(
    impact: IComputedImpactByTable,
    seed?: ReadonlyMap<string, TableDomain>
  ): Promise<Map<string, TableDomain>> {
    const cache = new Map<string, TableDomain>();
    if (seed?.size) {
      for (const [tableId, domain] of seed) {
        cache.set(tableId, domain);
      }
    }

    const impactTableIds = Object.keys(impact);
    if (!impactTableIds.length) {
      return cache;
    }

    const projectionByTable = new Map<string, Set<string> | undefined>();
    for (const [tableId, group] of Object.entries(impact)) {
      projectionByTable.set(tableId, new Set(group.fieldIds));
    }

    const missingImpactIds = impactTableIds.filter((tableId) => !cache.has(tableId));
    if (missingImpactIds.length) {
      const fetched = await this.tableDomainQueryService.getTableDomainsByIds(missingImpactIds);
      for (const [tableId, domain] of fetched) {
        cache.set(tableId, domain);
      }
      const stillMissing = missingImpactIds.filter((tableId) => !cache.has(tableId));
      if (stillMissing.length) {
        throw new NotFoundException(`Table(s) not found: ${stillMissing.join(', ')}`);
      }
    }

    const processed = new Set<string>();
    const queue = new Set<string>(impactTableIds);

    while (queue.size) {
      const batch = Array.from(queue);
      queue.clear();

      const needFetch = batch.filter((tableId) => !cache.has(tableId));
      if (needFetch.length) {
        const fetched = await this.tableDomainQueryService.getTableDomainsByIds(needFetch);
        for (const [tableId, domain] of fetched) {
          cache.set(tableId, domain);
        }
        const unresolved = needFetch.filter((tableId) => !cache.has(tableId));
        unresolved.forEach((tableId) => processed.add(tableId));
      }

      for (const tableId of batch) {
        if (processed.has(tableId)) {
          continue;
        }
        const domain = cache.get(tableId);
        if (!domain) {
          processed.add(tableId);
          continue;
        }
        processed.add(tableId);
        const projection = projectionByTable.get(tableId);
        const relatedTableIds = domain.getAllForeignTableIds(
          projection && projection.size ? Array.from(projection) : undefined
        );
        for (const relatedTableId of relatedTableIds) {
          if (!projectionByTable.has(relatedTableId)) {
            projectionByTable.set(relatedTableId, undefined);
          }
          if (!processed.has(relatedTableId)) {
            queue.add(relatedTableId);
          }
        }
      }
    }

    return cache;
  }
}
