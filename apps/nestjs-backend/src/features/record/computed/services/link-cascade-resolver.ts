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

    const visited = new Map<string, Set<string>>();
    const queue: Array<{ tableId: string; ids: Set<string> }> = [];

    // seed explicit ids
    for (const seed of explicitSeeds) {
      if (!seed.recordIds?.length) continue;
      const set = this.getOrInitSet(visited, seed.tableId);
      seed.recordIds.forEach((id) => {
        if (id) set.add(id);
      });
      queue.push({ tableId: seed.tableId, ids: new Set(seed.recordIds) });
    }

    // seed all-table entries by materializing ids once
    if (allTableSeeds.length) {
      const rows = await this.materializeAllTableSeeds(allTableSeeds);
      for (const { tableId, recordId } of rows) {
        const set = this.getOrInitSet(visited, tableId);
        if (!set.has(recordId)) {
          set.add(recordId);
        }
      }
      // push as frontier grouped by table
      const grouped = rows.reduce((map, row) => {
        let s = map.get(row.tableId);
        if (!s) {
          s = new Set<string>();
          map.set(row.tableId, s);
        }
        s.add(row.recordId);
        return map;
      }, new Map<string, Set<string>>());
      for (const [tableId, ids] of grouped) {
        queue.push({ tableId, ids });
      }
    }

    while (queue.length) {
      const { tableId, ids } = queue.shift()!;
      const edgesFromTable = edgeBySrc.get(tableId);
      if (!edgesFromTable?.length) continue;
      const frontierIds = Array.from(ids).filter(Boolean);
      if (!frontierIds.length) continue;

      for (const edge of edgesFromTable) {
        for (const batch of chunk(frontierIds, IN_CHUNK)) {
          const rows = await this.fetchEdgeTargets(edge, batch);
          if (!rows.length) continue;
          const dstSet = this.getOrInitSet(visited, edge.hostTableId);
          const newlyAdded = new Set<string>();
          for (const row of rows) {
            const rid = row.record_id;
            if (!rid || dstSet.has(rid)) continue;
            dstSet.add(rid);
            newlyAdded.add(rid);
          }
          if (newlyAdded.size) {
            queue.push({ tableId: edge.hostTableId, ids: newlyAdded });
          }
        }
      }
    }

    const result: Array<{ tableId: string; recordId: string }> = [];
    for (const [tableId, set] of visited) {
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

  private getOrInitSet(map: Map<string, Set<string>>, key: string): Set<string> {
    let set = map.get(key);
    if (!set) {
      set = new Set<string>();
      map.set(key, set);
    }
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

  private async materializeAllTableSeeds(
    seeds: IAllTableLinkSeed[]
  ): Promise<Array<{ tableId: string; recordId: string }>> {
    const rows: Array<{ tableId: string; recordId: string }> = [];
    for (const seed of seeds) {
      const sql = `select "__id"::text as record_id from ${this.formatQualifiedName(
        seed.dbTableName
      )} where "__id" is not null`;
      const res = await this.prismaService.$queryRawUnsafe<Array<{ record_id?: string }>>(sql);
      for (const row of res) {
        if (row.record_id) {
          rows.push({ tableId: seed.tableId, recordId: row.record_id });
        }
      }
    }
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
    return this.prismaService.$queryRawUnsafe<Array<{ record_id?: string }>>(sql, ...srcIds);
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
