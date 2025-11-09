/* eslint-disable @typescript-eslint/naming-convention */
import type { PrismaService } from '@teable/db-main-prisma';

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

export class LinkCascadeResolver {
  constructor(private readonly prismaService: PrismaService) {}

  async resolve(
    params: IResolveLinkCascadeParams
  ): Promise<Array<{ tableId: string; recordId: string }>> {
    const { explicitSeeds, allTableSeeds, edges } = params;
    if (!edges.length) {
      return [];
    }
    const anchorClauses = this.buildAnchorClauses(explicitSeeds, allTableSeeds);
    if (!anchorClauses.length) {
      return [];
    }
    const graphEdgeClauses = this.buildGraphEdgeClauses(edges);
    if (!graphEdgeClauses.length) {
      return [];
    }

    const state = { index: 0, bindings: [] as unknown[] };
    const anchorSelects = anchorClauses
      .map((clause) => this.replacePlaceholders(clause.sql, clause.bindings, state))
      .join('\nunion all\n');
    const anchorSql = `select seed.table_id, seed.record_id from (${anchorSelects}) as seed`;
    const graphEdgeSelects = graphEdgeClauses
      .map((clause) => this.replacePlaceholders(clause.sql, clause.bindings, state))
      .join('\nunion all\n');

    const sql = `with recursive
seed(table_id, record_id) as (
${anchorSql}
),
graph_edges(src_table_id, src_record_id, dst_table_id, dst_record_id) as (
${graphEdgeSelects}
),
link_reach(table_id, record_id) as (
  select table_id::text, record_id::text
  from seed

  union

  select ge.dst_table_id::text, ge.dst_record_id::text
  from link_reach lr
  join graph_edges ge
    on ge.src_table_id = lr.table_id
   and ge.src_record_id = lr.record_id
)
select table_id, record_id
from link_reach`;

    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<Array<{ table_id?: string; record_id?: string }>>(sql, ...state.bindings);

    const result: Array<{ tableId: string; recordId: string }> = [];
    for (const row of rows) {
      const tableId = row.table_id;
      const recordId = row.record_id;
      if (!tableId || !recordId) {
        continue;
      }
      result.push({ tableId, recordId });
    }
    return result;
  }

  private buildAnchorClauses(
    explicitSeeds: IExplicitLinkSeed[],
    allTableSeeds: IAllTableLinkSeed[]
  ): Array<{ sql: string; bindings: unknown[] }> {
    const clauses: Array<{ sql: string; bindings: unknown[] }> = [];

    if (explicitSeeds.length) {
      const explicitRows = explicitSeeds.flatMap((seed) =>
        seed.recordIds.map((id) => ({ table_id: seed.tableId, record_id: id }))
      );
      if (explicitRows.length) {
        clauses.push({
          sql: `select seed.table_id::text, seed.record_id::text
from jsonb_to_recordset(?::jsonb) as seed(table_id text, record_id text)`,
          bindings: [JSON.stringify(explicitRows)],
        });
      }
    }

    allTableSeeds.forEach((seed, index) => {
      const alias = `all_seed_${index}`;
      clauses.push({
        sql: `select ?::text as table_id, ${alias}."__id"::text as record_id from ${this.formatQualifiedName(
          seed.dbTableName
        )} as ${alias}`,
        bindings: [seed.tableId],
      });
    });

    return clauses;
  }

  private buildGraphEdgeClauses(edges: ILinkEdge[]): Array<{ sql: string; bindings: unknown[] }> {
    return edges.map((edge, index) => {
      const alias = `fk_${index}`;
      const fkTableRef = `${this.formatQualifiedName(edge.fkTableName)} as ${alias}`;
      const dstCol = `${alias}.${this.quoteIdentifier(edge.selfKeyName)}`;
      const srcCol = `${alias}.${this.quoteIdentifier(edge.foreignKeyName)}`;
      const sql = `select
  ?::text as src_table_id,
  ${srcCol}::text as src_record_id,
  ?::text as dst_table_id,
  ${dstCol}::text as dst_record_id
from ${fkTableRef}
where ${srcCol} is not null
  and ${dstCol} is not null`;

      return {
        sql,
        bindings: [edge.foreignTableId, edge.hostTableId],
      };
    });
  }

  private replacePlaceholders(
    sql: string,
    clauseBindings: unknown[],
    state: { index: number; bindings: unknown[] }
  ): string {
    const replaced = sql.replace(/\?/g, () => {
      state.index += 1;
      return `$${state.index}`;
    });
    state.bindings.push(...clauseBindings);
    return replaced;
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
