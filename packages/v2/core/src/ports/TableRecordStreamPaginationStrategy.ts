export type IOffsetTableRecordStreamPagination = {
  readonly offset: number;
  readonly limit: number;
};

export type ICursorTableRecordStreamPagination = {
  readonly cursor?: string;
  readonly limit: number;
};

export type ITableRecordStreamPagination =
  | IOffsetTableRecordStreamPagination
  | ICursorTableRecordStreamPagination;

export type ITableRecordStreamPaginationInput = {
  readonly pagination?: ITableRecordStreamPagination;
  readonly batchSize: number;
  readonly yieldedCount: number;
  readonly lastBatchCount?: number;
  readonly lastCursor?: string;
};

export type IOffsetTableRecordStreamPaginationPage = {
  readonly type: 'offset';
  readonly offset: number;
  readonly limit: number;
};

export type ICursorTableRecordStreamPaginationPage = {
  readonly type: 'cursor';
  readonly cursor?: string;
  readonly limit: number;
};

export type ITableRecordStreamPaginationPage =
  | IOffsetTableRecordStreamPaginationPage
  | ICursorTableRecordStreamPaginationPage;

/**
 * Strategy for planning paged reads in `findStream`.
 * Implementations can define how the next page should be selected.
 */
export interface ITableRecordStreamPaginationStrategy {
  accepts(pagination: ITableRecordStreamPagination | undefined): boolean;
  next(input: ITableRecordStreamPaginationInput): ITableRecordStreamPaginationPage | null;
}
