/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { chunk } from 'lodash';
import { Timing } from '../../../../utils/timing';

export interface ILinkEdge {
  foreignTableId: string;
  hostTableId: string;
  fkTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
}

export interface IExplicitLinkSeed {
  tableId: string;
  recordIds: string[];
}

export interface IAllTableLinkSeed {
  tableId: string;
  dbTableName: string;
}

interface IResolveLinkCascadeParams {
  explicitSeeds: IExplicitLinkSeed[];
  allTableSeeds: IAllTableLinkSeed[];
  edges: ILinkEdge[];
}

const ALL_RECORDS = Symbol('ALL_RECORDS');
type VisitedSet = Set<string> | typeof ALL_RECORDS;

const IN_CHUNK = 500;

@Injectable()
export class LinkCascadeResolver {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Iterative BFS over link edges using only frontier ids; avoids full edge table scans and keeps
   * SQL simple. Seeds can be explicit recordIds per table or "all records" for tables that must be
   * fully included.
   */
  @Timing()
  async resolve(
    params: IResolveLinkCascadeParams
  ): Promise<Array<{ tableId: string; recordId: string }>> {
    const { explicitSeeds, allTableSeeds, edges } = params;
    const edgeBySrc = this.groupEdgesBySource(edges);
    if (!edgeBySrc.size) {
      return this.flattenSeeds(explicitSeeds, allTableSeeds);
    }

    const visited = new Map<string, VisitedSet>();
    const queue: Array<{ tableId: string; ids?: Set<string>; all: boolean }> = [];

    // seed explicit ids
    for (const seed of explicitSeeds) {
      if (!seed.recordIds?.length) continue;
      const existing = visited.get(seed.tableId);
      if (existing === ALL_RECORDS) {
        continue;
      }
      const set = this.getOrInitSet(visited, seed.tableId);
      seed.recordIds.forEach((id) => {
        if (id) set.add(id);
      });
      queue.push({ tableId: seed.tableId, ids: new Set(seed.recordIds), all: false });
    }

    // seed all-table entries without materializing ids up front; use ALL sentinel and push work to DB
    if (allTableSeeds.length) {
      for (const seed of allTableSeeds) {
        if (!seed.tableId) continue;
        visited.set(seed.tableId, ALL_RECORDS);
        queue.push({ tableId: seed.tableId, all: true });
      }
    }

    while (queue.length) {
      const { tableId, ids, all } = queue.shift()!;
      const edgesFromTable = edgeBySrc.get(tableId);
      if (!edgesFromTable?.length) continue;
      const frontierIds = all ? [] : Array.from(ids ?? []).filter(Boolean);
      if (!all && !frontierIds.length) continue;

      const additionsByTable = new Map<string, Set<string>>();

      for (const edge of edgesFromTable) {
        const dstVisited = visited.get(edge.hostTableId);
        if (dstVisited === ALL_RECORDS) {
          continue; // already fully included
        }

        const rows = all
          ? await this.fetchEdgeTargetsFromAll(edge)
          : await this.fetchEdgeTargetsBatched(edge, frontierIds);

        if (!rows.length) continue;

        const dstSet = this.getOrInitSet(visited, edge.hostTableId);
        let added = additionsByTable.get(edge.hostTableId);
        if (!added) {
          added = new Set<string>();
          additionsByTable.set(edge.hostTableId, added);
        }
        for (const row of rows) {
          const rid = row.record_id;
          if (!rid || dstSet.has(rid)) continue;
          dstSet.add(rid);
          added.add(rid);
        }
      }

      for (const [dstTable, newIds] of additionsByTable) {
        if (newIds.size) {
          queue.push({ tableId: dstTable, ids: newIds, all: false });
        }
      }
    }

    const result: Array<{ tableId: string; recordId: string }> = [];
    for (const [tableId, set] of visited) {
      if (set === ALL_RECORDS) {
        continue;
      }
      for (const id of set) {
        result.push({ tableId, recordId: id });
      }
    }
    return result;
  }

  private groupEdgesBySource(edges: ILinkEdge[]): Map<string, ILinkEdge[]> {
    const map = new Map<string, ILinkEdge[]>();
    edges.forEach((edge) => {
      const key = edge.foreignTableId;
      if (!key) return;
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(edge);
    });
    return map;
  }

  private getOrInitSet(map: Map<string, VisitedSet>, key: string): Set<string> {
    const existing = map.get(key);
    if (existing && existing !== ALL_RECORDS) {
      return existing;
    }
    const set = new Set<string>();
    map.set(key, set);
    return set;
  }

  private flattenSeeds(
    explicitSeeds: IExplicitLinkSeed[],
    allTableSeeds: IAllTableLinkSeed[]
  ): Array<{ tableId: string; recordId: string }> {
    const rows: Array<{ tableId: string; recordId: string }> = [];
    explicitSeeds.forEach((s) =>
      s.recordIds?.forEach((id) => {
        if (id) rows.push({ tableId: s.tableId, recordId: id });
      })
    );
    // allTableSeeds skipped here; caller typically handles ALL separately if no edges
    return rows;
  }

  private async fetchEdgeTargets(
    edge: ILinkEdge,
    srcIds: string[]
  ): Promise<Array<{ record_id?: string }>> {
    if (!srcIds.length) return [];
    const placeholders = srcIds.map((_, i) => `$${i + 1}`).join(', ');
    const fkTableRef = this.formatQualifiedName(edge.fkTableName);
    const srcCol = this.quoteIdentifier(edge.foreignKeyName);
    const dstCol = this.quoteIdentifier(edge.selfKeyName);
    const sql = `select ${dstCol}::text as record_id
from ${fkTableRef}
where ${srcCol} in (${placeholders})
  and ${srcCol} is not null
  and ${dstCol} is not null`;
    return await this.prismaService
      .txClient()
      .$queryRawUnsafe<Array<{ record_id?: string }>>(sql, ...srcIds);
  }

  private async fetchEdgeTargetsBatched(
    edge: ILinkEdge,
    srcIds: string[]
  ): Promise<Array<{ record_id?: string }>> {
    if (!srcIds.length) return [];
    const batches = chunk(srcIds, IN_CHUNK);
    const batchResults = await Promise.all(
      batches.map((batch) => this.fetchEdgeTargets(edge, batch))
    );
    return batchResults.flat();
  }

  private async fetchEdgeTargetsFromAll(edge: ILinkEdge): Promise<Array<{ record_id?: string }>> {
    const fkTableRef = this.formatQualifiedName(edge.fkTableName);
    const srcCol = this.quoteIdentifier(edge.foreignKeyName);
    const dstCol = this.quoteIdentifier(edge.selfKeyName);
    const sql = `select distinct ${dstCol}::text as record_id
from ${fkTableRef}
where ${srcCol} is not null
  and ${dstCol} is not null`;
    return this.prismaService.txClient().$queryRawUnsafe<Array<{ record_id?: string }>>(sql);
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private formatQualifiedName(qualified: string): string {
    return qualified
      .split('.')
      .map((part) => this.quoteIdentifier(part))
      .join('.');
  }
}
