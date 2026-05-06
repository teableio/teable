/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { generateRecordTrashId } from '@teable/core';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { IExecutionContext } from '@teable/v2-core';
import type { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import { V2ContainerService } from '../v2/v2-container.service';

interface ITableTrashInsert {
  id: string;
  table_id: string;
  resource_type: string;
  snapshot: string;
  created_by: string;
  created_time: Date;
}

interface IRecordTrashInsert {
  id: string;
  table_id: string;
  record_id: string;
  snapshot: string;
  created_by: string;
  created_time: Date;
}

type TrashDbTransaction = {
  insertInto(table: 'table_trash'): {
    values(value: ITableTrashInsert): {
      executeTakeFirst(): Promise<unknown>;
    };
  };
  insertInto(table: 'record_trash'): {
    values(values: IRecordTrashInsert[]): {
      execute(): Promise<unknown>;
    };
  };
};

type TrashDbClient = {
  transaction(): {
    execute<T>(callback: (trx: TrashDbTransaction) => Promise<T>): Promise<T>;
  };
};

const RECORD_TRASH_BATCH_SIZE = 5000;
const RECORD_TRASH_RESOURCE_TYPE = 'record';

@Injectable()
export class V2RecordTrashService {
  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async persistDeletedRecords(
    payload: IDeleteRecordsPayload,
    context?: Pick<IExecutionContext, 'tracer'>
  ): Promise<void> {
    const { operationId, tableId, userId, records } = payload;
    if (records.length === 0) {
      return;
    }

    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve(v2DataDbTokens.db) as TrashDbClient;
    const recordIds = records.map((record) => record.id);
    const createdTime = new Date();

    await this.runInSpan(
      context,
      'teable.V2RecordTrashService.persistDeletedRecords',
      {
        'teable.table_id': tableId,
        'teable.record_count': records.length,
      },
      async () =>
        db.transaction().execute(async (trx) => {
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

          for (let i = 0; i < records.length; i += RECORD_TRASH_BATCH_SIZE) {
            const batch = records.slice(i, i + RECORD_TRASH_BATCH_SIZE);
            await trx
              .insertInto('record_trash')
              .values(
                batch.map((record) => ({
                  id: generateRecordTrashId(),
                  table_id: tableId,
                  record_id: record.id,
                  snapshot: JSON.stringify(record),
                  created_by: userId,
                  created_time: createdTime,
                }))
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
