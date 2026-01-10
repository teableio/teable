import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { domainError, type RecordId, type TableId } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql } from 'kysely';
import { err, ok } from 'neverthrow';

import type { IDebugMetaStore } from '../../ports/DebugMetaStore';
import type { IDebugRecordStore } from '../../ports/DebugRecordStore';
import { v2DebugDataTokens } from '../../di/tokens';
import type {
  DebugRawRecord,
  DebugRawRecordQueryOptions,
  DebugRawRecordQueryResult,
} from '../../types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

@injectable()
export class PostgresDebugRecordStore implements IDebugRecordStore {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2DebugDataTokens.metaStore)
    private readonly metaStore: IDebugMetaStore
  ) {}

  async getRawRecords(tableId: TableId, options?: DebugRawRecordQueryOptions) {
    try {
      const tableMeta = await this.metaStore.getTableMeta(tableId);
      if (tableMeta.isErr()) return err(tableMeta.error);
      if (!tableMeta.value) {
        return err(
          domainError.notFound({
            message: `Table ${tableId.toString()} not found`,
            details: { tableId: tableId.toString() },
          })
        );
      }

      const dbTableName = tableMeta.value.dbTableName;
      const limit = Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const offset = options?.offset ?? 0;

      // Get total count
      const countResult = await sql<{ count: string }>`
        SELECT COUNT(*)::text as count FROM ${sql.ref(dbTableName)}
      `.execute(this.db);
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      // Get records
      const records = await sql<DebugRawRecord>`
        SELECT * FROM ${sql.ref(dbTableName)}
        ORDER BY __auto_number ASC
        LIMIT ${sql.lit(limit)} OFFSET ${sql.lit(offset)}
      `.execute(this.db);

      return ok({
        dbTableName,
        records: records.rows,
        total,
      } satisfies DebugRawRecordQueryResult);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load raw records: ${describeError(error)}`,
        })
      );
    }
  }

  async getRawRecord(tableId: TableId, recordId: RecordId) {
    try {
      const tableMeta = await this.metaStore.getTableMeta(tableId);
      if (tableMeta.isErr()) return err(tableMeta.error);
      if (!tableMeta.value) {
        return err(
          domainError.notFound({
            message: `Table ${tableId.toString()} not found`,
            details: { tableId: tableId.toString() },
          })
        );
      }

      const dbTableName = tableMeta.value.dbTableName;

      const result = await sql<DebugRawRecord>`
        SELECT * FROM ${sql.ref(dbTableName)}
        WHERE __id = ${recordId.toString()}
      `.execute(this.db);

      return ok(result.rows[0] ?? null);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load raw record: ${describeError(error)}`,
        })
      );
    }
  }
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
