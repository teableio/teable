import type {
  ITableRecordStreamPaginationInput,
  ITableRecordStreamPagination,
  ITableRecordStreamPaginationPage,
  ITableRecordStreamPaginationStrategy,
} from '@teable/v2-core';
import { injectable } from '@teable/v2-di';

@injectable()
export class OffsetStreamPaginationStrategy implements ITableRecordStreamPaginationStrategy {
  accepts(pagination: ITableRecordStreamPagination | undefined): boolean {
    return pagination == null || 'offset' in pagination;
  }

  next(input: ITableRecordStreamPaginationInput): ITableRecordStreamPaginationPage | null {
    const startOffset =
      input.pagination && 'offset' in input.pagination ? input.pagination.offset : 0;
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
      type: 'offset',
      offset: startOffset + input.yieldedCount,
      limit,
    };
  }
}
