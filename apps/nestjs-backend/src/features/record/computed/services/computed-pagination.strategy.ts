/* eslint-disable @typescript-eslint/naming-convention */
import type { Knex } from 'knex';
import { AUTO_NUMBER_FIELD_NAME } from '../../../field/constant';

type Cursor = number | null;

export type IComputedRowResult = {
  __id: string;
  __version: number;
  ['__prev_version']?: number;
  ['__auto_number']?: number;
} & Record<string, unknown>;

export type PaginationBatchHandler = (rows: IComputedRowResult[]) => Promise<void> | void;

export interface IPaginationContext {
  tableId: string;
  recordIds: string[];
  preferAutoNumberPaging: boolean;
  recordIdBatchSize: number;
  cursorBatchSize: number;
  baseQueryBuilder: Knex.QueryBuilder;
  idColumn: string;
  orderColumn: string;
  updateRecords: (qb: Knex.QueryBuilder) => Promise<IComputedRowResult[]>;
}

export interface IRecordPaginationStrategy {
  canHandle(context: IPaginationContext): boolean;
  run(context: IPaginationContext, onBatch: PaginationBatchHandler): Promise<void>;
}

export class RecordIdBatchStrategy implements IRecordPaginationStrategy {
  canHandle(context: IPaginationContext): boolean {
    return (
      !context.preferAutoNumberPaging &&
      context.recordIds.length > 0 &&
      context.recordIds.length <= context.recordIdBatchSize
    );
  }

  async run(context: IPaginationContext, onBatch: PaginationBatchHandler): Promise<void> {
    for (const chunk of this.chunk(context.recordIds, context.recordIdBatchSize)) {
      if (!chunk.length) continue;

      const batchQb = context.baseQueryBuilder.clone().whereIn(context.idColumn, chunk);
      const rows = await context.updateRecords(batchQb);
      if (!rows.length) continue;

      await onBatch(rows);
    }
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    if (size <= 0) return [arr];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }
}

export class AutoNumberCursorStrategy implements IRecordPaginationStrategy {
  canHandle(): boolean {
    return true;
  }

  async run(context: IPaginationContext, onBatch: PaginationBatchHandler): Promise<void> {
    let cursor: Cursor = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pagedQb = context.baseQueryBuilder
        .clone()
        .orderBy(context.orderColumn, 'asc')
        .limit(context.cursorBatchSize);

      if (cursor != null) {
        pagedQb.where(context.orderColumn, '>', cursor);
      }

      const rows = await context.updateRecords(pagedQb);
      if (!rows.length) break;

      const sortedRows = rows.slice().sort((a, b) => {
        const left = (a[AUTO_NUMBER_FIELD_NAME] as number) ?? 0;
        const right = (b[AUTO_NUMBER_FIELD_NAME] as number) ?? 0;
        if (left === right) return 0;
        return left > right ? 1 : -1;
      });

      await onBatch(sortedRows);

      const lastRow = sortedRows[sortedRows.length - 1];
      const lastCursor = lastRow[AUTO_NUMBER_FIELD_NAME] as number | undefined;
      if (lastCursor != null) {
        cursor = lastCursor;
      }

      if (sortedRows.length < context.cursorBatchSize) {
        break;
      }
    }
  }
}
