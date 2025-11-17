/* eslint-disable @typescript-eslint/naming-convention */
import type { PrismaService } from '@teable/db-main-prisma';
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

export class LinkCascadeResolver {
  constructor(private readonly prismaService: PrismaService) {}

  @Timing()
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

    const anchorState = { index: 0, bindings: [] as unknown[] };
    const anchorSelects = anchorClauses
      .map((clause) => this.replacePlaceholders(clause.sql, clause.bindings, anchorState))
      .join('\nunion all\n');

    const graphEdgeState = { index: 0, bindings: [] as unknown[] };
    const graphEdgeSelects = graphEdgeClauses
      .map((clause) => this.replacePlaceholders(clause.sql, clause.bindings, graphEdgeState))
      .join('\nunion all\n');

    const rows = await this.prismaService.$tx(async (tx) => {
      const tempTableName = this.buildTempTableName();
      await tx.$executeRawUnsafe(
        `create temporary table ${tempTableName} (
  src_table_id text not null,
  src_record_id text not null,
  dst_table_id text not null,
  dst_record_id text not null
) on commit drop`
      );

      await tx.$executeRawUnsafe(
        `insert into ${tempTableName} (src_table_id, src_record_id, dst_table_id, dst_record_id)
${graphEdgeSelects}`,
        ...graphEdgeState.bindings
      );

      await tx.$executeRawUnsafe(`create index on ${tempTableName} (src_table_id, src_record_id)`);

      const sql = `with recursive
seed(table_id, record_id) as (
${anchorSelects
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
),
link_reach(table_id, record_id) as (
  select table_id::text, record_id::text
  from seed

  union

  select e.dst_table_id::text, e.dst_record_id::text
  from link_reach lr
  join ${tempTableName} e
    on e.src_table_id = lr.table_id
   and e.src_record_id = lr.record_id
)
select distinct table_id, record_id
from link_reach`;

      return await tx.$queryRawUnsafe<Array<{ table_id?: string; record_id?: string }>>(
        sql,
        ...anchorState.bindings
      );
    });

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

  private buildTempTableName(): string {
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);
    return `pg_temp.${this.quoteIdentifier(`link_edges_${uniqueSuffix}`)}`;
  }
}
