import type {
  DomainError,
  IExecutionContext,
  RecordQueryPluginScope,
  Table,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type { BoundDataQuery } from './types';

export interface DataQueryResult {
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Present only for `page.includeTotal`; `total` ignores limit/offset. */
  readonly page?: { readonly limit: number; readonly offset: number; readonly total: number };
}

/** Executes a bound definition against the current schema and this request's authorization scope. */
export interface IDataQueryExecutor {
  execute(
    context: IExecutionContext,
    table: Table,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope
  ): Promise<Result<DataQueryResult, DomainError>>;
}
