import type {
  ITableRecordStreamPagination,
  ITableRecordStreamPaginationInput,
  ITableRecordStreamPaginationPage,
  ITableRecordStreamPaginationStrategy,
} from '@teable/v2-core';
import { injectable } from '@teable/v2-di';

@injectable()
export class CursorStreamPaginationStrategy implements ITableRecordStreamPaginationStrategy {
  accepts(pagination: ITableRecordStreamPagination | undefined): boolean {
    return pagination != null && 'cursor' in pagination;
  }

  next(input: ITableRecordStreamPaginationInput): ITableRecordStreamPaginationPage | null {
    const maxLimit = input.pagination?.limit ?? Infinity;

    if (input.yieldedCount >= maxLimit) {
      return null;
    }

    const remainingLimit = maxLimit - input.yieldedCount;
    const limit = Math.min(input.batchSize, remainingLimit);
    if (limit <= 0) {
      return null;
    }

    return {
      type: 'cursor',
      cursor:
        input.lastCursor ??
        (input.pagination && 'cursor' in input.pagination ? input.pagination.cursor : undefined),
      limit,
    };
  }
}
