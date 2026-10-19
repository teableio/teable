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
