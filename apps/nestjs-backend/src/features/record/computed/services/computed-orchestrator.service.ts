/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { TableDomain, LastModifiedByFieldCore, LastModifiedTimeFieldCore } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../../../db-provider/db.provider';
import { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { IClsStore } from '../../../../types/cls';
import { Timing } from '../../../../utils/timing';
import type { ICellContext } from '../../../calculation/utils/changes';
import { TableDomainQueryService } from '../../../table-domain/table-domain-query.service';
import {
  ComputedDependencyCollectorService,
  IComputedImpactByTable,
} from './computed-dependency-collector.service';
import type { IFieldChangeSource } from './computed-dependency-collector.service';
import { ComputedEvaluatorService } from './computed-evaluator.service';
import { buildResultImpact } from './computed-utils';

@Injectable()
export class ComputedOrchestratorService {
  constructor(
    private readonly collector: ComputedDependencyCollectorService,
    private readonly evaluator: ComputedEvaluatorService,
    private readonly prismaService: PrismaService,
    private readonly dataPrismaService: DataPrismaService,
    private readonly tableDomainQueryService: TableDomainQueryService,
    private readonly cls: ClsService<IClsStore>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
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
  @Timing()
  async computeCellChangesForRecords(
    tableId: string,
    cellContexts: ICellContext[],
    update: (tableDomains?: Map<string, TableDomain>) => Promise<void>
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
    update: (tableDomains?: Map<string, TableDomain>) => Promise<void>
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
    const changedRecordIdsByTable = new Map<string, Set<string>>();
    for (const s of filtered) {
      let recordSet = changedRecordIdsByTable.get(s.tableId);
      if (!recordSet) {
        recordSet = new Set<string>();
        changedRecordIdsByTable.set(s.tableId, recordSet);
      }
      for (const ctx of s.cellContexts) {
        changedFieldIds.add(ctx.fieldId);
        if (ctx.recordId) recordSet.add(ctx.recordId);
      }
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

    const tableDomains = await this.resolveTableDomains(
      impactMerged,
      tableDomainSeeds,
      filtered.map((s) => s.tableId)
    );

    await this.lockImpactedRecords(filtered, impactMerged, tableDomains);

    // Track-all LastModified* fields are persisted/generated outside base ops.
    // Ensure they are part of impacted fields and not excluded so their new values get published.
    const excludeFieldIds = new Set(changedFieldIds);
    for (const [tid, domain] of tableDomains) {
      const trackAllAudit = domain
        .getLastModifiedFields()
        .filter((f) =>
          f.type === FieldType.LastModifiedTime
            ? (f as LastModifiedTimeFieldCore).isTrackAll()
            : f.type === FieldType.LastModifiedBy && (f as LastModifiedByFieldCore).isTrackAll()
        );
      if (!trackAllAudit.length) continue;
      const recordIds = changedRecordIdsByTable.get(tid);
      if (!recordIds?.size) continue;
      const group = (impactMerged[tid] ||= {
        fieldIds: new Set<string>(),
        recordIds: new Set<string>(),
      });
      trackAllAudit.forEach((f) => {
        group.fieldIds.add(f.id);
        excludeFieldIds.delete(f.id);
      });
      recordIds.forEach((rid) => group.recordIds.add(rid));
    }

    // 2) Perform the actual base update(s) if provided
    await update(tableDomains);

    // 3) Evaluate and publish computed values
    const total = await this.evaluator.evaluate(impactMerged, {
      excludeFieldIds,
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

    if (this.cls.get('skipFieldComputation')) {
      return { publishedOps: 0, impact: {} };
    }

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
      preferAutoNumberPaging: true,
      ...(exclude.size ? { excludeFieldIds: exclude } : {}),
      tableDomains,
    });

    return { publishedOps: total, impact: buildResultImpact(impact) };
  }

  @Timing()
  private async lockImpactedRecords(
    sources: Array<{ tableId: string; cellContexts: ICellContext[] }>,
    impact: IComputedImpactByTable,
    tableDomains: Map<string, TableDomain>
  ) {
    if (typeof this.dbProvider.lockRecordsSql !== 'function') {
      return;
    }
    const targetMap = new Map<string, Set<string>>();

    for (const source of sources) {
      if (!source.cellContexts?.length) continue;
      let recordSet = targetMap.get(source.tableId);
      if (!recordSet) {
        recordSet = new Set<string>();
        targetMap.set(source.tableId, recordSet);
      }
      for (const ctx of source.cellContexts) {
        if (ctx.recordId) {
          recordSet.add(ctx.recordId);
        }
      }
    }

    for (const [tableId, group] of Object.entries(impact)) {
      if (!group.recordIds?.size) continue;
      let recordSet = targetMap.get(tableId);
      if (!recordSet) {
        recordSet = new Set<string>();
        targetMap.set(tableId, recordSet);
      }
      for (const id of group.recordIds) {
        recordSet.add(id);
      }
    }

    if (!targetMap.size) {
      return;
    }

    const tableIds = Array.from(targetMap.keys());
    const tableNameMap = new Map<string, string>();
    for (const [tableId, domain] of tableDomains) {
      if (domain?.dbTableName) {
        tableNameMap.set(tableId, domain.dbTableName);
      }
    }

    const missingTableIds = tableIds.filter((tableId) => !tableNameMap.has(tableId));
    if (missingTableIds.length) {
      const fetched = await this.tableDomainQueryService.getTableDomainsByIds(missingTableIds);
      for (const [tableId, domain] of fetched) {
        if (domain?.dbTableName) {
          tableNameMap.set(tableId, domain.dbTableName);
        }
        if (!tableDomains.has(tableId)) {
          tableDomains.set(tableId, domain);
        }
      }
    }

    const lockTargets = tableIds
      .map((tableId) => {
        const dbTableName = tableNameMap.get(tableId);
        if (!dbTableName) return null;
        const recordIds = Array.from(targetMap.get(tableId) ?? []);
        if (!recordIds.length) return null;
        return { tableId, dbTableName, recordIds };
      })
      .filter(
        (target): target is { tableId: string; dbTableName: string; recordIds: string[] } =>
          target !== null
      )
      .sort((a, b) => (a.dbTableName > b.dbTableName ? 1 : a.dbTableName < b.dbTableName ? -1 : 0));

    for (const target of lockTargets) {
      const sql = this.dbProvider.lockRecordsSql?.({
        dbTableName: target.dbTableName,
        idFieldName: '__id',
        recordIds: target.recordIds,
      });
      if (sql) {
        await this.dataPrismaService.txClient().$queryRawUnsafe(sql);
      }
    }
  }

  private async resolveTableDomains(
    impact: IComputedImpactByTable,
    seed?: ReadonlyMap<string, TableDomain>,
    extraTableIds?: Iterable<string>
  ): Promise<Map<string, TableDomain>> {
    const cache = new Map<string, TableDomain>();
    if (seed?.size) {
      for (const [tableId, domain] of seed) {
        cache.set(tableId, domain);
      }
    }

    const projectionByTable = new Map<string, Set<string> | undefined>();
    for (const [tableId, group] of Object.entries(impact)) {
      projectionByTable.set(tableId, new Set(group.fieldIds));
    }
    if (extraTableIds) {
      for (const id of extraTableIds) {
        if (!id) continue;
        if (!projectionByTable.has(id)) {
          projectionByTable.set(id, undefined);
        }
      }
    }

    const targetIds = new Set<string>(projectionByTable.keys());
    if (!targetIds.size) {
      return cache;
    }

    const fetchMissingDomains = async (tableIds: Iterable<string>) => {
      const unique = Array.from(new Set(Array.from(tableIds).filter(Boolean)));
      if (!unique.length) return;
      const missing = unique.filter((tableId) => !cache.has(tableId));
      if (!missing.length) return;
      const fetched = await this.tableDomainQueryService.getTableDomainsByIds(missing);
      for (const [tableId, domain] of fetched) {
        cache.set(tableId, domain);
      }
    };

    await fetchMissingDomains(targetIds);

    // Only expand one hop from the impacted tables; deeper dependencies are resolved via
    // persisted physical columns instead of recursive CTE expansion.
    const relatedIds = new Set<string>();
    for (const tableId of targetIds) {
      const domain = cache.get(tableId);
      if (!domain) {
        continue;
      }
      const projection = projectionByTable.get(tableId);
      const relatedTableIds = domain.getAllForeignTableIds(
        projection && projection.size ? Array.from(projection) : undefined
      );
      for (const relatedTableId of relatedTableIds) {
        if (!projectionByTable.has(relatedTableId)) {
          projectionByTable.set(relatedTableId, undefined);
        }
        relatedIds.add(relatedTableId);
      }
    }

    if (relatedIds.size) {
      await fetchMissingDomains(relatedIds);
    }

    const unresolved = Array.from(projectionByTable.keys()).filter(
      (tableId) => !cache.has(tableId)
    );
    if (unresolved.length) {
      await fetchMissingDomains(unresolved);
      const stillMissing = unresolved.filter((tableId) => !cache.has(tableId));
      if (stillMissing.length) {
        throw new NotFoundException(`Table(s) not found: ${stillMissing.join(', ')}`);
      }
    }

    return cache;
  }
}
