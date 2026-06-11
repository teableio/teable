import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Effect, Layer } from 'effect';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  DataDbMigrationInspector,
  type DataDbMigrationStatusInput,
  type DataDbMigrationStatusOutput,
  type DataDbMigrationStatusRawRow,
  type DataDbMigrationStatusRow,
  toDataDbMigrationStatusRow,
} from '../services/DataDbMigrationInspector';

const activeMigrationStates = [
  'pending',
  'preflight',
  'freezing_writes',
  'copying',
  'validating',
  'switching',
];

const migrationStatusColumns: ReadonlyArray<keyof DataDbMigrationStatusRow & string> = [
  'jobId',
  'spaceId',
  'state',
  'targetMode',
  'targetConnectionId',
  'targetHost',
  'targetDatabase',
  'targetInternalSchema',
  'phase',
  'percent',
  'estimatedTotalBytes',
  'completedEstimatedBytes',
  'estimatedTotalRows',
  'completedEstimatedRows',
  'etaMs',
  'validationPhase',
  'baseCheckCount',
  'sharedCheckCount',
  'mismatchCount',
  'rollbackEligible',
  'rollbackFindingCount',
  'rollbackSwitchedAt',
  'rollbackCheckedAt',
  'lastError',
  'startedAt',
  'completedAt',
  'createdTime',
  'lastModifiedTime',
];

const normalizeLimit = (value: number | undefined): number => {
  const resolved = value ?? 20;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new CliError({
      message: 'limit must be a positive number.',
      code: 'INVALID_LIMIT',
      details: { limit: resolved },
    });
  }
  return Math.min(Math.floor(resolved), 500);
};

const getStatus = (
  db: Kysely<V1TeableDatabase>,
  input: DataDbMigrationStatusInput
): Effect.Effect<DataDbMigrationStatusOutput, CliError> =>
  Effect.tryPromise({
    try: async () => {
      const limit = normalizeLimit(input.limit);
      const conditions = [];
      if (input.jobId) {
        conditions.push(sql`j.id = ${input.jobId}`);
      } else {
        if (input.spaceId) {
          conditions.push(sql`j.space_id = ${input.spaceId}`);
        }
        if (!input.includeHistory) {
          conditions.push(sql`j.state::text = ANY(${activeMigrationStates})`);
        }
      }

      const whereSql = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
      const result = await sql<DataDbMigrationStatusRawRow>`
        SELECT
          j.id AS "jobId",
          j.space_id AS "spaceId",
          j.state::text AS "state",
          j.target_mode AS "targetMode",
          j.target_connection_id AS "targetConnectionId",
          c.display_host AS "targetHost",
          c.display_database AS "targetDatabase",
          j.target_internal_schema AS "targetInternalSchema",
          j.copy_stats AS "copyStats",
          j.validation_stats AS "validationStats",
          j.last_error AS "lastError",
          j.started_at AS "startedAt",
          j.completed_at AS "completedAt",
          j.created_time AS "createdTime",
          j.last_modified_time AS "lastModifiedTime"
        FROM space_data_db_migration_job AS j
        LEFT JOIN data_db_connection AS c ON c.id = j.target_connection_id
        ${whereSql}
        ORDER BY j.created_time DESC
        LIMIT ${limit}
      `.execute(db);
      const rows = result.rows.map(toDataDbMigrationStatusRow);

      return {
        snapshotAt: new Date().toISOString(),
        filters: {
          ...(input.spaceId ? { spaceId: input.spaceId } : {}),
          ...(input.jobId ? { jobId: input.jobId } : {}),
          includeHistory: Boolean(input.includeHistory),
          limit,
        },
        total: rows.length,
        migrationTable: {
          columns: migrationStatusColumns,
          rows,
        },
        notes: input.jobId
          ? []
          : input.includeHistory
            ? ['Historical migration jobs are included; output is ordered by created_time desc.']
            : [
                'Only active migration states are shown. Use --include-history to include terminal jobs.',
              ],
      };
    },
    catch: (error) =>
      new CliError({
        message: error instanceof Error ? error.message : String(error),
        code: 'DATA_DB_MIGRATION_STATUS_QUERY_FAILED',
        details: {
          hint: 'Confirm the meta database has the space_data_db_migration_job migration applied.',
        },
      }),
  });

export const DataDbMigrationInspectorLive = Layer.effect(
  DataDbMigrationInspector,
  Effect.gen(function* () {
    const { container } = yield* Database;
    const db = container.resolve(v2MetaDbTokens.db) as Kysely<V1TeableDatabase>;

    return {
      getStatus: (input: DataDbMigrationStatusInput) => getStatus(db, input),
    };
  })
);
