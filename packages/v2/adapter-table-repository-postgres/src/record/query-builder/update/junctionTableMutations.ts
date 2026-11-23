import type { CompiledQuery, Kysely, SqlBool } from 'kysely';
import { sql } from 'kysely';

import type { DynamicDB } from '../ITableRecordQueryBuilder';

export type JunctionTableReplacement = {
  tableName: string;
  selfKeyName: string;
  foreignKeyName: string;
  orderColumnName: string | null;
  recordId: string;
  linkItems: ReadonlyArray<{ id: string }>;
};

type JunctionReplacementGroup = {
  selfKeyName: string;
  foreignKeyName: string;
  orderColumnName: string | null;
  linksByRecordId: Map<string, JunctionTableReplacement['linkItems']>;
};

export const buildJunctionTableBatchReplaceQueries = (
  db: Kysely<DynamicDB>,
  replacements: ReadonlyArray<JunctionTableReplacement>,
  writtenRecordIds: ReadonlySet<string>
): CompiledQuery[] => {
  const statements: CompiledQuery[] = [];
  const groups = new Map<string, JunctionReplacementGroup>();

  const appendQueries = (tableName: string, group: JunctionReplacementGroup) => {
    const { selfKeyName, foreignKeyName, orderColumnName, linksByRecordId } = group;
    const recordIds = [...linksByRecordId.keys()];
    statements.push(
      db
        .deleteFrom(tableName)
        .where(sql<SqlBool>`${sql.id(selfKeyName)} = ANY(${recordIds}::text[])`)
        .compile()
    );

    const sourceIds: string[] = [];
    const targetIds: string[] = [];
    const orders: number[] | undefined = orderColumnName ? [] : undefined;
    for (const [recordId, linkItems] of linksByRecordId) {
      for (const [index, linkItem] of linkItems.entries()) {
        sourceIds.push(recordId);
        targetIds.push(linkItem.id);
        orders?.push(index + 1);
      }
    }
    if (targetIds.length === 0) return;

    const columns = [selfKeyName, foreignKeyName];
    const arrays = [sql`${sourceIds}::text[]`, sql`${targetIds}::text[]`];
    if (orderColumnName) {
      columns.push(orderColumnName);
      arrays.push(sql`${orders}::integer[]`);
    }
    statements.push(
      db
        .insertInto(tableName)
        .columns(columns)
        .expression(sql`select * from unnest(${sql.join(arrays)})`)
        .compile()
    );
  };

  for (const replacement of replacements) {
    const { tableName, selfKeyName, foreignKeyName, orderColumnName, recordId, linkItems } =
      replacement;
    if (!writtenRecordIds.has(recordId)) continue;

    let group = groups.get(tableName);
    if (
      group &&
      (group.selfKeyName !== selfKeyName ||
        group.foreignKeyName !== foreignKeyName ||
        group.orderColumnName !== orderColumnName ||
        group.linksByRecordId.has(recordId))
    ) {
      // Reciprocal fields on a self-link, or repeat writes to one source, can replace the same edge.
      appendQueries(tableName, group);
      group = undefined;
    }
    if (!group) {
      group = { selfKeyName, foreignKeyName, orderColumnName, linksByRecordId: new Map() };
      groups.set(tableName, group);
    }
    group.linksByRecordId.set(recordId, linkItems);
  }

  for (const [tableName, group] of groups) {
    appendQueries(tableName, group);
  }
  return statements;
};
