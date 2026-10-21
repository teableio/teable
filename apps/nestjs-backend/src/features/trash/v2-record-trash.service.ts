/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { generateRecordTrashId } from '@teable/core';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { DELETED_RECORD_TRASH_MARKER_SNAPSHOT, type IExecutionContext } from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';
import type { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import { V2ContainerService } from '../v2/v2-container.service';

interface ITableTrashInsert {
  id: string;
  table_id: string;
  resource_type: string;
  snapshot: string;
  created_by: string;
  created_time: string;
}

type IRecordTrashInsertColumn =
  | 'id'
  | 'table_id'
  | 'record_id'
  | 'snapshot'
  | 'created_by'
  | 'created_time'
  | 'operation_id'
  | 'record_created_time'
  | 'record_created_by'
  | 'record_last_modified_time'
  | 'record_last_modified_by';

type TrashRecordTrashUpdate = {
  set(values: Record<string, unknown>): TrashRecordTrashUpdate;
  where(
    column: string,
    operator: string,
    value: string | ReadonlyArray<string>
  ): TrashRecordTrashUpdate;
  returning(column: 'record_id'): {
    execute(): Promise<ReadonlyArray<{ record_id: string }>>;
  };
};

type TrashTableTrashQuery = {
  select(columns: ReadonlyArray<'id' | 'snapshot' | 'created_time'>): TrashTableTrashQuery;
  where(column: string, operator: string, value: string): TrashTableTrashQuery;
  execute(): Promise<ReadonlyArray<{ id?: string; snapshot: unknown; created_time?: unknown }>>;
};

type TrashDbTransaction = {
  insertInto(table: 'table_trash'): {
    values(value: ITableTrashInsert): {
      executeTakeFirst(): Promise<unknown>;
    };
  };
  insertInto(table: 'record_trash'): {
    columns(columns: ReadonlyArray<IRecordTrashInsertColumn>): {
      expression(expression: RawBuilder<unknown>): {
        execute(): Promise<unknown>;
      };
    };
  };
  updateTable(table: 'record_trash'): TrashRecordTrashUpdate;
  selectFrom(table: 'table_trash'): TrashTableTrashQuery;
};

type TrashDbClient = {
  transaction(): {
    execute<T>(callback: (trx: TrashDbTransaction) => Promise<T>): Promise<T>;
  };
};

const RECORD_TRASH_BATCH_SIZE = 5000;
const RECORD_TRASH_RESOURCE_TYPE = 'record';

const toIsoTimestamp = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
};

const parseTableTrashRecordIds = (snapshot: unknown): string[] => {
  const parsed =
    typeof snapshot === 'string'
      ? (() => {
          try {
            return JSON.parse(snapshot) as unknown;
          } catch {
            return undefined;
          }
        })()
      : snapshot;
  return Array.isArray(parsed)
    ? parsed.filter((recordId): recordId is string => typeof recordId === 'string')
    : [];
};

@Injectable()
export class V2RecordTrashService {
  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async persistDeletedRecords(
    payload: IDeleteRecordsPayload,
    context?: Pick<IExecutionContext, 'tracer'>,
    options?: { fillExistingMarkers?: boolean }
  ): Promise<void> {
    const { operationId, tableId, userId, records } = payload;
    if (records.length === 0) {
      return;
    }

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const db = container.resolve(v2DataDbTokens.db) as TrashDbClient;
    const recordIds = records.map((record) => record.id);
    const createdTime = new Date().toISOString();
    let recordTrashCreatedTime = createdTime;

    await this.runInSpan(
      context,
      'teable.V2RecordTrashService.persistDeletedRecords',
      {
        'teable.table_id': tableId,
        'teable.record_count': records.length,
      },
      async () =>
        db.transaction().execute(async (trx) => {
          if (options?.fillExistingMarkers) {
            let updatedCount = 0;
            for (let i = 0; i < records.length; i += RECORD_TRASH_BATCH_SIZE) {
              const batch = records.slice(i, i + RECORD_TRASH_BATCH_SIZE);
              const rows = batch.map((record) => ({
                record_id: record.id,
                snapshot: record,
                record_created_time: record.createdTime
                  ? new Date(record.createdTime).toISOString()
                  : null,
                record_created_by: record.createdBy ?? null,
                record_last_modified_time: record.lastModifiedTime
                  ? new Date(record.lastModifiedTime).toISOString()
                  : null,
                record_last_modified_by: record.lastModifiedBy ?? null,
              }));
              // RETURNING, not Kysely's execute() row-count fields: update().execute()
              // returns UpdateResult[], so numUpdatedRows on the array is always
              // undefined and the recycle-bin table_trash row was skipped.
              const updated = await trx
                .updateTable('record_trash')
                .set({
                  snapshot: sql`(
                    SELECT (r -> 'snapshot')::text
                    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS r
                    WHERE r ->> 'record_id' = "record_trash"."record_id"
                  )`,
                  operation_id: operationId,
                  record_created_time: sql`(
                    SELECT (r ->> 'record_created_time')::timestamptz
                    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS r
                    WHERE r ->> 'record_id' = "record_trash"."record_id"
                  )`,
                  record_created_by: sql`(
                    SELECT r ->> 'record_created_by'
                    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS r
                    WHERE r ->> 'record_id' = "record_trash"."record_id"
                  )`,
                  record_last_modified_time: sql`(
                    SELECT (r ->> 'record_last_modified_time')::timestamptz
                    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS r
                    WHERE r ->> 'record_id' = "record_trash"."record_id"
                  )`,
                  record_last_modified_by: sql`(
                    SELECT r ->> 'record_last_modified_by'
                    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS r
                    WHERE r ->> 'record_id' = "record_trash"."record_id"
                  )`,
                })
                .where('table_id', '=', tableId)
                .where('reason', '=', 'deleted')
                .where('snapshot', '=', DELETED_RECORD_TRASH_MARKER_SNAPSHOT)
                .where(
                  'record_id',
                  'in',
                  batch.map((record) => record.id)
                )
                .returning('record_id')
                .execute();
              updatedCount += updated.length;
            }

            if (updatedCount > 0) {
              await trx
                .insertInto('table_trash')
                .values({
                  id: operationId,
                  table_id: tableId,
                  resource_type: RECORD_TRASH_RESOURCE_TYPE,
                  snapshot: JSON.stringify(recordIds),
                  created_by: userId,
                  created_time: createdTime,
                })
                .executeTakeFirst();
              return;
            }

            const indexRows = await trx
              .selectFrom('table_trash')
              .select(['id', 'snapshot', 'created_time'])
              .where('table_id', '=', tableId)
              .where('resource_type', '=', RECORD_TRASH_RESOURCE_TYPE)
              .execute();
            const recordIdSet = new Set(recordIds);
            const matchingIndex = indexRows.find((row) =>
              parseTableTrashRecordIds(row.snapshot).some((recordId) => recordIdSet.has(recordId))
            );
            if (!matchingIndex) {
              return;
            }
            recordTrashCreatedTime =
              toIsoTimestamp(matchingIndex.created_time) ?? recordTrashCreatedTime;
          } else {
            await trx
              .insertInto('table_trash')
              .values({
                id: operationId,
                table_id: tableId,
                resource_type: RECORD_TRASH_RESOURCE_TYPE,
                snapshot: JSON.stringify(recordIds),
                created_by: userId,
                created_time: createdTime,
              })
              .executeTakeFirst();
          }

          for (let i = 0; i < records.length; i += RECORD_TRASH_BATCH_SIZE) {
            const batch = records.slice(i, i + RECORD_TRASH_BATCH_SIZE);
            // One jsonb parameter instead of a multi-VALUES statement: 5k rows
            // would otherwise compile to ~55k bind params, and the statement
            // build + parse dominates bulk-delete latency.
            const rows = batch.map((record) => ({
              id: generateRecordTrashId(),
              record_id: record.id,
              record_created_time: record.createdTime
                ? new Date(record.createdTime).toISOString()
                : null,
              record_created_by: record.createdBy ?? null,
              record_last_modified_time: record.lastModifiedTime
                ? new Date(record.lastModifiedTime).toISOString()
                : null,
              record_last_modified_by: record.lastModifiedBy ?? null,
              snapshot: record,
            }));
            // insertInto() keeps the table node on the Kysely AST so BYODB
            // internal-schema rewriting still applies; raw SQL would resolve
            // "record_trash" against the connection default schema instead.
            await trx
              .insertInto('record_trash')
              .columns([
                'id',
                'table_id',
                'record_id',
                'snapshot',
                'created_by',
                'created_time',
                'operation_id',
                'record_created_time',
                'record_created_by',
                'record_last_modified_time',
                'record_last_modified_by',
              ])
              .expression(
                sql`select
                  r ->> 'id',
                  ${tableId},
                  r ->> 'record_id',
                  (r -> 'snapshot')::text,
                  ${userId},
                  ${recordTrashCreatedTime}::timestamptz,
                  ${operationId ?? null},
                  (r ->> 'record_created_time')::timestamptz,
                  r ->> 'record_created_by',
                  (r ->> 'record_last_modified_time')::timestamptz,
                  r ->> 'record_last_modified_by'
                from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) as r`
              )
              .execute();
          }
        })
    );
  }

  private async runInSpan<T>(
    context: Pick<IExecutionContext, 'tracer'> | undefined,
    name: `teable.${string}`,
    attributes: Record<string, string | number | boolean>,
    callback: () => Promise<T>
  ): Promise<T> {
    const tracer = context?.tracer;
    const span = tracer?.startSpan(name, {
      'teable.version': 'v2',
      'teable.component': 'service',
      'teable.operation': name.replace(/^teable\./, ''),
      ...attributes,
    });

    if (!tracer || !span) {
      return callback();
    }

    return tracer.withSpan(span, async () => {
      try {
        return await callback();
      } finally {
        span.end();
      }
    });
  }
}
