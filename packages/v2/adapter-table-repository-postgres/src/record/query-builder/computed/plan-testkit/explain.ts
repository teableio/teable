import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CompiledQuery, sql, type Kysely } from 'kysely';

export type PlanNode = {
  'Node Type': string;
  'Function Name'?: string;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
};

type ExplainDocument = {
  Plan: PlanNode;
  'Planning Time': number;
  'Execution Time': number;
  Planning?: { 'Memory Used'?: number; 'Memory Allocated'?: number };
};

export const flattenPlan = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(flattenPlan),
];

export const explainUpdate = async <DB>(db: Kysely<DB>, query: CompiledQuery, name: string) => {
  const directory = resolve(process.env.FORMULA_PLAN_ARTIFACT_DIR ?? 'formula-plan-artifacts');
  await mkdir(directory, { recursive: true });
  // Persist SQL before planning: the reproducer survives a server OOM or timeout.
  await writeFile(resolve(directory, `${name}.sql`), query.sql);
  await writeFile(
    resolve(directory, `${name}.parameters.json`),
    JSON.stringify(query.parameters, null, 2)
  );
  const version = await sql<{
    version: number;
  }>`SELECT current_setting('server_version_num')::integer AS version`.execute(db);
  const memoryOption = version.rows[0].version >= 170000 ? ', MEMORY' : '';
  const planned = await db.executeQuery<{ 'QUERY PLAN': ExplainDocument[] }>(
    CompiledQuery.raw(`EXPLAIN (VERBOSE, FORMAT JSON${memoryOption}) ${query.sql}`, [
      ...query.parameters,
    ])
  );
  const planning = planned.rows[0]['QUERY PLAN'][0];
  await writeFile(resolve(directory, `${name}.planning.json`), JSON.stringify(planning, null, 2));
  // PG reports planning memory in KiB. Fail before executing a bloated plan.
  const planningMemoryKiB = planning.Planning?.['Memory Allocated'];
  if (memoryOption && (planningMemoryKiB == null || planningMemoryKiB > 16 * 1024)) {
    throw new Error(`Formula planning memory exceeded 16 MiB: ${planningMemoryKiB} KiB`);
  }
  const result = await db.executeQuery<{ 'QUERY PLAN': ExplainDocument[] }>(
    CompiledQuery.raw(`EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON, TIMING OFF) ${query.sql}`, [
      ...query.parameters,
    ])
  );
  const document = result.rows[0]['QUERY PLAN'][0];
  await writeFile(resolve(directory, `${name}.json`), JSON.stringify(document, null, 2));
  const nodes = flattenPlan(document.Plan);
  // Output, Filter, Function Call, etc. can contain giant expressions even if
  // the optimizer reports few nodes; measure all node-local string properties.
  const expressionBytes = nodes.reduce(
    (total, node) =>
      total +
      Object.entries(node)
        .filter(([key]) => key !== 'Plans')
        .reduce((size, [, value]) => size + JSON.stringify(value).length, 0),
    0
  );
  return {
    document,
    nodes,
    expressionBytes,
    planningMemoryKiB,
    sqlBytes: Buffer.byteLength(query.sql),
  };
};
