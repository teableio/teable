import type { IExecutionContext } from '@teable/v2-core';
import type {
  TableSearchAccessPathCapability,
  TableSearchAccessPathCapabilityReader,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';

import { toInfrastructureError } from './helpers';
import type { UnknownPostgresDatabase } from './types';

type ExtensionCapabilityRow = {
  readonly name: string;
  readonly available: boolean;
  readonly installed: boolean;
  readonly shared_preload_libraries: string;
  readonly operator_class_schema: string | null;
};

const isPreloaded = (raw: string, extensionName: string): boolean =>
  raw
    .split(',')
    .map((item) => item.trim())
    .includes(extensionName);

const resolveCapabilityState = (
  row: ExtensionCapabilityRow,
  preloaded: boolean,
  operatorClassInstalled: boolean
): Pick<TableSearchAccessPathCapability, 'state' | 'reason'> => {
  if (!row.available) {
    return { state: 'unavailable', reason: `${row.name}_not_available` };
  }
  if (!preloaded) {
    return { state: 'requires_cluster_restart', reason: `${row.name}_not_preloaded` };
  }
  if (!row.installed) {
    return { state: 'requires_database_extension', reason: `${row.name}_not_installed` };
  }
  if (!operatorClassInstalled) {
    return { state: 'unavailable', reason: `${row.name}_operator_class_missing` };
  }
  return { state: 'ready' };
};

export const resolveSearchAccessPathCapability = (
  row: ExtensionCapabilityRow
): TableSearchAccessPathCapability => {
  const provider = row.name === 'pg_bigm' ? 'pg_bigm' : 'pg_trgm';
  const preloaded = provider === 'pg_trgm' || isPreloaded(row.shared_preload_libraries, row.name);
  const operatorClassInstalled = Boolean(row.operator_class_schema);
  const status = resolveCapabilityState(row, preloaded, operatorClassInstalled);

  return {
    provider,
    extensionName: provider,
    operatorClass: provider === 'pg_bigm' ? 'gin_bigm_ops' : 'gin_trgm_ops',
    ...(row.operator_class_schema ? { operatorClassSchema: row.operator_class_schema } : {}),
    operatorClassInstalled,
    minimumProbeLength: provider === 'pg_bigm' ? 2 : 3,
    state: status.state,
    installed: row.installed,
    available: row.available,
    preloaded,
    ...(status.reason ? { reason: status.reason } : {}),
  };
};

export const readPostgresSearchAccessPathCapabilities = async (
  db: Kysely<UnknownPostgresDatabase>
): Promise<ReadonlyArray<TableSearchAccessPathCapability>> => {
  const result = await sql<ExtensionCapabilityRow>`
    SELECT requested.name,
           available.name IS NOT NULL AS available,
           installed.extname IS NOT NULL AS installed,
           current_setting('shared_preload_libraries', true) AS shared_preload_libraries,
           operator_class.schema_name AS operator_class_schema
    FROM (VALUES ('pg_bigm'), ('pg_trgm')) AS requested(name)
    LEFT JOIN pg_available_extensions available ON available.name = requested.name
    LEFT JOIN pg_extension installed ON installed.extname = requested.name
    LEFT JOIN LATERAL (
      SELECT n.nspname AS schema_name
      FROM pg_opclass opc
      JOIN pg_namespace n ON n.oid = opc.opcnamespace
      JOIN pg_am am ON am.oid = opc.opcmethod
      WHERE opc.opcname = CASE requested.name
        WHEN 'pg_bigm' THEN 'gin_bigm_ops'
        ELSE 'gin_trgm_ops'
      END
        AND am.amname = 'gin'
      ORDER BY (n.nspname = ANY(current_schemas(true))) DESC, n.nspname
      LIMIT 1
    ) operator_class ON TRUE
    ORDER BY requested.name
  `.execute(db);
  return result.rows.map(resolveSearchAccessPathCapability);
};

export class PostgresTableSearchAccessPathCapabilityReader
  implements TableSearchAccessPathCapabilityReader
{
  constructor(private readonly db: Kysely<UnknownPostgresDatabase>) {}

  async read(_context: IExecutionContext) {
    try {
      return ok(await readPostgresSearchAccessPathCapabilities(this.db));
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to inspect search access path capability'));
    }
  }
}
