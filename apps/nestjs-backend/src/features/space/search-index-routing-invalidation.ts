import { getMetaDatabaseUrl } from '@teable/db-data-prisma';

export type ISearchIndexRoutingTransaction = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

type IRoutingScope = { baseId: string } | { spaceIds: string[] };

/** Must run in the metadata transaction that changes the data-database routing. */
export const invalidateSearchIndexesForDataDbRouting = async (
  prisma: ISearchIndexRoutingTransaction,
  scope: IRoutingScope
): Promise<void> => {
  const schema = new URL(getMetaDatabaseUrl()).searchParams.get('schema') || 'public';
  const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
  const configTableName = `${quotedSchema}."table_query_search_vector_config"`;
  // Lock/unpublish table_meta before config rows, matching serving publication.
  // RETURNING also fixes the config scope to exactly the tables unpublished here.
  const tables = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE ${quotedSchema}."table_meta"
     SET search_index = NULL, version = version + 1
     WHERE ${
       'baseId' in scope
         ? 'base_id = $1'
         : `base_id IN (SELECT id FROM ${quotedSchema}."base" WHERE space_id = ANY($1::text[]))`
     }
     RETURNING id`,
    'baseId' in scope ? scope.baseId : scope.spaceIds
  );
  if (!tables.length) return;

  // This management table is optional; routing must never provision it.
  const [configTable] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    'SELECT to_regclass($1::text) IS NOT NULL AS "exists"',
    configTableName
  );
  if (!configTable.exists) return;

  // Change xmin so pre-cutover reclaim evidence fails its CAS. Ready configs
  // remain adoptable after explicit physical validation; inactive ones stay inactive.
  // Neither old scan counters nor queued drops are valid in the new data DB.
  await prisma.$executeRawUnsafe(
    `UPDATE ${configTableName}
     SET last_modified_time = CURRENT_TIMESTAMP,
         reclaim_idx_scan_baseline = NULL,
         reclaim_sampled_at = NULL,
         reclaim_disabled_at = NULL,
         reclaim_drop_after = NULL,
         reclaim_drop_queued_at = NULL
     WHERE table_id = ANY($1::text[])`,
    tables.map(({ id }) => id)
  );
};
