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
  from(expression: unknown): TrashRecordTrashUpdate;
  set(values: Record<string, unknown>): TrashRecordTrashUpdate;
  where(
    columnOrExpr: unknown,
    operator?: string,
    value?: string | ReadonlyArray<string>
  ): TrashRecordTrashUpdate;
  returning(column: 'record_id'): {
    execute(): Promise<ReadonlyArray<{ record_id: string }>>;
  };
};

type TrashTableTrashUpdate = {
  set(values: { snapshot: string; created_time: string }): TrashTableTrashUpdate;
  where(columnOrExpr: unknown, operator?: string, value?: string): TrashTableTrashUpdate;
  executeTakeFirst(): Promise<unknown>;
};

type TrashTableTrashQuery = {
  select(columns: ReadonlyArray<'id' | 'snapshot' | 'created_time'>): TrashTableTrashQuery;
  where(columnOrExpr: unknown, operator?: string, value?: string): TrashTableTrashQuery;
  orderBy(column: 'created_time' | 'id', direction: 'asc' | 'desc'): TrashTableTrashQuery;
  limit(limit: number): TrashTableTrashQuery;
  offset(offset: number): TrashTableTrashQuery;
  forUpdate(): TrashTableTrashQuery;
  execute(): Promise<ReadonlyArray<{ id?: string; snapshot: unknown; created_time?: unknown }>>;
  executeTakeFirst(): Promise<
    { id?: string; snapshot: unknown; created_time?: unknown } | undefined
  >;
};

type TrashRecordTrashProbeQuery = {
  select(column: 'record_id'): TrashRecordTrashProbeQuery;
  where(columnOrExpr: unknown, operator?: string, value?: string): TrashRecordTrashProbeQuery;
  limit(limit: number): TrashRecordTrashProbeQuery;
  execute(): Promise<ReadonlyArray<{ record_id: string }>>;
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
  updateTable(table: 'table_trash'): TrashTableTrashUpdate;
  selectFrom(table: 'table_trash'): TrashTableTrashQuery;
  selectFrom(table: 'record_trash'): TrashRecordTrashProbeQuery;
};

type TrashDbClient = {
  transaction(): {
    execute<T>(callback: (trx: TrashDbTransaction) => Promise<T>): Promise<T>;
  };
};

const MAX_RECORD_TRASH_BATCH_ROWS = 250;
const MAX_RECORD_TRASH_BATCH_BYTES = 1 * 1024 * 1024;
const MAX_TABLE_TRASH_FALLBACK_PAGE_SIZE = 50;
const MAX_TABLE_TRASH_FALLBACK_PAGES = 20;
const RECORD_TRASH_RESOURCE_TYPE = 'record';

const stringifyTrashJsonForJsonb = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'string' && item.includes('\u0000') ? item.replaceAll('\u0000', '') : item
  );

const deduplicateTrashRecordsById = <T extends { id: string }>(
  records: ReadonlyArray<T>
): ReadonlyArray<T> => {
  if (records.length <= 1) {
    return records;
  }
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    unique.push(record);
  }
  return unique;
};

const splitTrashRecordBatches = <T>(records: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> => {
  if (records.length === 0) {
    return [];
  }

  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentBytes = 0;

  for (const record of records) {
    const estimatedBytes = Buffer.byteLength(stringifyTrashJsonForJsonb(record), 'utf8') + 256;
    const wouldExceedRows = currentBatch.length >= MAX_RECORD_TRASH_BATCH_ROWS;
    const wouldExceedBytes =
      currentBatch.length > 0 && currentBytes + estimatedBytes > MAX_RECORD_TRASH_BATCH_BYTES;

    if (wouldExceedRows || wouldExceedBytes) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(record);
    currentBytes += estimatedBytes;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
};

const toIsoTimestamp = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
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
    const uniqueRecords = deduplicateTrashRecordsById(records);
    if (uniqueRecords.length === 0) {
      return;
    }

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const db = container.resolve(v2DataDbTokens.db) as TrashDbClient;
    const recordIds = uniqueRecords.map((record) => record.id);
    const createdTime = new Date().toISOString();
    let recordTrashCreatedTime = createdTime;

    await this.runInSpan(
      context,
      'teable.V2RecordTrashService.persistDeletedRecords',
      {
        'teable.table_id': tableId,
        'teable.record_count': uniqueRecords.length,
      },
      async () =>
        db.transaction().execute(async (trx) => {
          const batches = splitTrashRecordBatches(uniqueRecords);
          if (options?.fillExistingMarkers) {
            const matchedCreatedTime = await this.handleFillExistingMarkers(trx, {
              tableId,
              operationId,
              userId,
              createdTime,
              uniqueRecords,
              recordIds,
              batches,
            });
            if (!matchedCreatedTime) {
              return;
            }
            recordTrashCreatedTime = matchedCreatedTime;
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

          await this.insertRecordTrashBatches(trx, {
            tableId,
            userId,
            operationId,
            createdTime: recordTrashCreatedTime,
            batches,
          });
        })
    );
  }

  private async handleFillExistingMarkers(
    trx: TrashDbTransaction,
    params: {
      tableId: string;
      operationId: string;
      userId: string;
      createdTime: string;
      uniqueRecords: ReadonlyArray<IDeleteRecordsPayload['records'][number]>;
      recordIds: ReadonlyArray<string>;
      batches: ReadonlyArray<ReadonlyArray<IDeleteRecordsPayload['records'][number]>>;
    }
  ): Promise<string | undefined> {
    const markerProbe = await trx
      .selectFrom('record_trash')
      .select('record_id')
      .where('table_id', '=', params.tableId)
      .where('reason', '=', 'deleted')
      .where('snapshot', '=', DELETED_RECORD_TRASH_MARKER_SNAPSHOT)
      .where(sql<boolean>`${sql.ref('record_trash.record_id')} = ANY(${params.recordIds}::text[])`)
      .limit(1)
      .execute();

    const updatedRecordIds = new Set<string>();
    if (markerProbe.length > 0) {
      for (const batch of params.batches) {
        const rows = batch.map((record) => ({
          record_id: record.id,
          snapshot: record,
          record_created_time: toIsoTimestamp(record.createdTime) ?? null,
          record_created_by: record.createdBy ?? null,
          record_last_modified_time: toIsoTimestamp(record.lastModifiedTime) ?? null,
          record_last_modified_by: record.lastModifiedBy ?? null,
        }));
        const serializedRows = stringifyTrashJsonForJsonb(rows);
        const batchRecordIds = batch.map((record) => record.id);
        // Bind serializedRows once via FROM jsonb_array_elements and join in
        // WHERE; repeating the payload in 5 correlated subqueries causes
        // PostgreSQL O(N^2) JSONB expansion and backend OOM on wide rows.
        const updated = await trx
          .updateTable('record_trash')
          .from(sql`jsonb_array_elements(${serializedRows}::jsonb) as r`)
          .set({
            snapshot: sql`(r -> 'snapshot')::text`,
            operation_id: params.operationId,
            record_created_time: sql`(r ->> 'record_created_time')::timestamptz`,
            record_created_by: sql`r ->> 'record_created_by'`,
            record_last_modified_time: sql`(r ->> 'record_last_modified_time')::timestamptz`,
            record_last_modified_by: sql`r ->> 'record_last_modified_by'`,
          })
          .where('table_id', '=', params.tableId)
          .where('reason', '=', 'deleted')
          .where('snapshot', '=', DELETED_RECORD_TRASH_MARKER_SNAPSHOT)
          .where(
            sql<boolean>`${sql.ref('record_trash.record_id')} = ANY(${batchRecordIds}::text[])`
          )
          .where(sql<boolean>`r ->> 'record_id' = ${sql.ref('record_trash.record_id')}`)
          .returning('record_id')
          .execute();
        for (const row of updated) {
          updatedRecordIds.add(row.record_id);
        }
      }
    }

    if (updatedRecordIds.size > 0) {
      await this.upsertTableTrashIndex(trx, params);
      if (updatedRecordIds.size < params.uniqueRecords.length) {
        const missingRecords = params.uniqueRecords.filter(
          (record) => !updatedRecordIds.has(record.id)
        );
        await this.insertRecordTrashBatches(trx, {
          tableId: params.tableId,
          userId: params.userId,
          operationId: params.operationId,
          createdTime: params.createdTime,
          batches: splitTrashRecordBatches(missingRecords),
        });
      }
      return undefined;
    }

    const recordIdSet = new Set(params.recordIds);
    for (
      let page = 0, offset = 0;
      page < MAX_TABLE_TRASH_FALLBACK_PAGES;
      page += 1, offset += MAX_TABLE_TRASH_FALLBACK_PAGE_SIZE
    ) {
      const indexRows = await trx
        .selectFrom('table_trash')
        .select(['id', 'snapshot', 'created_time'])
        .where('table_id', '=', params.tableId)
        .where('resource_type', '=', RECORD_TRASH_RESOURCE_TYPE)
        .orderBy('created_time', 'desc')
        .orderBy('id', 'desc')
        .limit(MAX_TABLE_TRASH_FALLBACK_PAGE_SIZE)
        .offset(offset)
        .execute();
      const matchingIndex = indexRows.find((row) =>
        parseTableTrashRecordIds(row.snapshot).some((recordId) => recordIdSet.has(recordId))
      );
      if (matchingIndex) {
        return toIsoTimestamp(matchingIndex.created_time) ?? params.createdTime;
      }
      if (indexRows.length < MAX_TABLE_TRASH_FALLBACK_PAGE_SIZE) {
        break;
      }
    }
    return undefined;
  }

  private async upsertTableTrashIndex(
    trx: TrashDbTransaction,
    params: {
      tableId: string;
      operationId: string;
      userId: string;
      createdTime: string;
      recordIds: ReadonlyArray<string>;
    }
  ): Promise<void> {
    const existingTableTrash = await trx
      .selectFrom('table_trash')
      .select(['id', 'snapshot'])
      .where('id', '=', params.operationId)
      .where('table_id', '=', params.tableId)
      .forUpdate()
      .executeTakeFirst();

    if (existingTableTrash) {
      const mergedIds = Array.from(
        new Set([...parseTableTrashRecordIds(existingTableTrash.snapshot), ...params.recordIds])
      );
      await trx
        .updateTable('table_trash')
        .set({
          snapshot: JSON.stringify(mergedIds),
          created_time: params.createdTime,
        })
        .where('id', '=', params.operationId)
        .where('table_id', '=', params.tableId)
        .executeTakeFirst();
      return;
    }

    await trx
      .insertInto('table_trash')
      .values({
        id: params.operationId,
        table_id: params.tableId,
        resource_type: RECORD_TRASH_RESOURCE_TYPE,
        snapshot: JSON.stringify(params.recordIds),
        created_by: params.userId,
        created_time: params.createdTime,
      })
      .executeTakeFirst();
  }

  private async insertRecordTrashBatches(
    trx: TrashDbTransaction,
    params: {
      tableId: string;
      userId: string;
      operationId?: string;
      createdTime: string;
      batches: ReadonlyArray<ReadonlyArray<IDeleteRecordsPayload['records'][number]>>;
    }
  ): Promise<void> {
    for (const batch of params.batches) {
      const rows = batch.map((record) => ({
        id: generateRecordTrashId(),
        record_id: record.id,
        record_created_time: toIsoTimestamp(record.createdTime) ?? null,
        record_created_by: record.createdBy ?? null,
        record_last_modified_time: toIsoTimestamp(record.lastModifiedTime) ?? null,
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
            ${params.tableId},
            r ->> 'record_id',
            (r -> 'snapshot')::text,
            ${params.userId},
            ${params.createdTime}::timestamptz,
            ${params.operationId ?? null},
            (r ->> 'record_created_time')::timestamptz,
            r ->> 'record_created_by',
            (r ->> 'record_last_modified_time')::timestamptz,
            r ->> 'record_last_modified_by'
          from jsonb_array_elements(${stringifyTrashJsonForJsonb(rows)}::jsonb) as r`
        )
        .execute();
    }
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
