/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../../../db-provider/db.provider';
import { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { ICellContext } from '../../../calculation/utils/changes';

export interface ICellBasicContext {
  recordId: string;
  fieldId: string;
}

export interface IComputedImpactByTable {
  [tableId: string]: {
    fieldIds: Set<string>;
    recordIds: Set<string>;
  };
}

export interface IFieldChangeSource {
  tableId: string;
  fieldIds: string[];
}

@Injectable()
export class ComputedDependencyCollectorService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  private async getDbTableName(tableId: string): Promise<string> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName;
  }

  private splitDbTableName(qualified: string): { schema?: string; table: string } {
    const parts = qualified.split('.');
    if (parts.length === 2) return { schema: parts[0], table: parts[1] };
    return { table: qualified };
  }

  // Minimal link options needed for join table lookups
  private parseLinkOptions(
    raw: unknown
  ): Pick<
    ILinkFieldOptions,
    'foreignTableId' | 'fkHostTableName' | 'selfKeyName' | 'foreignKeyName'
  > | null {
    let value: unknown = raw;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const foreignTableId = obj['foreignTableId'];
    const fkHostTableName = obj['fkHostTableName'];
    const selfKeyName = obj['selfKeyName'];
    const foreignKeyName = obj['foreignKeyName'];
    if (
      typeof foreignTableId === 'string' &&
      typeof fkHostTableName === 'string' &&
      typeof selfKeyName === 'string' &&
      typeof foreignKeyName === 'string'
    ) {
      return { foreignTableId, fkHostTableName, selfKeyName, foreignKeyName };
    }
    return null;
  }

  private parseOptionsLoose<T = unknown>(raw: unknown): T | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object') return raw as T;
    return null;
  }

  /**
   * Resolve link field IDs among the provided field IDs and include their symmetric counterparts.
   */
  private async resolveRelatedLinkFieldIds(fieldIds: string[]): Promise<string[]> {
    if (!fieldIds.length) return [];
    const rows = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, type: FieldType.Link, isLookup: null, deletedTime: null },
      select: { id: true, options: true },
    });
    const result = new Set<string>();
    for (const r of rows) {
      result.add(r.id);
      const opts = this.parseOptionsLoose<{ symmetricFieldId?: string }>(r.options);
      if (opts?.symmetricFieldId) result.add(opts.symmetricFieldId);
    }
    return Array.from(result);
  }

  /**
   * Find lookup/rollup fields whose lookupOptions.linkFieldId equals any of the provided link IDs.
   * Returns a map: tableId -> Set<fieldId>
   */
  private async findLookupsByLinkIds(linkFieldIds: string[]): Promise<Record<string, Set<string>>> {
    const acc: Record<string, Set<string>> = {};
    if (!linkFieldIds.length) return acc;
    for (const linkId of linkFieldIds) {
      const sql = this.dbProvider.lookupOptionsQuery('linkFieldId', linkId);
      const rows = await this.prismaService
        .txClient()
        .$queryRawUnsafe<Array<{ tableId: string; id: string }>>(sql);
      for (const r of rows) {
        if (!r.tableId || !r.id) continue;
        (acc[r.tableId] ||= new Set<string>()).add(r.id);
      }
    }
    return acc;
  }

  /**
   * Same as collectDependentFieldIds but groups by table id directly in SQL.
   * Returns a map: tableId -> Set<fieldId>
   */
  private async collectDependentFieldsByTable(
    startFieldIds: string[],
    excludeFieldIds?: string[]
  ): Promise<Record<string, Set<string>>> {
    if (!startFieldIds.length) return {};

    const nonRecursive = this.knex
      .select('from_field_id', 'to_field_id')
      .from('reference')
      .whereIn('from_field_id', startFieldIds);

    const recursive = this.knex
      .select('r.from_field_id', 'r.to_field_id')
      .from({ r: 'reference' })
      .join({ d: 'dep_graph' }, 'r.from_field_id', 'd.to_field_id');

    const depBuilder = this.knex
      .withRecursive('dep_graph', ['from_field_id', 'to_field_id'], nonRecursive.union(recursive))
      .distinct({ to_field_id: 'dep_graph.to_field_id', table_id: 'f.table_id' })
      .from('dep_graph')
      .join({ f: 'field' }, 'f.id', 'dep_graph.to_field_id')
      .whereNull('f.deleted_time')
      .andWhere((qb) => {
        qb.where('f.is_lookup', true)
          .orWhere('f.is_computed', true)
          .orWhere('f.type', FieldType.Link)
          .orWhere('f.type', FieldType.Formula)
          .orWhere('f.type', FieldType.Rollup);
      });
    if (excludeFieldIds?.length) {
      depBuilder.whereNotIn('dep_graph.to_field_id', excludeFieldIds);
    }

    // Also consider the changed Link fields themselves as impacted via UNION at SQL level.
    const linkSelf = this.knex
      .select({ to_field_id: 'f.id', table_id: 'f.table_id' })
      .from({ f: 'field' })
      .whereIn('f.id', startFieldIds)
      .andWhere('f.type', FieldType.Link)
      .whereNull('f.deleted_time');
    // Note: we intentionally do NOT exclude starting link fields even if they
    // are part of the changedFieldIds. We still want to include them in the
    // impacted set so that their display columns are persisted via
    // updateFromSelect. The computed orchestrator will independently avoid
    // publishing ops for base-changed fields (including links).

    const unionBuilder = this.knex
      .select('*')
      .from(depBuilder.as('dep'))
      .union(function () {
        this.select('*').from(linkSelf.as('link_self'));
      });

    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ to_field_id: string; table_id: string }[]>(unionBuilder.toQuery());

    const result: Record<string, Set<string>> = {};
    for (const r of rows) {
      if (!r.table_id || !r.to_field_id) continue;
      (result[r.table_id] ||= new Set<string>()).add(r.to_field_id);
    }
    return result;
  }

  /**
   * Given a table (targetTableId) and the changed table (changedTableId),
   * return recordIds in targetTableId that link to any of changedRecordIds via any link field.
   */
  private async getLinkedRecordIds(
    targetTableId: string,
    changedTableId: string,
    changedRecordIds: string[]
  ): Promise<string[]> {
    if (!changedRecordIds.length) return [];

    // Fetch link fields on targetTableId that point to changedTableId
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: targetTableId,
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, options: true },
    });
    // Build a UNION query across all matching link junction tables
    const selects = [] as Knex.QueryBuilder[];
    for (const lf of linkFields) {
      const opts = this.parseLinkOptions(lf.options);
      if (!opts || opts.foreignTableId !== changedTableId) continue;
      const { fkHostTableName, selfKeyName, foreignKeyName } = opts;
      selects.push(
        this.knex(fkHostTableName)
          .select({ id: selfKeyName })
          .whereIn(foreignKeyName, changedRecordIds)
          .whereNotNull(selfKeyName)
          .whereNotNull(foreignKeyName)
      );
    }

    if (!selects.length) return [];

    const unionQuery = this.knex.queryBuilder().union(selects);
    const finalQuery = this.knex.select('id').from(unionQuery.as('u')).distinct('id').toQuery();
    const rows = await this.prismaService.txClient().$queryRawUnsafe<{ id: string }[]>(finalQuery);
    return rows.map((r) => r.id).filter(Boolean);
  }

  /**
   * Build table-level adjacency from link fields among a set of tables.
   * Edge U -> V exists if table V has a link field whose foreignTableId = U.
   */
  private async getTableLinkAdjacency(tables: string[]): Promise<Record<string, Set<string>>> {
    if (!tables.length) return {};
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: { in: tables },
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, tableId: true, options: true },
    });
    const adj: Record<string, Set<string>> = {};
    for (const lf of linkFields) {
      const opts = this.parseLinkOptions(lf.options);
      if (!opts) continue;
      const from = opts.foreignTableId; // U
      const to = lf.tableId; // V
      if (!from || !to) continue;
      (adj[from] ||= new Set<string>()).add(to);
    }
    return adj;
  }

  /**
   * Collect impacted fields and records by starting from changed field definitions.
   * - Includes the starting fields themselves when they are computed/lookup/rollup/formula.
   * - Expands to dependent computed/lookup/link/rollup fields via reference graph (SQL CTE).
   * - Seeds recordIds with ALL records from tables owning the changed fields.
   * - Propagates recordIds across link relationships via junction tables.
   */
  async collectForFieldChanges(sources: IFieldChangeSource[]): Promise<IComputedImpactByTable> {
    const startFieldIds = Array.from(new Set(sources.flatMap((s) => s.fieldIds || [])));
    if (!startFieldIds.length) return {};

    // Group starting fields by table and fetch minimal metadata
    const startFields = await this.prismaService.txClient().field.findMany({
      where: { id: { in: startFieldIds }, deletedTime: null },
      select: { id: true, tableId: true, isComputed: true, isLookup: true, type: true },
    });
    const byTable = startFields.reduce<Record<string, string[]>>((acc, f) => {
      (acc[f.tableId] ||= []).push(f.id);
      return acc;
    }, {});

    // 1) Dependent fields grouped by table
    const depByTable = await this.collectDependentFieldsByTable(startFieldIds);

    // Initialize impact with dependent fields
    const impact: IComputedImpactByTable = Object.entries(depByTable).reduce((acc, [tid, fset]) => {
      acc[tid] = { fieldIds: new Set(fset), recordIds: new Set<string>() };
      return acc;
    }, {} as IComputedImpactByTable);

    // Ensure starting fields themselves are included so conversions can compare old/new values
    for (const f of startFields) {
      (impact[f.tableId] ||= {
        fieldIds: new Set<string>(),
        recordIds: new Set<string>(),
      }).fieldIds.add(f.id);
    }

    if (!Object.keys(impact).length) return {};

    // 2) Seed recordIds for origin tables with ALL record ids
    const originTableIds = Object.keys(byTable);
    const recordSets: Record<string, Set<string>> = {};
    for (const tid of originTableIds) {
      const dbTable = await this.getDbTableName(tid);
      const { schema, table } = this.splitDbTableName(dbTable);
      const qb = (schema ? this.knex.withSchema(schema) : this.knex).select('__id').from(table);
      const rows = await this.prismaService
        .txClient()
        .$queryRawUnsafe<Array<{ __id: string }>>(qb.toQuery());
      const set = (recordSets[tid] ||= new Set<string>());
      for (const r of rows) if (r.__id) set.add(r.__id);
    }

    // 3) Build adjacency among impacted + origin tables and propagate via links
    const tablesForAdjacency = Array.from(new Set([...Object.keys(impact), ...originTableIds]));
    const adj = await this.getTableLinkAdjacency(tablesForAdjacency);

    const queue: string[] = [...originTableIds];
    while (queue.length) {
      const src = queue.shift()!;
      const currentIds = Array.from(recordSets[src] || []);
      if (!currentIds.length) continue;
      const outs = Array.from(adj[src] || []);
      for (const dst of outs) {
        if (!impact[dst]) continue; // only propagate to impacted tables
        const linked = await this.getLinkedRecordIds(dst, src, currentIds);
        if (!linked.length) continue;
        const set = (recordSets[dst] ||= new Set<string>());
        let added = false;
        for (const id of linked) {
          if (!set.has(id)) {
            set.add(id);
            added = true;
          }
        }
        if (added) queue.push(dst);
      }
    }

    // 4) Assign recordIds into impact
    for (const [tid, group] of Object.entries(impact)) {
      const ids = recordSets[tid];
      if (ids && ids.size) ids.forEach((id) => group.recordIds.add(id));
    }

    // Remove tables with no records or fields after filtering
    for (const tid of Object.keys(impact)) {
      const g = impact[tid];
      if (!g.fieldIds.size || !g.recordIds.size) delete impact[tid];
    }

    return impact;
  }

  /**
   * Collect impacted computed fields grouped by table, and the associated recordIds to re-evaluate.
   * - Same-table computed fields: impacted recordIds are the updated records themselves.
   * - Cross-table computed fields (via link/lookup/rollup): impacted records are those linking to
   *   the changed records through any link field on the target table that points to the changed table.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async collect(
    tableId: string,
    ctxs: ICellContext[],
    excludeFieldIds?: string[]
  ): Promise<IComputedImpactByTable> {
    if (!ctxs.length) return {};

    const changedFieldIds = Array.from(new Set(ctxs.map((c) => c.fieldId)));
    const changedRecordIds = Array.from(new Set(ctxs.map((c) => c.recordId)));

    // 1) Transitive dependents grouped by table (SQL CTE + join field)
    const depByTable = await this.collectDependentFieldsByTable(changedFieldIds, excludeFieldIds);
    const impact: IComputedImpactByTable = Object.entries(depByTable).reduce((acc, [tid, fset]) => {
      acc[tid] = { fieldIds: new Set(fset), recordIds: new Set<string>() };
      return acc;
    }, {} as IComputedImpactByTable);

    // Additionally: include lookup/rollup fields that directly reference any changed link fields
    // (or their symmetric counterparts). This ensures cross-table lookups update when links change.
    const relatedLinkIds = await this.resolveRelatedLinkFieldIds(changedFieldIds);
    if (relatedLinkIds.length) {
      const byTable = await this.findLookupsByLinkIds(relatedLinkIds);
      for (const [tid, fset] of Object.entries(byTable)) {
        const group = (impact[tid] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        });
        fset.forEach((fid) => group.fieldIds.add(fid));
      }
    }

    // Include symmetric link fields (if any) on the foreign table so their values
    // are refreshed as well. The link fields themselves are already included by
    // SQL union in collectDependentFieldsByTable.
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        id: { in: changedFieldIds },
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, tableId: true, options: true },
    });

    // Record planned foreign recordIds per foreign table based on incoming link cell new/old values
    const plannedForeignRecordIds: Record<string, Set<string>> = {};

    for (const lf of linkFields) {
      type ILinkOptionsWithSymmetric = ILinkFieldOptions & { symmetricFieldId?: string };
      const optsLoose = this.parseOptionsLoose<ILinkOptionsWithSymmetric>(lf.options);
      const foreignTableId = optsLoose?.foreignTableId;
      const symmetricFieldId = optsLoose?.symmetricFieldId;

      // If symmetric, ensure foreign table symmetric field is included; recordIds
      // for foreign table will be determined by BFS propagation below.
      if (foreignTableId && symmetricFieldId) {
        (impact[foreignTableId] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        }).fieldIds.add(symmetricFieldId);

        // Also pre-seed foreign impacted recordIds using planned link targets
        // Extract ids from both oldValue and newValue to cover add/remove
        const targetIds = new Set<string>();
        for (const ctx of ctxs) {
          if (ctx.fieldId !== lf.id) continue;
          const toIds = (v: unknown) => {
            if (!v) return [] as string[];
            const arr = Array.isArray(v) ? v : [v];
            return arr
              .map((x) => (x && typeof x === 'object' ? (x as { id?: string }).id : undefined))
              .filter((id): id is string => !!id);
          };
          toIds(ctx.oldValue).forEach((id) => targetIds.add(id));
          toIds(ctx.newValue).forEach((id) => targetIds.add(id));
        }
        if (targetIds.size) {
          const set = (plannedForeignRecordIds[foreignTableId] ||= new Set<string>());
          targetIds.forEach((id) => set.add(id));
        }
      }
    }
    if (!Object.keys(impact).length) return {};

    // 3) Compute impacted recordIds per table with multi-hop propagation
    // Seed with origin changed records
    const recordSets: Record<string, Set<string>> = { [tableId]: new Set(changedRecordIds) };
    // Seed foreign tables with planned link targets so impact includes them even before DB write
    for (const [tid, ids] of Object.entries(plannedForeignRecordIds)) {
      if (!ids.size) continue;
      const set = (recordSets[tid] ||= new Set<string>());
      ids.forEach((id) => set.add(id));
    }
    // Build adjacency restricted to impacted tables + origin
    const impactedTables = Array.from(new Set([...Object.keys(impact), tableId]));
    const adj = await this.getTableLinkAdjacency(impactedTables);

    // BFS-like propagation over table graph
    const queue: string[] = [tableId];
    while (queue.length) {
      const src = queue.shift()!;
      const currentIds = Array.from(recordSets[src] || []);
      if (!currentIds.length) continue;
      const outs = Array.from(adj[src] || []);
      for (const dst of outs) {
        // Only care about tables we plan to update
        if (!impact[dst]) continue;
        const linked = await this.getLinkedRecordIds(dst, src, currentIds);
        if (!linked.length) continue;
        const set = (recordSets[dst] ||= new Set<string>());
        let added = false;
        for (const id of linked) {
          if (!set.has(id)) {
            set.add(id);
            added = true;
          }
        }
        if (added) queue.push(dst);
      }
    }

    // Assign results into impact
    for (const [tid, group] of Object.entries(impact)) {
      const ids = recordSets[tid];
      if (ids && ids.size) {
        ids.forEach((id) => group.recordIds.add(id));
      }
    }

    return impact;
  }
}
