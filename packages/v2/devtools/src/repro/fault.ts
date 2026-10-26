import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

type FieldStorageRow = { schema_name: string; table_name: string; field_name: string };

/**
 * Local fault injection for verifying failure capture.
 *
 * `column-type-drift:<declaredFieldId>` rewrites the field's physical column to
 * boolean after rows are written. The next computed UPDATE targets that column
 * with its normal value type, so Postgres raises a real type error and the
 * worker dead-letters it with `failedSql`/`execution` diagnostics — the same
 * shape a drifted customer schema produces.
 */
export const applyColumnTypeDrift = async (input: {
  metaDb: Kysely<V1TeableDatabase>;
  fault: string;
  fieldIdMap: Record<string, string>;
}): Promise<string> => {
  const [kind, declaredFieldId] = input.fault.split(':', 2);
  if (kind !== 'column-type-drift' || !declaredFieldId) {
    throw new Error(
      `Unsupported --fault "${input.fault}". Supported: column-type-drift:<declaredFieldId>`
    );
  }
  const fieldId = input.fieldIdMap[declaredFieldId] ?? declaredFieldId;

  const result = await sql<FieldStorageRow>`
    select
      split_part(t."db_table_name", '.', 1) as "schema_name",
      split_part(t."db_table_name", '.', 2) as "table_name",
      f."db_field_name" as "field_name"
    from "field" f
    inner join "table_meta" t on t."id" = f."table_id"
    where f."id" = ${fieldId}
      and f."deleted_time" is null
    limit 1
  `.execute(input.metaDb);

  const storage = result.rows[0];
  if (!storage) throw new Error(`Field storage not found for ${declaredFieldId}`);
  if (!storage.schema_name) storage.schema_name = 'public';

  await sql
    .raw(
      `alter table ${quoteIdentifier(storage.schema_name)}.${quoteIdentifier(
        storage.table_name
      )} alter column ${quoteIdentifier(storage.field_name)} type boolean using null`
    )
    .execute(input.metaDb);

  return `fault: column-type-drift on ${declaredFieldId} (${storage.schema_name}.${storage.table_name}.${storage.field_name} -> boolean)`;
};

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
